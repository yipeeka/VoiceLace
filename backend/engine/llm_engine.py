from __future__ import annotations

import asyncio
import inspect
import logging
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from backend.config import settings
from backend.engine.llm_clients import (
    repair_json_via_gemini,
    run_gemini_parse,
    run_gemini_text,
    run_openai_parse,
    run_openai_text,
)
from backend.engine.llm_parse_orchestrator import run_chunked_parse_flow
from backend.engine.llm_two_step_pipeline import (
    analyze_two_step_structure_drift,
    merge_two_step_output,
    normalize_single_pass_script_with_source_structure,
    run_two_step_parse_pipeline,
    to_structured_draft,
)
from backend.engine.llm_parser import (
    decode_json_payload,
    decode_json_payload_with_meta,
    gemini_response_schema,
    structured_output_schema,
    structured_output_schema_tts_enrichment,
    to_gemini_schema_type,
)
from backend.engine.prompts import (
    legacy_extraction_prompt,
    read_aloud_extraction_prompt,
    structure_extraction_prompt,
    tts_enrichment_prompt,
)
from backend.engine.llm_single_runner import run_single_parse_with_stats
from backend.models import Character, Script, Segment

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

    @staticmethod
    def _structure_extraction_prompt() -> str:
        return structure_extraction_prompt()

    @staticmethod
    def _to_structured_draft(script: Script, source_text: str):
        return to_structured_draft(script, source_text)

    @staticmethod
    def _analyze_two_step_structure_drift(structure_draft, tts_script):
        return analyze_two_step_structure_drift(structure_draft, tts_script)

    @staticmethod
    def _merge_two_step_output(*, structure_draft, tts_script, source_text: str, structure_guard: dict[str, Any] | None = None):
        return merge_two_step_output(
            structure_draft=structure_draft,
            tts_script=tts_script,
            source_text=source_text,
            structure_guard=structure_guard,
        )

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
        if parse_mode == "legacy_single_pass":
            selected_mode = "legacy_single_pass"
        elif parse_mode == "read_aloud_single_voice":
            selected_mode = "read_aloud_single_voice"
        else:
            selected_mode = "two_step_pipeline"

        if selected_mode == "legacy_single_pass":
            if on_stage is not None:
                await on_stage("finalizing", "经典单步解析中", 20)
            max_chunk_chars = self._resolve_legacy_single_pass_chunk_chars(llm_options or {})
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
            script = self._normalize_legacy_single_pass_script(script, source_text=text)
            if on_stage is not None:
                await on_stage("finalizing", "经典单步解析收尾中", 92)
        elif selected_mode == "read_aloud_single_voice":
            if on_stage is not None:
                await on_stage("finalizing", "快速朗读解析中", 16)
            max_chunk_chars = self._resolve_read_aloud_chunk_chars(llm_options or {})
            script, parse_stats = await run_chunked_parse_flow(
                text=text,
                prompt=prompt,
                on_chunk=on_chunk,
                on_chunk_progress=on_chunk_progress,
                on_chunk_start=on_chunk_start,
                llm_options=llm_options,
                max_chunk_chars=max_chunk_chars,
                backend_name=self.backend_name,
                parse_single_with_stats=self._parse_read_aloud_stream_with_stats,
                logger=logger,
            )
            script = self._normalize_read_aloud_script(script, source_text=text)
            if on_stage is not None:
                await on_stage("finalizing", "快速朗读解析收尾中", 94)
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
            extraction_prompt=legacy_extraction_prompt(),
            schema=structured_output_schema(),
        )

    async def _parse_read_aloud_stream_with_stats(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> tuple[Script, dict[str, Any]]:
        script, stats = await self._parse_single_with_profile(
            text=text,
            prompt=prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=read_aloud_extraction_prompt(),
            schema=structured_output_schema(),
        )
        return self._normalize_read_aloud_script(script, source_text=text), stats

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
                gemini_schema=to_gemini_schema_type(schema),
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
        return await run_two_step_parse_pipeline(
            text=text,
            prompt=prompt,
            on_chunk=on_chunk,
            on_chunk_progress=on_chunk_progress,
            on_chunk_start=on_chunk_start,
            llm_options=llm_options,
            on_stage=on_stage,
            backend_name=self.backend_name,
            resolve_chunk_chars=self._resolve_chunk_chars,
            parse_step1_raw_with_stats=self._parse_step1_raw_with_stats,
            parse_single_with_profile=self._parse_single_with_profile,
            structure_extraction_prompt=structure_extraction_prompt(),
            tts_extraction_prompt=tts_enrichment_prompt(),
            tts_schema=structured_output_schema_tts_enrichment(),
            logger=logger,
        )

    async def _parse_step1_raw_with_stats(
        self,
        *,
        text: str,
        prompt: str | None,
        on_chunk: ChunkCallback | None,
        llm_options: dict[str, Any] | None,
        extraction_prompt: str,
    ) -> tuple[str, dict[str, Any]]:
        started = time.perf_counter()
        opts = llm_options or {}
        combined_prompt = f"{(prompt or '').strip()}\n\n{extraction_prompt.strip()}".strip()
        stats: dict[str, Any] = {
            "backend": self.backend_name,
            "provider": self.backend_name,
            "attempts": 1,
            "repair_used": False,
            "decode_strategy": "raw_text",
            "fallback": False,
            "error": "",
            "output_chars": 0,
            "finish_reason": "",
        }

        async def _emit_chunk(content: str) -> None:
            if on_chunk is not None and content:
                await on_chunk(content)

        try:
            if self.backend_name == "openai":
                content = await run_openai_text(
                    openai_client=self._openai_client,
                    text=text,
                    prompt=prompt,
                    llm_options=opts,
                    extraction_prompt=extraction_prompt,
                )
                if not (content or "").strip():
                    raise RuntimeError("OpenAI Step1 raw output is empty")
                await _emit_chunk(content)
                stats["output_chars"] = len(content or "")
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return content, stats

            if self.backend_name == "gemini":
                content = await run_gemini_text(
                    text=text,
                    prompt=prompt,
                    llm_options=opts,
                    extraction_prompt=extraction_prompt,
                )
                if not (content or "").strip():
                    raise RuntimeError("Gemini Step1 raw output is empty")
                await _emit_chunk(content)
                stats["output_chars"] = len(content or "")
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return content, stats

            if self.backend_name != "llama-cpp-python" or self._llm is None:
                content = self._build_mock_step1_lines(text)
                await _emit_chunk(content)
                stats["provider"] = "mock"
                stats["decode_strategy"] = "mock_step1"
                stats["output_chars"] = len(content or "")
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return content, stats

            temperature = float(opts.get("temperature", 0.2))
            top_p = float(opts.get("top_p", 0.9))
            top_k = int(opts.get("top_k", 40))
            min_p = float(opts.get("min_p", 0.0))
            presence_penalty = float(opts.get("presence_penalty", 0.0))
            repeat_penalty = float(opts.get("repeat_penalty", 1.0))
            max_tokens = int(opts.get("max_tokens", 2048))

            kwargs = self._build_llama_chat_kwargs(
                messages=[
                    {"role": "system", "content": combined_prompt},
                    {"role": "user", "content": text},
                ],
                max_tokens=max_tokens,
                temperature=temperature,
                top_p=top_p,
                top_k=top_k,
                min_p=min_p,
                presence_penalty=presence_penalty,
                repeat_penalty=repeat_penalty,
                response_format=None,
            )

            token_queue: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()
            loop = asyncio.get_running_loop()
            cancel_event = threading.Event()

            def _stream_in_thread() -> None:
                stream = self._llm.create_chat_completion(**kwargs)
                finish_reason = ""
                for event in stream:
                    if cancel_event.is_set():
                        break
                    choice = event["choices"][0]
                    finish_reason = str(choice.get("finish_reason") or finish_reason or "")
                    delta = choice.get("delta", {})
                    piece = delta.get("content") or ""
                    if piece:
                        loop.call_soon_threadsafe(token_queue.put_nowait, (piece, finish_reason))
                loop.call_soon_threadsafe(token_queue.put_nowait, None)

            thread_future = asyncio.ensure_future(asyncio.to_thread(_stream_in_thread))
            finish_reason = ""
            chunks: list[str] = []
            try:
                while True:
                    item = await token_queue.get()
                    if item is None:
                        break
                    piece, finish_reason = item
                    chunks.append(piece)
                    await _emit_chunk(piece)
            except asyncio.CancelledError:
                cancel_event.set()
                await thread_future
                raise
            await thread_future

            content = "".join(chunks).strip()
            if not content:
                raise RuntimeError("Step1 raw parse returned empty content")
            stats["finish_reason"] = finish_reason
            stats["output_chars"] = len(content)
            stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
            return content, stats
        except Exception as exc:
            logger.exception("Step1 raw parse failed, falling back to mock step1 lines")
            self.last_error = str(exc)
            fallback = self._build_mock_step1_lines(text)
            await _emit_chunk(fallback)
            stats["fallback"] = True
            stats["error"] = str(exc)
            stats["decode_strategy"] = "fallback_step1_raw"
            stats["output_chars"] = len(fallback or "")
            stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
            return fallback, stats

    @staticmethod
    def _build_mock_step1_lines(text: str) -> str:
        lines: list[str] = []
        for raw in (text or "").splitlines():
            line = (raw or "").strip()
            if not line:
                continue
            if line.startswith("旁白：") or line.startswith("旁白:"):
                lines.append(line.replace(":", "：", 1))
                continue
            if line.startswith("舞台提示：") or line.startswith("舞台提示:"):
                lines.append(line.replace(":", "：", 1))
                continue
            if "：" in line or ":" in line:
                sep = "：" if "：" in line else ":"
                speaker, content = line.split(sep, 1)
                speaker = speaker.strip()
                content = content.strip()
                if speaker and content:
                    lines.append(f"{speaker}：{content}")
                    continue
            lines.append(f"旁白：{line}")
        return "\n".join(lines)

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

    async def _run_openai_parse(self, text: str, prompt: str | None, llm_options: dict[str, Any]) -> str:
        return await run_openai_parse(
            openai_client=self._openai_client,
            text=text,
            prompt=prompt,
            llm_options=llm_options,
            extraction_prompt=legacy_extraction_prompt(),
            schema=structured_output_schema(),
            logger=logger,
        )

    async def _run_gemini_parse(self, text: str, prompt: str | None, llm_options: dict[str, Any]) -> str:
        return await run_gemini_parse(
            text=text,
            prompt=prompt,
            llm_options=llm_options,
            extraction_prompt=legacy_extraction_prompt(),
            gemini_schema=gemini_response_schema(),
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
    def _resolve_legacy_single_pass_chunk_chars(llm_options: dict[str, Any]) -> int:
        n_ctx = int(llm_options.get("n_ctx", settings.default_llm_n_ctx))
        max_tokens = int(llm_options.get("max_tokens", settings.default_llm_max_tokens))
        # Legacy single-pass emits a verbose JSON schema per segment, so output expansion
        # is much higher than two-step flow. Use conservative chunk sizes to avoid
        # silent max_tokens truncation (e.g. only first few segments returned).
        if max_tokens <= 2048:
            by_tokens = 900
        elif max_tokens <= 3072:
            by_tokens = 1200
        elif max_tokens <= 4096:
            by_tokens = 1500
        elif max_tokens <= 6144:
            by_tokens = 1900
        else:
            by_tokens = 2300
        if n_ctx <= 4096:
            return min(by_tokens, 800)
        if n_ctx <= 8192:
            return by_tokens
        if n_ctx <= 16384:
            return min(int(by_tokens * 1.15), 2600)
        return min(int(by_tokens * 1.3), 3000)

    @staticmethod
    def _resolve_read_aloud_chunk_chars(llm_options: dict[str, Any]) -> int:
        n_ctx = int(llm_options.get("n_ctx", settings.default_llm_n_ctx))
        max_tokens = int(llm_options.get("max_tokens", settings.default_llm_max_tokens))
        if max_tokens <= 2048:
            by_tokens = 1200
        elif max_tokens <= 3072:
            by_tokens = 1600
        elif max_tokens <= 4096:
            by_tokens = 2000
        elif max_tokens <= 6144:
            by_tokens = 2400
        else:
            by_tokens = 2800
        if n_ctx <= 4096:
            return min(by_tokens, 1000)
        if n_ctx <= 8192:
            return by_tokens
        if n_ctx <= 16384:
            return min(int(by_tokens * 1.15), 3200)
        return min(int(by_tokens * 1.3), 3600)

    @staticmethod
    def _normalize_read_aloud_script(script: Script, *, source_text: str) -> Script:
        structure_segments = LLMEngine._build_read_aloud_structure_segments(source_text)
        normalized_segments = LLMEngine._merge_read_aloud_segments(
            structure_segments=structure_segments,
            model_segments=script.segments,
        )

        metadata = dict(script.metadata or {})
        parser_name = str(metadata.get("parser") or "read-aloud")
        if "read-aloud" not in parser_name:
            metadata["parser"] = f"{parser_name}-read-aloud"
        else:
            metadata["parser"] = parser_name
        metadata["parse_mode"] = "read_aloud_single_voice"

        return Script(
            title=script.title or "未命名剧本",
            source_text=source_text,
            segments=normalized_segments,
            characters=[
                Character(
                    name="narrator",
                    description="单人旁白朗读者",
                    appearance_count=len(normalized_segments),
                    voice_preset_id=None,
                )
            ]
            if normalized_segments
            else [],
            metadata=metadata,
        )

    @staticmethod
    def _build_read_aloud_structure_segments(source_text: str) -> list[Segment]:
        segments: list[Segment] = []
        quote_pattern = re.compile(r"“([^”]+)”")
        trailing_punct_chars = "，。？！；：、…"

        for raw_line in (source_text or "").splitlines():
            line = (raw_line or "").strip()
            if not line:
                continue
            cursor = 0
            narration_buffer = ""

            for match in quote_pattern.finditer(line):
                start, end = match.span()
                quoted_text = (match.group(1) or "").strip()
                before = line[cursor:start]
                after_cursor = end
                trailing_punct = ""
                while after_cursor < len(line) and line[after_cursor] in trailing_punct_chars:
                    trailing_punct += line[after_cursor]
                    after_cursor += 1
                after = line[after_cursor:]
                context_before = f"{narration_buffer}{before}"

                if LLMEngine._is_direct_speech_quote(quoted_text, context_before, after):
                    if context_before.strip():
                        segments.append(
                            Segment(
                                id="",
                                index=len(segments),
                                type="narration",
                                speaker="narrator",
                                text=context_before.strip(),
                            )
                        )
                    dialogue_text = f"{quoted_text}{trailing_punct}".strip()
                    if dialogue_text:
                        segments.append(
                            Segment(
                                id="",
                                index=len(segments),
                                type="dialogue",
                                speaker="narrator",
                                text=dialogue_text,
                            )
                        )
                    narration_buffer = ""
                else:
                    narration_buffer = f"{narration_buffer}{before}“{quoted_text}”{trailing_punct}"

                cursor = after_cursor

            narration_buffer = f"{narration_buffer}{line[cursor:]}"
            if narration_buffer.strip():
                segments.append(
                    Segment(
                        id="",
                        index=len(segments),
                        type="narration",
                        speaker="narrator",
                        text=narration_buffer.strip(),
                    )
                )

        if segments:
            return segments
        line = (source_text or "").strip()
        if not line:
            return []
        return [Segment(id="", index=0, type="narration", speaker="narrator", text=line)]

    @staticmethod
    def _is_direct_speech_quote(quoted_text: str, before_text: str, after_text: str) -> bool:
        content = (quoted_text or "").strip()
        if not content:
            return False

        before = (before_text or "").strip()
        after = (after_text or "").strip()
        tail = before[-18:]
        head = after[:24]

        speech_markers = [
            "说道",
            "说",
            "道",
            "问道",
            "问",
            "答道",
            "答",
            "喊道",
            "喊",
            "笑道",
            "笑着说",
            "哭道",
            "叹道",
            "忙道",
            "叫道",
            "叫",
            "表示",
            "指出",
            "认为",
            "告诉",
            "提醒",
            "回应",
            "回道",
            "应道",
            "对他说",
            "对她说",
            "对儿子说道",
            "对他说道",
            "对她说道",
        ]
        has_context_marker = any(marker in tail for marker in speech_markers) or any(marker in head for marker in speech_markers)
        has_dialogue_punct = any(char in content for char in "，。？！；：…")
        short_term_like = len(content) <= 8 and not has_dialogue_punct and not has_context_marker

        if not before and not after:
            return True
        if short_term_like:
            return False
        if has_context_marker:
            return True
        if has_dialogue_punct and len(content) >= 4:
            return True
        return False

    @staticmethod
    def _merge_read_aloud_segments(*, structure_segments: list[Segment], model_segments: list[Segment]) -> list[Segment]:
        merged: list[Segment] = []
        search_start = 0
        for index, structure_segment in enumerate(structure_segments):
            matched_index = None
            matched_segment = None
            target_key = LLMEngine._normalize_text_for_read_aloud_match(structure_segment.text)
            for candidate_index in range(search_start, len(model_segments)):
                candidate = model_segments[candidate_index]
                candidate_type = "dialogue" if candidate.type == "dialogue" else "narration"
                if candidate_type != structure_segment.type:
                    continue
                candidate_key = LLMEngine._normalize_text_for_read_aloud_match(candidate.text)
                if not target_key or not candidate_key:
                    continue
                if target_key in candidate_key or candidate_key in target_key:
                    matched_index = candidate_index
                    matched_segment = candidate
                    break

            final_text = structure_segment.text
            final_emotion = "neutral"
            final_non_verbal: list[str] = []
            final_tts_overrides: dict[str, str | int | float | bool] = {}

            if matched_segment is not None:
                search_start = matched_index + 1
                final_text = LLMEngine._merge_read_aloud_segment_text(
                    segment_type=structure_segment.type,
                    base_text=structure_segment.text,
                    model_text=matched_segment.text,
                    non_verbal=matched_segment.non_verbal or [],
                )
                final_emotion = matched_segment.emotion or "neutral"
                final_non_verbal = [str(item).strip() for item in (matched_segment.non_verbal or []) if str(item).strip()]
                final_tts_overrides = matched_segment.tts_overrides or {}

            merged.append(
                Segment(
                    id=structure_segment.id,
                    index=index,
                    type=structure_segment.type,
                    speaker="narrator",
                    text=final_text,
                    emotion=final_emotion,
                    non_verbal=final_non_verbal,
                    tts_overrides=final_tts_overrides,
                )
            )
        return merged

    @staticmethod
    def _merge_read_aloud_segment_text(
        *,
        segment_type: str,
        base_text: str,
        model_text: str,
        non_verbal: list[str],
    ) -> str:
        if segment_type != "dialogue":
            return (base_text or "").strip()
        candidate = (model_text or "").strip()
        base = (base_text or "").strip()
        if not candidate:
            return base
        if LLMEngine._is_same_dialogue_text(base, candidate):
            return candidate
        tags = [str(item).strip() for item in (non_verbal or []) if str(item).strip()]
        if tags:
            joined_tags = " ".join(tags)
            if joined_tags not in base:
                return f"{joined_tags} {base}".strip()
        return base

    @staticmethod
    def _normalize_text_for_read_aloud_match(text: str) -> str:
        normalized = re.sub(r"\[[^\]]+\]", "", text or "")
        normalized = re.sub(r"[“”\"'‘’\s]", "", normalized)
        return normalized

    @staticmethod
    def _normalize_legacy_single_pass_script(script: Script, *, source_text: str) -> Script:
        return normalize_single_pass_script_with_source_structure(script, source_text=source_text)

    @staticmethod
    def _is_same_dialogue_text(base_text: str, model_text: str) -> bool:
        def _collapse_dialogue_text(text: str) -> str:
            collapsed = re.sub(r"\[[^\]]+\]", "", text or "")
            collapsed = re.sub(r"([\u4e00-\u9fff])[A-Z]{1,12}[1-5]", r"\1", collapsed)
            collapsed = re.sub(r"[“”\"'‘’\s]", "", collapsed)
            return collapsed

        base_key = _collapse_dialogue_text(base_text)
        model_key = _collapse_dialogue_text(model_text)
        return bool(base_key and model_key and base_key == model_key)

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
