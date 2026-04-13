from __future__ import annotations

import asyncio
import inspect
import json
import logging
import math
import sys
import threading
from pathlib import Path
from typing import Any, Awaitable, Callable
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from backend.config import settings
from backend.engine.chunk_merger import merge_chunk_scripts
from backend.engine.script_builder import build_mock_script, build_script_from_model_payload
from backend.engine.text_chunker import chunk_text_by_paragraph
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
        max_chunk_chars = self._resolve_chunk_chars(llm_options or {})
        chunks = chunk_text_by_paragraph(text, max_chunk_chars=max_chunk_chars)
        if len(chunks) <= 1:
            return await self._parse_single_stream(text, prompt, on_chunk=on_chunk, llm_options=llm_options)

        known_characters: dict[str, str] = {}
        scripts: list[Script] = []
        total = len(chunks)
        for index, chunk in enumerate(chunks, start=1):
            if on_chunk_start is not None:
                await on_chunk_start(index, total)
            context_lines = [
                f"- {name}: {desc}"
                for name, desc in known_characters.items()
                if name and desc
            ]
            context_text = "\n".join(context_lines)
            chunk_prompt = prompt or ""
            if context_text:
                chunk_prompt = f"{chunk_prompt}\n\n已知角色：\n{context_text}".strip()
            script = await self._parse_single_stream(chunk.text, chunk_prompt, on_chunk=on_chunk, llm_options=llm_options)
            scripts.append(script)
            for char in script.characters:
                if char.name and char.description and char.name not in known_characters:
                    known_characters[char.name] = char.description
            if on_chunk_progress is not None:
                await on_chunk_progress(index, total)

        return merge_chunk_scripts(text, scripts)

    async def _parse_single_stream(
        self,
        text: str,
        prompt: str | None = None,
        on_chunk: ChunkCallback | None = None,
        llm_options: dict[str, Any] | None = None,
    ) -> Script:
        if self.backend_name != "llama-cpp-python" or self._llm is None:
            if self.backend_name == "openai":
                try:
                    content = await self._run_openai_parse(text, prompt, llm_options or {})
                    if on_chunk is not None and content:
                        await on_chunk(content)
                    payload = await self._decode_json_payload(content, llm_options or {}, provider="openai")
                    return build_script_from_model_payload(text, payload, "openai")
                except Exception as exc:
                    logger.exception("OpenAI parse failed, falling back to mock parser")
                    self.last_error = str(exc)
                    return build_mock_script(text, prompt=prompt, parser_name="demo-llm-fallback")
            if self.backend_name == "gemini":
                try:
                    content = await self._run_gemini_parse(text, prompt, llm_options or {})
                    if on_chunk is not None and content:
                        await on_chunk(content)
                    payload = await self._decode_json_payload(content, llm_options or {}, provider="gemini")
                    return build_script_from_model_payload(text, payload, "gemini")
                except Exception as exc:
                    logger.exception("Gemini parse failed, falling back to mock parser")
                    self.last_error = str(exc)
                    return build_mock_script(text, prompt=prompt, parser_name="demo-llm-fallback")
            if on_chunk is not None:
                for line in [line.strip() for line in text.splitlines() if line.strip()]:
                    await on_chunk(f"{line}\n")
                    await asyncio.sleep(0)
            return build_mock_script(text, prompt=prompt, parser_name="demo-llm")

        extraction_prompt = self._extraction_prompt()
        combined_prompt = f"{prompt.strip()}\n\n{extraction_prompt.strip()}" if prompt else extraction_prompt.strip()

        try:
            opts = llm_options or {}
            base_max_tokens = int(opts.get("max_tokens", 2048))
            temperature = float(opts.get("temperature", 0.2))
            top_p = float(opts.get("top_p", 0.9))
            top_k = int(opts.get("top_k", 40))
            min_p = float(opts.get("min_p", 0.0))
            presence_penalty = float(opts.get("presence_penalty", 0.0))
            repeat_penalty = float(opts.get("repeat_penalty", 1.0))
            last_error: Exception | None = None
            for attempt in range(2):
                max_tokens = int(min(8192, math.ceil(base_max_tokens * (1 + 0.6 * attempt))))
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
                )
                # Run the synchronous llama-cpp stream in a thread so we don't
                # block the asyncio event loop (which would freeze progress/WS).
                token_queue: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()
                loop = asyncio.get_running_loop()

                cancel_event = threading.Event()

                def _stream_in_thread() -> None:
                    stream = self._llm.create_chat_completion(**kwargs)
                    fr = ""
                    for event in stream:
                        if cancel_event.is_set():
                            break
                        choice = event["choices"][0]
                        fr = str(choice.get("finish_reason") or fr or "")
                        delta = choice.get("delta", {})
                        piece = delta.get("content") or ""
                        if piece:
                            loop.call_soon_threadsafe(token_queue.put_nowait, (piece, fr))
                    # Sentinel: signal end-of-stream
                    loop.call_soon_threadsafe(token_queue.put_nowait, None)

                thread_future = asyncio.ensure_future(asyncio.to_thread(_stream_in_thread))
                chunks: list[str] = []
                finish_reason = ""
                try:
                    while True:
                        item = await token_queue.get()
                        if item is None:
                            break
                        piece, finish_reason = item
                        chunks.append(piece)
                        if on_chunk is not None:
                            await on_chunk(piece)
                except asyncio.CancelledError:
                    cancel_event.set()
                    await thread_future
                    raise
                # Make sure the thread finished cleanly (propagate exceptions).
                await thread_future
                content = "".join(chunks)
                try:
                    payload = await self._decode_json_payload(content, llm_options or {}, provider="llama")
                    return build_script_from_model_payload(text, payload, "llama-cpp-python")
                except Exception as exc:
                    last_error = exc
                    # length/空输出属于典型截断场景，扩大 max_tokens 再试。
                    if finish_reason in {"length", "max_tokens"} or not content.strip():
                        continue
                    # 其他错误也允许下一次重试，但不提前返回。
                    continue
            if last_error is not None:
                raise last_error
            raise RuntimeError("llama parse failed with empty output")
        except Exception as exc:
            logger.exception("LLM parse failed, falling back to mock parser")
            self.last_error = str(exc)
            return build_mock_script(text, prompt=prompt, parser_name="demo-llm-fallback")

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
        text = (content or "").strip()
        if text.startswith("```json"):
            text = text[7:]
        elif text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        return text.strip()

    async def _decode_json_payload(self, content: str, llm_options: dict[str, Any], provider: str) -> dict[str, Any]:
        cleaned = self._strip_json_fences(content)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError as first_error:
            extracted = self._extract_json_object(cleaned)
            if extracted:
                try:
                    return json.loads(extracted)
                except json.JSONDecodeError:
                    pass
            if provider == "gemini":
                repaired = await self._repair_json_via_gemini(cleaned, llm_options)
                repaired_cleaned = self._strip_json_fences(repaired)
                extracted_repaired = self._extract_json_object(repaired_cleaned) or repaired_cleaned
                try:
                    return json.loads(extracted_repaired)
                except json.JSONDecodeError:
                    pass
            if provider == "llama":
                repaired = await self._repair_json_via_llama(cleaned, llm_options)
                repaired_cleaned = self._strip_json_fences(repaired)
                extracted_repaired = self._extract_json_object(repaired_cleaned) or repaired_cleaned
                try:
                    return json.loads(extracted_repaired)
                except json.JSONDecodeError:
                    pass
            raise first_error

    @staticmethod
    def _extract_json_object(text: str) -> str:
        if not text:
            return ""
        start = -1
        depth = 0
        in_string = False
        escaped = False
        for idx, ch in enumerate(text):
            if in_string:
                if escaped:
                    escaped = False
                elif ch == "\\":
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
                continue
            if ch == "{":
                if depth == 0:
                    start = idx
                depth += 1
                continue
            if ch == "}":
                if depth > 0:
                    depth -= 1
                    if depth == 0 and start >= 0:
                        return text[start : idx + 1]
        if start >= 0:
            return text[start:].strip()
        return ""

    async def _run_openai_parse(self, text: str, prompt: str | None, llm_options: dict[str, Any]) -> str:
        if self._openai_client is None:
            raise RuntimeError("OpenAI client is not initialized")
        extraction_prompt = self._extraction_prompt()
        combined_prompt = f"{(prompt or '').strip()}\n\n{extraction_prompt.strip()}".strip()
        model = str(llm_options.get("api_model") or settings.openai_model)
        temperature = float(llm_options.get("temperature", 0.2))
        top_p = float(llm_options.get("top_p", 0.9))
        presence_penalty = float(llm_options.get("presence_penalty", 0.0))
        max_tokens = int(llm_options.get("max_tokens", 2048))
        top_k = int(llm_options.get("top_k", 40))
        min_p = float(llm_options.get("min_p", 0.0))
        repeat_penalty = float(llm_options.get("repeat_penalty", 1.0))
        extra_body = {
            "top_k": top_k,
            "min_p": min_p,
            "repeat_penalty": repeat_penalty,
        }

        def _call() -> Any:
            return self._openai_client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": combined_prompt},
                    {"role": "user", "content": text},
                ],
                response_format={"type": "json_object"},
                temperature=temperature,
                top_p=top_p,
                presence_penalty=presence_penalty,
                max_tokens=max_tokens,
                extra_body=extra_body,
            )

        response = await asyncio.to_thread(_call)
        return (response.choices[0].message.content or "").strip()

    async def _run_gemini_parse(self, text: str, prompt: str | None, llm_options: dict[str, Any]) -> str:
        extraction_prompt = self._extraction_prompt()
        combined_prompt = f"{(prompt or '').strip()}\n\n{extraction_prompt.strip()}".strip()
        base_url = settings.gemini_base_url.rstrip("/")
        model = str(llm_options.get("api_model") or settings.gemini_model)
        temperature = float(llm_options.get("temperature", 0.2))
        top_p = float(llm_options.get("top_p", 0.9))
        top_k = int(llm_options.get("top_k", 40))
        max_tokens = int(llm_options.get("max_tokens", 2048))
        presence_penalty = float(llm_options.get("presence_penalty", 0.0))
        url = f"{base_url}/v1beta/models/{urllib_parse.quote(model)}:generateContent?key={urllib_parse.quote(settings.gemini_api_key)}"
        def _call(max_output_tokens: int) -> tuple[str, str]:
            payload = {
                "contents": [
                    {
                        "role": "user",
                        "parts": [{"text": f"{combined_prompt}\n\n用户文本：\n{text}"}],
                    }
                ],
                "generationConfig": {
                    "responseMimeType": "application/json",
                    "temperature": temperature,
                    "topP": top_p,
                    "topK": top_k,
                    "maxOutputTokens": max_output_tokens,
                    "presencePenalty": presence_penalty,
                },
            }
            data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            req = urllib_request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            import time
            retryable_codes = {429, 500, 503}
            last_exc: Exception | None = None
            for retry in range(4):
                try:
                    with urllib_request.urlopen(req, timeout=90) as resp:
                        raw = resp.read().decode("utf-8")
                    break
                except urllib_error.HTTPError as exc:
                    body = exc.read().decode("utf-8", errors="ignore")
                    if exc.code in retryable_codes and retry < 3:
                        last_exc = RuntimeError(f"Gemini API error {exc.code}: {body}")
                        wait = (2 ** retry) * 2  # 2, 4, 8 seconds
                        time.sleep(wait)
                        # Rebuild request (consumed by previous attempt)
                        req = urllib_request.Request(
                            url,
                            data=data,
                            headers={"Content-Type": "application/json"},
                            method="POST",
                        )
                        continue
                    raise RuntimeError(f"Gemini API error {exc.code}: {body}") from exc
            else:
                raise last_exc or RuntimeError("Gemini API retries exhausted")
            parsed = json.loads(raw)
            candidates = parsed.get("candidates") or []
            if not candidates:
                raise RuntimeError("Gemini 返回空候选结果")
            first = candidates[0]
            finish_reason = str(first.get("finishReason") or "")
            content = first.get("content") or {}
            parts = content.get("parts") or []
            text_parts = [part.get("text", "") for part in parts if isinstance(part, dict)]
            out = "".join(text_parts).strip()
            if not out:
                raise RuntimeError("Gemini 返回内容为空")
            return out, finish_reason

        last_out = ""
        for attempt in range(3):
            current_max = int(min(16384, math.ceil(max_tokens * (1 + 0.5 * attempt))))
            out, finish_reason = await asyncio.to_thread(_call, current_max)
            last_out = out
            if finish_reason != "MAX_TOKENS":
                return out
        return last_out

    async def _repair_json_via_gemini(self, broken_json: str, llm_options: dict[str, Any]) -> str:
        base_url = settings.gemini_base_url.rstrip("/")
        model = str(llm_options.get("api_model") or settings.gemini_model)
        url = f"{base_url}/v1beta/models/{urllib_parse.quote(model)}:generateContent?key={urllib_parse.quote(settings.gemini_api_key)}"
        prompt = (
            "请修复下面这段损坏的 JSON，要求：\n"
            "1) 仅输出一个合法 JSON 对象；\n"
            "2) 保留原有字段和内容语义；\n"
            "3) 不要输出解释文字。\n\n"
            f"{broken_json}"
        )
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "temperature": 0.0,
                "topP": 0.1,
                "topK": 1,
                "maxOutputTokens": int(min(16384, max(2048, int(llm_options.get("max_tokens", 2048)) * 2))),
            },
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        def _call() -> str:
            req = urllib_request.Request(
                url,
                data=data,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib_request.urlopen(req, timeout=90) as resp:
                raw = resp.read().decode("utf-8")
            parsed = json.loads(raw)
            candidates = parsed.get("candidates") or []
            if not candidates:
                raise RuntimeError("Gemini JSON 修复返回空候选结果")
            content = candidates[0].get("content") or {}
            parts = content.get("parts") or []
            text_parts = [part.get("text", "") for part in parts if isinstance(part, dict)]
            out = "".join(text_parts).strip()
            if not out:
                raise RuntimeError("Gemini JSON 修复返回内容为空")
            return out

        return await asyncio.to_thread(_call)

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
        # Signature-filter to avoid version mismatch kwargs errors.
        try:
            sig = inspect.signature(self._llm.create_chat_completion)
            allowed = set(sig.parameters.keys())
            filtered = {k: v for k, v in base_kwargs.items() if k in allowed}
            return filtered
        except Exception:
            return base_kwargs
