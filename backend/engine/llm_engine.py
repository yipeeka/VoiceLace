from __future__ import annotations

import asyncio
import inspect
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from backend.config import settings
from backend.engine.llm_clients import repair_json_via_gemini, run_gemini_parse, run_openai_parse
from backend.engine.llm_parse_orchestrator import run_chunked_parse_flow
from backend.engine.llm_parser import (
    decode_json_payload,
    decode_json_payload_with_meta,
    extract_json_object,
    gemini_response_schema,
    should_attempt_repair,
    strip_json_fences,
    structured_output_schema,
    structured_output_schema_structure_only,
    structured_output_schema_tts_enrichment,
    to_gemini_schema_type,
    validate_structured_payload,
)
from backend.engine.llm_single_runner import run_single_parse_with_stats
from backend.models import Character, Script, Segment, StructuredCharacterDraft, StructuredScriptDraft, StructuredSegmentDraft

logger = logging.getLogger(__name__)
ChunkCallback = Callable[[str], Awaitable[None]]
ChunkProgressCallback = Callable[[int, int], Awaitable[None]]
StageCallback = Callable[[str, str, int], Awaitable[None]]


class LLMEngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.model_path = ""
        self.clip_model_path = ""
        self.model_name = ""
        self.chat_format = settings.llm_chat_format
        self.enable_llama_cpp_think_mode = settings.default_enable_llama_cpp_think_mode
        self.backend_name = "mock"
        self.last_error = ""
        self._llm: Any | None = None
        self._openai_client: Any | None = None
        self._loaded_backend: str = "mock"
        self._loaded_n_ctx: int = settings.default_llm_n_ctx
        self._loaded_n_gpu_layers: int = settings.default_llm_n_gpu_layers
        self._loaded_n_threads: int = settings.default_llm_threads
        self._loaded_clip_model_path: str = settings.default_llm_clip_model_path
        self._loaded_enable_think_mode: bool = settings.default_enable_llama_cpp_think_mode
        self.last_parse_stats: dict[str, Any] = {}
        self.think_mode_effective: bool = False
        self.think_mode_support: str = "unknown"
        self.last_load_mode: str = ""
        self.handler_fallback_reason: str = ""

    @staticmethod
    def _structured_output_schema() -> dict[str, Any]:
        return structured_output_schema()

    @staticmethod
    def _structured_output_schema_structure_only() -> dict[str, Any]:
        return structured_output_schema_structure_only()

    @staticmethod
    def _structured_output_schema_tts_enrichment() -> dict[str, Any]:
        return structured_output_schema_tts_enrichment()

    @classmethod
    def _gemini_response_schema(cls) -> dict[str, Any]:
        return gemini_response_schema()

    @classmethod
    def _to_gemini_schema_type(cls, schema: Any) -> Any:
        return to_gemini_schema_type(schema)

    @staticmethod
    def _is_qwen35_model_path(model_path: str) -> bool:
        name = Path(model_path or "").name.lower()
        return "qwen3.5" in name or "qwen35" in name

    @staticmethod
    def _normalize_optional_path(path: str | None) -> str:
        return str(path or "").strip()

    @classmethod
    def _format_clip_hint(cls, clip_model_path: str) -> str:
        normalized = cls._normalize_optional_path(clip_model_path)
        if not normalized:
            return "clip=none"
        return f"clip={Path(normalized).name}"

    def _build_qwen35_handler(
        self,
        handler_cls: Any,
        *,
        clip_model_path: str,
    ) -> tuple[Any, str, bool, str]:
        normalized_clip = self._normalize_optional_path(clip_model_path)
        if normalized_clip and not Path(normalized_clip).exists():
            raise RuntimeError(f"clip_model_path 文件不存在: {normalized_clip}")

        handler_kwargs: dict[str, Any] = {}
        think_effective = False
        think_support = "qwen35_chat_handler"

        try:
            init_sig = inspect.signature(handler_cls.__init__)
            init_params = set(init_sig.parameters.keys())
        except Exception:
            init_params = set()

        if "clip_model_path" in init_params:
            if not normalized_clip:
                raise RuntimeError(
                    "当前 llama-cpp-python 的 Qwen35ChatHandler 需要 clip_model_path，请在系统设置中配置。"
                )
        if normalized_clip:
            handler_kwargs["clip_model_path"] = normalized_clip

        handler_kwargs["enable_thinking"] = bool(self.enable_llama_cpp_think_mode)
        think_effective = bool(self.enable_llama_cpp_think_mode)
        if "enable_thinking" not in init_params and init_params:
            think_support = "qwen35_chat_handler_no_think_switch"

        try:
            handler = handler_cls(**handler_kwargs)
        except TypeError as exc:
            message = str(exc)
            if "missing 1 required positional argument: 'clip_model_path'" in message and not normalized_clip:
                raise RuntimeError(
                    "当前 llama-cpp-python 的 Qwen35ChatHandler 需要 clip_model_path，请在系统设置中配置。"
                ) from exc
            if "unexpected keyword argument 'enable_thinking'" in message and "enable_thinking" in handler_kwargs:
                handler_kwargs.pop("enable_thinking", None)
                think_effective = False
                think_support = "qwen35_chat_handler_no_think_switch"
                handler = handler_cls(**handler_kwargs)
            elif "unexpected keyword argument 'clip_model_path'" in message and "clip_model_path" in handler_kwargs:
                handler_kwargs.pop("clip_model_path", None)
                handler = handler_cls(**handler_kwargs)
            else:
                raise

        load_mode = (
            f"qwen35-chat-handler({self._format_clip_hint(handler_kwargs.get('clip_model_path', ''))}, "
            f"enable_thinking={think_effective})"
        )
        return handler, load_mode, think_effective, think_support

    def needs_reload(
        self,
        model_path: str,
        n_ctx: int,
        n_gpu_layers: int,
        backend: str,
        n_threads: int = 0,
        clip_model_path: str = "",
    ) -> bool:
        normalized_backend = self._normalize_backend(backend)
        if normalized_backend != self._loaded_backend:
            return True
        if normalized_backend == "llama_cpp":
            return (
                (model_path or "") != self.model_path
                or self._normalize_optional_path(clip_model_path) != self._loaded_clip_model_path
                or int(n_ctx) != self._loaded_n_ctx
                or int(n_gpu_layers) != self._loaded_n_gpu_layers
                or int(n_threads or 0) != self._loaded_n_threads
                or bool(self.enable_llama_cpp_think_mode) != self._loaded_enable_think_mode
            )
        return False

    async def load_model(
        self,
        model_path: str,
        clip_model_path: str = "",
        n_ctx: int = 8192,
        n_gpu_layers: int = -1,
        backend: str = "llama_cpp",
        n_threads: int = 0,
    ) -> None:
        normalized_backend = self._normalize_backend(backend)
        requested_clip_path = self._normalize_optional_path(clip_model_path or settings.default_llm_clip_model_path)
        self._loaded_backend = normalized_backend
        self._loaded_n_ctx = int(n_ctx)
        self._loaded_n_gpu_layers = int(n_gpu_layers)
        self._loaded_n_threads = int(n_threads or 0)
        self._loaded_clip_model_path = requested_clip_path
        self._loaded_enable_think_mode = bool(self.enable_llama_cpp_think_mode)
        desired_path = model_path or settings.default_llm_model_path
        self.model_path = desired_path
        self.clip_model_path = requested_clip_path
        self.chat_format = settings.llm_chat_format

        if normalized_backend == "mock":
            self._openai_client = None
            self._llm = None
            self.model_name = "mock"
            self.is_loaded = True
            self.backend_name = "mock"
            self.last_error = ""
            self.think_mode_effective = False
            self.think_mode_support = "not_applicable"
            self.last_load_mode = "mock"
            self.handler_fallback_reason = ""
            return

        if normalized_backend == "openai":
            try:
                from openai import OpenAI
            except ImportError as exc:
                self._fallback_or_raise(f"未安装 openai SDK: {exc}")
                return
            api_key = settings.openai_api_key
            if not api_key:
                self._fallback_or_raise("未配置 BV_OPENAI_API_KEY，无法使用 OpenAI API。")
                return
            base_url = settings.openai_base_url.strip() or None
            self._openai_client = OpenAI(api_key=api_key, base_url=base_url)
            self._llm = None
            self.is_loaded = True
            self.backend_name = "openai"
            self.model_name = settings.openai_model
            self.last_error = ""
            self.think_mode_effective = False
            self.think_mode_support = "not_applicable"
            self.last_load_mode = "openai"
            self.handler_fallback_reason = ""
            return

        if normalized_backend == "gemini":
            if not settings.gemini_api_key:
                self._fallback_or_raise("未配置 BV_GEMINI_API_KEY，无法使用 Gemini API。")
                return
            self._openai_client = None
            self._llm = None
            self.is_loaded = True
            self.backend_name = "gemini"
            self.model_name = settings.gemini_model
            self.last_error = ""
            self.think_mode_effective = False
            self.think_mode_support = "not_applicable"
            self.last_load_mode = "gemini"
            self.handler_fallback_reason = ""
            return

        if not desired_path:
            self._fallback_or_raise("未配置 LLM GGUF 模型路径。")
            return

        if not Path(desired_path).exists():
            self._fallback_or_raise(f"LLM 模型文件不存在: {desired_path}")
            return

        try:
            from llama_cpp import Llama
            from llama_cpp.llama_chat_format import Qwen35ChatHandler
        except ImportError as exc:
            self._fallback_or_raise(f"未安装 llama-cpp-python: {exc} (python={sys.executable})")
            return

        try:
            init_kwargs: dict[str, Any] = {
                "model_path": desired_path,
                "n_ctx": n_ctx,
                "n_gpu_layers": n_gpu_layers,
                "n_batch": 2048,
                "n_threads": max(0, int(n_threads or 0)) or None,
                "flash_attn": True,
                "verbose": False,
            }
            load_mode = "default-chat-format"
            if self._is_qwen35_model_path(desired_path):
                try:
                    chat_handler, load_mode, think_effective, think_support = self._build_qwen35_handler(
                        Qwen35ChatHandler,
                        clip_model_path=requested_clip_path,
                    )
                    init_kwargs["chat_handler"] = chat_handler
                    self.think_mode_effective = think_effective
                    self.think_mode_support = think_support
                    self.handler_fallback_reason = ""
                except Exception as handler_exc:
                    # Some llama-cpp-python versions expose Qwen35ChatHandler as MTMD and
                    # require extra args (e.g. clip_model_path). Fall back to chat_format
                    # so text-only Qwen models can still load instead of dropping to mock.
                    init_kwargs["chat_format"] = self.chat_format
                    load_mode = f"chat_format={self.chat_format} (qwen35 handler unavailable: {handler_exc})"
                    self.think_mode_effective = False
                    self.think_mode_support = "qwen35_chat_handler_unavailable"
                    self.handler_fallback_reason = str(handler_exc)
                    logger.info(
                        "Qwen35ChatHandler unavailable in current llama-cpp-python build; fallback to chat_format=%s. reason=%s",
                        self.chat_format,
                        handler_exc,
                    )
            else:
                init_kwargs["chat_format"] = self.chat_format
                load_mode = f"chat_format={self.chat_format}"
                self.think_mode_effective = False
                self.think_mode_support = "chat_format_only"
                self.handler_fallback_reason = ""
            self.last_load_mode = load_mode
            logger.info(
                "Loading llama-cpp-python model path=%s mode=%s n_ctx=%s n_gpu_layers=%s n_threads=%s",
                desired_path,
                load_mode,
                n_ctx,
                n_gpu_layers,
                max(0, int(n_threads or 0)) or None,
            )
            self._llm = Llama(
                **init_kwargs,
            )
            self.is_loaded = True
            self.backend_name = "llama-cpp-python"
            self.model_name = Path(desired_path).name
            self.last_error = ""
            logger.info("Loaded llama-cpp-python model=%s backend=%s", self.model_name, self.backend_name)
        except Exception as exc:
            self._fallback_or_raise(f"加载 llama-cpp-python 失败: {exc}")

    async def unload_model(self) -> None:
        self.is_loaded = False
        self._llm = None
        self._openai_client = None
        self.think_mode_effective = False
        self.think_mode_support = "unknown"
        self.last_load_mode = ""
        self.handler_fallback_reason = ""

    async def parse_text(self, text: str, prompt: str | None = None) -> Script:
        return await self.parse_text_stream(text, prompt, on_chunk=None, llm_options=None)

    async def parse_text_stream(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
        parse_mode: str = "two_step_pipeline",
    ) -> Script:
        return await self.parse_text_chunked_stream(
            text,
            prompt,
            on_chunk=on_chunk,
            on_chunk_progress=None,
            llm_options=llm_options,
            parse_mode=parse_mode,
        )

    async def parse_text_chunked_stream(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        on_chunk_progress: ChunkProgressCallback | None = None,
        on_chunk_start: ChunkProgressCallback | None = None,
        llm_options: dict[str, Any] | None = None,
        parse_mode: str = "two_step_pipeline",
        on_stage: StageCallback | None = None,
    ) -> Script:
        opts = llm_options or {}
        selected_mode = "legacy_single_pass" if parse_mode == "legacy_single_pass" else "two_step_pipeline"

        if selected_mode == "legacy_single_pass":
            if on_stage is not None:
                await on_stage("finalizing", "经典单步解析中", 20)
            max_chunk_chars = self._resolve_chunk_chars(llm_options or {})
            script, parse_stats = await run_chunked_parse_flow(
                text=text,
                prompt=prompt,
                on_chunk=on_chunk,
                on_chunk_progress=on_chunk_progress,
                on_chunk_start=on_chunk_start,
                llm_options=llm_options,
                max_chunk_chars=max_chunk_chars,
                backend_name=self.backend_name,
                parse_single_with_stats=self._parse_single_stream_with_stats,
                logger=logger,
            )
            if on_stage is not None:
                await on_stage("finalizing", "经典单步解析收尾中", 92)
        else:
            script, parse_stats = await self._parse_text_two_step_pipeline(
                text=text,
                prompt=prompt,
                on_chunk=on_chunk,
                on_chunk_progress=on_chunk_progress,
                on_chunk_start=on_chunk_start,
                llm_options=llm_options,
                on_stage=on_stage,
            )
        parse_stats.update(
            {
                "parse_mode": selected_mode,
                "model_name": self.model_name or "",
                "structured_output_enabled": bool(opts.get("enable_structured_output", True)),
                "json_repair_enabled": bool(opts.get("enable_json_repair", True)),
                "think_mode_enabled": bool(self.enable_llama_cpp_think_mode),
                "think_mode_effective": bool(self.think_mode_effective),
                "think_mode_support": self.think_mode_support,
                "load_mode": self.last_load_mode,
                "n_ctx": int(opts.get("n_ctx", self._loaded_n_ctx)),
                "max_tokens": int(opts.get("max_tokens", settings.default_llm_max_tokens)),
            }
        )
        self.last_parse_stats = parse_stats
        return script

    async def _parse_single_stream(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> Script:
        script, _stats = await self._parse_single_stream_with_stats(
            text=text,
            prompt=prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
        )
        return script

    async def _parse_single_stream_with_stats(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> tuple[Script, dict[str, Any]]:
        return await self._parse_single_with_profile(
            text=text,
            prompt=prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=self._extraction_prompt(),
            schema=self._structured_output_schema(),
        )

    async def _parse_single_with_profile(
        self,
        *,
        text: str,
        prompt: str | None,
        on_chunk: ChunkCallback | None,
        llm_options: dict[str, Any] | None,
        extraction_prompt: str,
        schema: dict[str, Any],
    ) -> tuple[Script, dict[str, Any]]:
        def _set_last_error(message: str) -> None:
            self.last_error = message

        async def _run_openai_parse_custom(payload_text: str, payload_prompt: str | None, options: dict[str, Any]) -> str:
            return await run_openai_parse(
                openai_client=self._openai_client,
                text=payload_text,
                prompt=payload_prompt,
                llm_options=options,
                extraction_prompt=extraction_prompt,
                schema=schema,
                logger=logger,
            )

        async def _run_gemini_parse_custom(payload_text: str, payload_prompt: str | None, options: dict[str, Any]) -> str:
            return await run_gemini_parse(
                text=payload_text,
                prompt=payload_prompt,
                llm_options=options,
                extraction_prompt=extraction_prompt,
                gemini_schema=self._to_gemini_schema_type(schema),
                logger=logger,
            )

        return await run_single_parse_with_stats(
            backend_name=self.backend_name,
            llm=self._llm,
            text=text,
            prompt=prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=extraction_prompt,
            run_openai_parse=_run_openai_parse_custom,
            run_gemini_parse=_run_gemini_parse_custom,
            decode_json_payload_with_meta=self._decode_json_payload_with_meta,
            build_llama_chat_kwargs=self._build_llama_chat_kwargs,
            set_last_error=_set_last_error,
            logger=logger,
        )

    async def _parse_text_two_step_pipeline(
        self,
        *,
        text: str,
        prompt: str | None,
        on_chunk: ChunkCallback | None,
        on_chunk_progress: ChunkProgressCallback | None,
        on_chunk_start: ChunkProgressCallback | None,
        llm_options: dict[str, Any] | None,
        on_stage: StageCallback | None,
    ) -> tuple[Script, dict[str, Any]]:
        started = time.perf_counter()
        max_chunk_chars = self._resolve_chunk_chars(llm_options or {})

        if on_stage is not None:
            await on_stage("step1_structure", "Step 1：解析文本结构与角色", 12)

        async def _parse_step1(
            chunk_text: str,
            chunk_prompt: str | None,
            on_chunk: ChunkCallback | None = None,
            llm_options: dict[str, Any] | None = None,
        ) -> tuple[Script, dict[str, Any]]:
            return await self._parse_single_with_profile(
                text=chunk_text,
                prompt=chunk_prompt,
                on_chunk=on_chunk,
                llm_options=llm_options,
                extraction_prompt=self._structure_extraction_prompt(),
                schema=self._structured_output_schema_structure_only(),
            )

        step1_script, step1_stats = await run_chunked_parse_flow(
            text=text,
            prompt=prompt,
            on_chunk=on_chunk,
            on_chunk_progress=on_chunk_progress,
            on_chunk_start=on_chunk_start,
            llm_options=llm_options,
            max_chunk_chars=max_chunk_chars,
            backend_name=self.backend_name,
            parse_single_with_stats=_parse_step1,
            logger=logger,
        )
        structure_draft = self._to_structured_draft(step1_script, source_text=text)

        if on_stage is not None:
            await on_stage("step1_structure", "Step 1 完成，准备注入 TTS 参数", 55)
            await on_stage("step2_tts", "Step 2：注入 TTS 参数并格式化", 64)

        if self.backend_name == "mock":
            step2_script = self._build_mock_tts_enrichment_script(step1_script, source_text=text)
            step2_stats = {
                "mode": "mock_passthrough",
                "backend": "mock",
                "attempts": 0,
                "repair_used": False,
                "fallback": False,
                "duration_ms": 0,
            }
        else:
            step2_input = self._build_step2_input_payload(structure_draft)
            step2_script, step2_stats = await self._parse_single_with_profile(
                text=json.dumps(step2_input, ensure_ascii=False),
                prompt=prompt,
                on_chunk=on_chunk,
                llm_options=llm_options,
                extraction_prompt=self._tts_enrichment_prompt(),
                schema=self._structured_output_schema_tts_enrichment(),
            )

        structure_guard = self._analyze_two_step_structure_drift(structure_draft, step2_script)
        step2_stats["structure_guard"] = structure_guard
        if structure_guard["segment_count_changed"] or structure_guard["mismatch_count"] > 0:
            logger.warning(
                "Two-step structure drift detected: count_changed=%s mismatch_count=%s mismatched_indices=%s. "
                "Using Step1 structure as source of truth.",
                structure_guard["segment_count_changed"],
                structure_guard["mismatch_count"],
                structure_guard["mismatched_indices"],
            )
        final_script = self._merge_two_step_output(
            structure_draft=structure_draft,
            tts_script=step2_script,
            source_text=text,
            structure_guard=structure_guard,
        )

        if on_stage is not None:
            await on_stage("finalizing", "正在整理最终解析结果", 94)

        total_duration_ms = int((time.perf_counter() - started) * 1000)
        repair_used_count = int(step1_stats.get("repair_used_count", 0)) + (1 if step2_stats.get("repair_used") else 0)
        fallback_count = int(step1_stats.get("fallback_count", 0)) + (1 if step2_stats.get("fallback") else 0)
        parse_stats = {
            "mode": "two_step",
            "backend": self.backend_name,
            "total_chunks": int(step1_stats.get("total_chunks", 1)),
            "duration_ms": total_duration_ms,
            "repair_used_count": repair_used_count,
            "fallback_count": fallback_count,
            "chunk_stats": step1_stats.get("chunk_stats", []),
            "step_stats": {
                "step1_structure": step1_stats,
                "step2_tts": step2_stats,
            },
            "structure_guard": structure_guard,
        }
        logger.info(
            "LLM parse completed mode=two_step backend=%s chunks=%s duration_ms=%s repair_count=%s fallback_count=%s",
            self.backend_name,
            parse_stats["total_chunks"],
            total_duration_ms,
            repair_used_count,
            fallback_count,
        )
        return final_script, parse_stats

    @staticmethod
    def _to_structured_draft(script: Script, source_text: str) -> StructuredScriptDraft:
        return StructuredScriptDraft(
            title=script.title or "未命名剧本",
            source_text=source_text,
            segments=[
                StructuredSegmentDraft(
                    id=str(segment.id),
                    index=int(segment.index),
                    type=segment.type,
                    speaker=segment.speaker,
                    text=segment.text,
                )
                for segment in script.segments
            ],
            characters=[
                StructuredCharacterDraft(
                    name=character.name,
                    description=character.description,
                    appearance_count=int(character.appearance_count),
                )
                for character in script.characters
            ],
            metadata=dict(script.metadata or {}),
        )

    @staticmethod
    def _build_step2_input_payload(structure_draft: StructuredScriptDraft) -> dict[str, Any]:
        return {
            "title": structure_draft.title,
            "source_text": structure_draft.source_text,
            "segments": [segment.model_dump(mode="json") for segment in structure_draft.segments],
            "character_descriptions": {
                character.name: character.description
                for character in structure_draft.characters
                if character.name
            },
            "metadata": dict(structure_draft.metadata or {}),
        }

    @staticmethod
    def _build_mock_tts_enrichment_script(structure_script: Script, source_text: str) -> Script:
        return Script(
            title=structure_script.title,
            source_text=source_text,
            segments=[
                Segment(
                    id=segment.id,
                    index=segment.index,
                    type=segment.type,
                    speaker=segment.speaker,
                    text=segment.text,
                    emotion=segment.emotion or "neutral",
                    non_verbal=[],
                    tts_overrides={},
                )
                for segment in structure_script.segments
            ],
            characters=[Character.model_validate(character.model_dump(mode="json")) for character in structure_script.characters],
            metadata=dict(structure_script.metadata or {}),
        )

    @staticmethod
    def _analyze_two_step_structure_drift(structure_draft: StructuredScriptDraft, tts_script: Script) -> dict[str, Any]:
        expected_count = len(structure_draft.segments)
        actual_count = len(tts_script.segments)
        mismatched_indices: list[int] = []
        compare_count = min(expected_count, actual_count)
        for idx in range(compare_count):
            draft_segment = structure_draft.segments[idx]
            parsed = tts_script.segments[idx]
            if (
                draft_segment.type != parsed.type
                or draft_segment.speaker.strip() != parsed.speaker.strip()
                or draft_segment.text.strip() != parsed.text.strip()
            ):
                mismatched_indices.append(idx)
        return {
            "segment_count_expected": expected_count,
            "segment_count_actual": actual_count,
            "segment_count_changed": expected_count != actual_count,
            "mismatched_indices": mismatched_indices,
            "mismatch_count": len(mismatched_indices),
        }

    @staticmethod
    def _merge_two_step_output(
        *,
        structure_draft: StructuredScriptDraft,
        tts_script: Script,
        source_text: str,
        structure_guard: dict[str, Any] | None = None,
    ) -> Script:
        merged_segments: list[Segment] = []
        allow_step2_segment_injection = not bool((structure_guard or {}).get("segment_count_changed", False))
        for idx, draft_segment in enumerate(structure_draft.segments):
            enriched = tts_script.segments[idx] if allow_step2_segment_injection and idx < len(tts_script.segments) else None
            merged_segments.append(
                Segment(
                    id=str(draft_segment.id),
                    index=draft_segment.index,
                    type=draft_segment.type,
                    speaker=draft_segment.speaker,
                    text=draft_segment.text,
                    emotion=((enriched.emotion if enriched is not None else "neutral") or "neutral").strip() or "neutral",
                    non_verbal=[str(item) for item in ((enriched.non_verbal if enriched is not None else []) or [])],
                    tts_overrides=dict((enriched.tts_overrides if enriched is not None else {}) or {}),
                )
            )
        metadata = dict(structure_draft.metadata or {})
        metadata.update(dict(tts_script.metadata or {}))
        metadata["parse_pipeline"] = "two_step"
        final_characters = (tts_script.characters if allow_step2_segment_injection else []) or [
            Character(
                name=character.name,
                description=character.description,
                appearance_count=character.appearance_count,
            )
            for character in structure_draft.characters
        ]
        return Script(
            title=structure_draft.title or tts_script.title or "未命名剧本",
            source_text=source_text,
            segments=merged_segments,
            characters=final_characters,
            metadata=metadata,
        )

    def _fallback_or_raise(self, message: str) -> None:
        self.last_error = message
        if not settings.allow_mock_fallback:
            raise RuntimeError(message)
        self.is_loaded = True
        self.backend_name = "mock"
        self._llm = None
        self._openai_client = None
        self.model_name = "mock"
        self.think_mode_effective = False
        self.think_mode_support = "fallback_mock"
        self.last_load_mode = "fallback_mock"
        self.handler_fallback_reason = message

    @staticmethod
    def _normalize_backend(backend: str | None) -> str:
        val = (backend or "").strip().lower()
        if val in {"llama_cpp", "llama-cpp-python", "llama"}:
            return "llama_cpp"
        if val in {"openai", "openai_api"}:
            return "openai"
        if val in {"gemini", "google", "google_gemini"}:
            return "gemini"
        if val in {"mock", "demo"}:
            return "mock"
        return "llama_cpp"

    @staticmethod
    def _strip_json_fences(content: str) -> str:
        return strip_json_fences(content)

    async def _decode_json_payload(self, content: str, llm_options: dict[str, Any], provider: str) -> dict[str, Any]:
        return await decode_json_payload(
            content=content,
            llm_options=llm_options,
            provider=provider,
            repair_gemini=self._repair_json_via_gemini,
            repair_llama=self._repair_json_via_llama,
        )

    async def _decode_json_payload_with_meta(
        self,
        content: str,
        llm_options: dict[str, Any],
        provider: str,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        return await decode_json_payload_with_meta(
            content=content,
            llm_options=llm_options,
            provider=provider,
            repair_gemini=self._repair_json_via_gemini,
            repair_llama=self._repair_json_via_llama,
        )

    @staticmethod
    def _validate_structured_payload(payload: Any) -> None:
        validate_structured_payload(payload)

    @staticmethod
    def _should_attempt_repair(content: str, error: json.JSONDecodeError, llm_options: dict[str, Any]) -> bool:
        return should_attempt_repair(content, error, llm_options)

    @staticmethod
    def _extract_json_object(text: str) -> str:
        return extract_json_object(text)

    async def _run_openai_parse(self, text: str, prompt: str | None, llm_options: dict[str, Any]) -> str:
        return await run_openai_parse(
            openai_client=self._openai_client,
            text=text,
            prompt=prompt,
            llm_options=llm_options,
            extraction_prompt=self._extraction_prompt(),
            schema=self._structured_output_schema(),
            logger=logger,
        )

    async def _run_gemini_parse(self, text: str, prompt: str | None, llm_options: dict[str, Any]) -> str:
        return await run_gemini_parse(
            text=text,
            prompt=prompt,
            llm_options=llm_options,
            extraction_prompt=self._extraction_prompt(),
            gemini_schema=self._gemini_response_schema(),
            logger=logger,
        )

    async def _repair_json_via_gemini(self, broken_json: str, llm_options: dict[str, Any]) -> str:
        return await repair_json_via_gemini(broken_json=broken_json, llm_options=llm_options)

    async def _repair_json_via_llama(self, broken_json: str, llm_options: dict[str, Any]) -> str:
        if self._llm is None:
            raise RuntimeError("llama model is not initialized")
        prompt = (
            "请修复下面这段损坏的 JSON，要求：\n"
            "1) 仅输出一个合法 JSON 对象；\n"
            "2) 保留原有字段和内容语义；\n"
            "3) 不要输出解释文字。\n\n"
            f"{broken_json}"
        )
        kwargs = self._build_llama_chat_kwargs(
            messages=[
                {"role": "system", "content": "你是严格 JSON 修复器，只输出 JSON。"},
                {"role": "user", "content": prompt},
            ],
            max_tokens=int(min(8192, max(2048, int(llm_options.get("max_tokens", 2048)) * 2))),
            temperature=0.0,
            top_p=0.2,
            top_k=10,
            min_p=0.0,
            presence_penalty=0.0,
            repeat_penalty=1.0,
        )

        def _call() -> str:
            stream = self._llm.create_chat_completion(**kwargs)
            pieces: list[str] = []
            for event in stream:
                choice = event["choices"][0]
                delta = choice.get("delta", {})
                piece = delta.get("content") or ""
                if piece:
                    pieces.append(piece)
            out = "".join(pieces).strip()
            if not out:
                raise RuntimeError("llama JSON 修复返回内容为空")
            return out

        return await asyncio.to_thread(_call)

    @staticmethod
    def _resolve_chunk_chars(llm_options: dict[str, Any]) -> int:
        n_ctx = int(llm_options.get("n_ctx", settings.default_llm_n_ctx))
        max_tokens = int(llm_options.get("max_tokens", settings.default_llm_max_tokens))
        # Balance chunk size: larger chunks = fewer LLM calls but risk truncation.
        if max_tokens <= 2048:
            by_tokens = 2400
        elif max_tokens <= 3072:
            by_tokens = 3200
        elif max_tokens <= 4096:
            by_tokens = 4000
        else:
            by_tokens = 5000
        if n_ctx <= 4096:
            return min(by_tokens, 2000)
        if n_ctx <= 8192:
            return min(by_tokens, 4000)
        if n_ctx <= 16384:
            return min(by_tokens, 5000)
        return by_tokens

    @staticmethod
    def _extraction_prompt() -> str:
        return LLMEngine._legacy_extraction_prompt()

    @staticmethod
    def _legacy_extraction_prompt() -> str:
        return (
            "你是有声书剧本解析器。将用户文本拆分为多个片段，识别角色对话和旁白，"
            "并在合适位置插入 OmniVoice 非语言标签。\n\n"
            "请直接输出一个 JSON 对象（不要 ```json 标记，不要解释），格式如下：\n"
            "{\n"
            '  "title": "根据内容起一个标题",\n'
            '  "segments": [\n'
            '    {"type": "narration", "speaker": "narrator", "text": "[sigh] 暮色渐浓，庭院里只剩下风吹竹叶的细响。", "emotion": "melancholy", "non_verbal": ["sigh"]},\n'
            '    {"type": "dialogue", "speaker": "林黛玉", "text": "宝哥哥，你今日怎么来得这样晚？", "emotion": "concern", "non_verbal": []},\n'
            '    {"type": "dialogue", "speaker": "贾宝玉", "text": "[laughter] 路上被二姐姐叫住了！", "emotion": "cheerful", "non_verbal": ["laughter"]}\n'
            '  ],\n'
            '  "character_descriptions": {"林黛玉": "多愁善感的女子", "贾宝玉": "性情温和的少年"},\n'
            '  "metadata": {"language": "zh"}\n'
            "}\n\n"
            "type 取值: narration（旁白）、dialogue（对话）、direction（舞台提示）\n"
            "emotion 取值: neutral, cheerful, sad, angry, fearful, surprise, melancholy, tender, serious, playful, concern, excited\n\n"
            "可用的非语言标签（嵌入 text 中）：\n"
            "[laughter] [sigh] [confirmation-en] [question-ah] [question-oh] [question-ei] [question-yi] "
            "[surprise-ah] [surprise-oh] [surprise-wa] [surprise-yo] [dissatisfaction-hnn]\n\n"
            "规则：\n"
            "1. segments 中的 text 必须是原文实际内容，不是占位符\n"
            "2. 当文中有叹气、笑、惊讶等描写时，在对应 text 开头或适当位置插入非语言标签\n"
            "3. 非语言标签只在情境明确时使用，不要过度添加\n"
            "4. 未明确说话人的文本，speaker 设为 narrator\n"
            "5. segments 顺序与原文一致，不要遗漏内容\n"
            "6. 每段 text 建议 1-3 句，不宜过长"
        )

    @staticmethod
    def _structure_extraction_prompt() -> str:
        return (
            "你是有声书剧本结构分析器。请只做文本结构与角色解析，不要注入任何 TTS 表现参数。\n\n"
            "请直接输出一个 JSON 对象（不要 ```json 标记，不要解释），格式如下：\n"
            "{\n"
            '  "title": "根据内容起一个标题",\n'
            '  "segments": [\n'
            '    {"index": 0, "type": "narration", "speaker": "narrator", "text": "原文片段"},\n'
            '    {"index": 1, "type": "dialogue", "speaker": "角色名", "text": "原文对白"}\n'
            "  ],\n"
            '  "character_descriptions": {"角色名": "角色描述"},\n'
            '  "metadata": {"language": "zh"}\n'
            "}\n\n"
            "硬性规则：\n"
            "1. 只输出结构字段，不要输出 emotion/non_verbal/tts_overrides\n"
            "2. 不改写原文，不删减，不扩写\n"
            "3. segments 顺序必须与原文一致\n"
            "4. type 仅可取 narration/dialogue/direction\n"
            "5. 未明确说话人的文本，speaker 设为 narrator\n"
            "6. 每段建议 1-3 句，避免过长\n"
            "7. 如果一句话里先是叙述引导语，后面出现冒号、破折号或引号包裹的直接引语，必须拆成 narration + dialogue 两段，"
            "不要把引号内台词并入 narration\n"
            "8. 遇到“某人说/问/哭/哭了/喊/叫/骂/叹/答/回答/嘀咕/嚷道：‘……’”这类结构时，"
            "冒号后或引号内的文本优先判为 dialogue，speaker 尽量使用引导语里的主语\n"
            "9. 引号内出现完整呼喊、提问、感叹、重复呼语时，通常是角色直接说话，不是旁白\n\n"
            "示例：\n"
            "原文：老太太一想到她的孙子被枪打死了，就在后炕上放开声哭了：\"我那苦命的安安啊！我那没吃没喝的安安啊！我那还没活人的安安啊！叹——哟哟哟哟哟……\"\n"
            "应拆分为：\n"
            '1. {"type": "narration", "speaker": "narrator", "text": "老太太一想到她的孙子被枪打死了，就在后炕上放开声哭了："}\n'
            '2. {"type": "dialogue", "speaker": "老太太", "text": "我那苦命的安安啊！我那没吃没喝的安安啊！我那还没活人的安安啊！叹——哟哟哟哟哟……"}'
        )

    @staticmethod
    def _tts_enrichment_prompt() -> str:
        return (
            "你是 TTS 参数注入与格式化器。输入是已确定好的结构化 JSON（含 segments 的 type/speaker/text）。\n"
            "你的任务是补充语音表现字段，并严格保持结构不变。\n\n"
            "请直接输出一个 JSON 对象（不要 ```json 标记，不要解释），格式如下：\n"
            "{\n"
            '  "title": "保留原值",\n'
            '  "segments": [\n'
            '    {"id": "seg-1", "index": 0, "type": "narration", "speaker": "narrator", "text": "原文片段", "emotion": "neutral", "non_verbal": [], "tts_overrides": {}},\n'
            '    {"id": "seg-2", "index": 1, "type": "dialogue", "speaker": "角色名", "text": "原文对白", "emotion": "serious", "non_verbal": ["sigh"], "tts_overrides": {"speed": 1.0}}\n'
            "  ],\n"
            '  "character_descriptions": {"角色名": "角色描述，可整理优化"},\n'
            '  "metadata": {"language": "zh"}\n'
            "}\n\n"
            "硬性规则：\n"
            "1. 不允许新增、删除、重排 segments\n"
            "2. 不允许修改任意 segment 的 id/index/type/speaker/text\n"
            "3. 仅补充 emotion/non_verbal/tts_overrides 与必要 metadata\n"
            "4. emotion 取值: neutral, cheerful, sad, angry, fearful, surprise, melancholy, tender, serious, playful, concern, excited\n"
            "5. non_verbal 仅在情境明确时填写，可为空数组"
        )

    def _build_llama_chat_kwargs(
        self,
        *,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float,
        top_k: int,
        min_p: float,
        presence_penalty: float,
        repeat_penalty: float,
        response_format: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        base_kwargs: dict[str, Any] = {
            "messages": messages,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "min_p": min_p,
            # llama-cpp-python uses `present_penalty` in many versions.
            "present_penalty": presence_penalty,
            "repeat_penalty": repeat_penalty,
            "max_tokens": max_tokens,
            "stream": True,
        }
        if response_format is not None:
            base_kwargs["response_format"] = response_format
        # Signature-filter to avoid version mismatch kwargs errors.
        try:
            sig = inspect.signature(self._llm.create_chat_completion)
            allowed = set(sig.parameters.keys())
            filtered = {k: v for k, v in base_kwargs.items() if k in allowed}
            return filtered
        except Exception:
            return base_kwargs
