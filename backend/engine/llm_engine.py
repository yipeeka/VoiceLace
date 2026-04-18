from __future__ import annotations

import asyncio
import inspect
import json
import logging
import sys
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
    to_gemini_schema_type,
    validate_structured_payload,
)
from backend.engine.llm_single_runner import run_single_parse_with_stats
from backend.models import Script

logger = logging.getLogger(__name__)
ChunkCallback = Callable[[str], Awaitable[None]]
ChunkProgressCallback = Callable[[int, int], Awaitable[None]]


class LLMEngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.model_path = ""
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
        self._loaded_enable_think_mode: bool = settings.default_enable_llama_cpp_think_mode
        self.last_parse_stats: dict[str, Any] = {}

    @staticmethod
    def _structured_output_schema() -> dict[str, Any]:
        return structured_output_schema()

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

    def needs_reload(self, model_path: str, n_ctx: int, n_gpu_layers: int, backend: str, n_threads: int = 0) -> bool:
        normalized_backend = self._normalize_backend(backend)
        if normalized_backend != self._loaded_backend:
            return True
        if normalized_backend == "llama_cpp":
            return (
                (model_path or "") != self.model_path
                or int(n_ctx) != self._loaded_n_ctx
                or int(n_gpu_layers) != self._loaded_n_gpu_layers
                or int(n_threads or 0) != self._loaded_n_threads
                or bool(self.enable_llama_cpp_think_mode) != self._loaded_enable_think_mode
            )
        return False

    async def load_model(
        self,
        model_path: str,
        n_ctx: int = 8192,
        n_gpu_layers: int = -1,
        backend: str = "llama_cpp",
        n_threads: int = 0,
    ) -> None:
        normalized_backend = self._normalize_backend(backend)
        self._loaded_backend = normalized_backend
        self._loaded_n_ctx = int(n_ctx)
        self._loaded_n_gpu_layers = int(n_gpu_layers)
        self._loaded_n_threads = int(n_threads or 0)
        self._loaded_enable_think_mode = bool(self.enable_llama_cpp_think_mode)
        desired_path = model_path or settings.default_llm_model_path
        self.model_path = desired_path
        self.chat_format = settings.llm_chat_format

        if normalized_backend == "mock":
            self._openai_client = None
            self._llm = None
            self.model_name = "mock"
            self.is_loaded = True
            self.backend_name = "mock"
            self.last_error = ""
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
                    init_kwargs["chat_handler"] = Qwen35ChatHandler(enable_thinking=self.enable_llama_cpp_think_mode)
                    load_mode = f"qwen35-chat-handler(enable_thinking={self.enable_llama_cpp_think_mode})"
                except Exception as handler_exc:
                    # Some llama-cpp-python versions expose Qwen35ChatHandler as MTMD and
                    # require extra args (e.g. clip_model_path). Fall back to chat_format
                    # so text-only Qwen models can still load instead of dropping to mock.
                    init_kwargs["chat_format"] = self.chat_format
                    load_mode = f"chat_format={self.chat_format} (qwen35 handler unavailable: {handler_exc})"
                    logger.warning("Qwen35ChatHandler unavailable, fallback to chat_format: %s", handler_exc)
            else:
                init_kwargs["chat_format"] = self.chat_format
                load_mode = f"chat_format={self.chat_format}"
            logger.warning(
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
            logger.warning("Loaded llama-cpp-python model=%s backend=%s", self.model_name, self.backend_name)
        except Exception as exc:
            self._fallback_or_raise(f"加载 llama-cpp-python 失败: {exc}")

    async def unload_model(self) -> None:
        self.is_loaded = False
        self._llm = None
        self._openai_client = None

    async def parse_text(self, text: str, prompt: str | None = None) -> Script:
        return await self.parse_text_stream(text, prompt, on_chunk=None, llm_options=None)

    async def parse_text_stream(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> Script:
        return await self.parse_text_chunked_stream(
            text,
            prompt,
            on_chunk=on_chunk,
            on_chunk_progress=None,
            llm_options=llm_options,
        )

    async def parse_text_chunked_stream(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        on_chunk_progress: ChunkProgressCallback | None = None,
        on_chunk_start: ChunkProgressCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> Script:
        opts = llm_options or {}
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
        parse_stats.update(
            {
                "model_name": self.model_name or "",
                "structured_output_enabled": bool(opts.get("enable_structured_output", True)),
                "json_repair_enabled": bool(opts.get("enable_json_repair", True)),
                "think_mode_enabled": bool(self.enable_llama_cpp_think_mode),
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
        def _set_last_error(message: str) -> None:
            self.last_error = message

        return await run_single_parse_with_stats(
            backend_name=self.backend_name,
            llm=self._llm,
            text=text,
            prompt=prompt,
            on_chunk=on_chunk,
            llm_options=llm_options,
            extraction_prompt=self._extraction_prompt(),
            run_openai_parse=self._run_openai_parse,
            run_gemini_parse=self._run_gemini_parse,
            decode_json_payload_with_meta=self._decode_json_payload_with_meta,
            build_llama_chat_kwargs=self._build_llama_chat_kwargs,
            set_last_error=_set_last_error,
            logger=logger,
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
