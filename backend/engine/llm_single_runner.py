from __future__ import annotations

import asyncio
import math
import threading
import time
from typing import Any, Awaitable, Callable

from backend.engine.script_builder import build_mock_script, build_script_from_model_payload
from backend.models import Script

ChunkCallback = Callable[[str], Awaitable[None]]
RunProviderParse = Callable[[str, str | None, dict[str, Any]], Awaitable[str]]
DecodeWithMeta = Callable[[str, dict[str, Any], str], Awaitable[tuple[dict[str, Any], dict[str, Any]]]]
BuildLlamaKwargs = Callable[..., dict[str, Any]]
SetLastError = Callable[[str], None]


async def run_single_parse_with_stats(
    *,
    backend_name: str,
    llm: Any | None,
    text: str,
    prompt: str | None,
    on_chunk: ChunkCallback | None,
    llm_options: dict[str, Any] | None,
    extraction_prompt: str,
    run_openai_parse: RunProviderParse,
    run_gemini_parse: RunProviderParse,
    decode_json_payload_with_meta: DecodeWithMeta,
    build_llama_chat_kwargs: BuildLlamaKwargs,
    set_last_error: SetLastError,
    logger: Any,
) -> tuple[Script, dict[str, Any]]:
    started = time.perf_counter()
    stats: dict[str, Any] = {
        "backend": backend_name,
        "provider": backend_name,
        "attempts": 1,
        "repair_used": False,
        "decode_strategy": "mock",
        "fallback": False,
        "error": "",
        "output_chars": 0,
        "finish_reason": "",
    }
    if backend_name != "llama-cpp-python" or llm is None:
        if backend_name in {"openai", "openai_compatible"}:
            provider_name = "openai_compatible" if backend_name == "openai_compatible" else "openai"
            try:
                content = await run_openai_parse(text, prompt, llm_options or {})
                if on_chunk is not None and content:
                    await on_chunk(content)
                payload, decode_meta = await decode_json_payload_with_meta(content, llm_options or {}, provider_name)
                stats["decode_strategy"] = decode_meta.get("strategy", "raw")
                stats["repair_used"] = bool(decode_meta.get("repair_used", False))
                stats["output_chars"] = len(content or "")
                script = build_script_from_model_payload(text, payload, provider_name)
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return script, stats
            except Exception as exc:
                logger.exception("%s parse failed, falling back to mock parser", provider_name)
                set_last_error(str(exc))
                stats["fallback"] = True
                stats["error"] = str(exc)
                stats["decode_strategy"] = f"fallback_{provider_name}"
                script = build_mock_script(text, prompt=prompt, parser_name="demo-llm-fallback")
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return script, stats
        if backend_name == "gemini":
            try:
                content = await run_gemini_parse(text, prompt, llm_options or {})
                if on_chunk is not None and content:
                    await on_chunk(content)
                payload, decode_meta = await decode_json_payload_with_meta(content, llm_options or {}, "gemini")
                stats["decode_strategy"] = decode_meta.get("strategy", "raw")
                stats["repair_used"] = bool(decode_meta.get("repair_used", False))
                stats["output_chars"] = len(content or "")
                script = build_script_from_model_payload(text, payload, "gemini")
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return script, stats
            except Exception as exc:
                logger.exception("Gemini parse failed, falling back to mock parser")
                set_last_error(str(exc))
                stats["fallback"] = True
                stats["error"] = str(exc)
                stats["decode_strategy"] = "fallback_gemini"
                script = build_mock_script(text, prompt=prompt, parser_name="demo-llm-fallback")
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return script, stats
        if on_chunk is not None:
            for line in [line.strip() for line in text.splitlines() if line.strip()]:
                await on_chunk(f"{line}\n")
                await asyncio.sleep(0)
        stats["decode_strategy"] = "mock"
        script = build_mock_script(text, prompt=prompt, parser_name="demo-llm")
        stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
        return script, stats

    combined_prompt = f"{prompt.strip()}\n\n{extraction_prompt.strip()}" if prompt else extraction_prompt.strip()
    stats["provider"] = "llama"
    stats["decode_strategy"] = "raw"

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
            stats["attempts"] = attempt + 1
            max_tokens = int(min(8192, math.ceil(base_max_tokens * (1 + 0.6 * attempt))))
            kwargs = build_llama_chat_kwargs(
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
                response_format={"type": "json_object"},
            )
            token_queue: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()
            loop = asyncio.get_running_loop()
            cancel_event = threading.Event()

            def _stream_in_thread() -> None:
                stream = llm.create_chat_completion(**kwargs)
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
            await thread_future
            content = "".join(chunks)
            try:
                payload, decode_meta = await decode_json_payload_with_meta(content, llm_options or {}, "llama")
                stats["decode_strategy"] = decode_meta.get("strategy", "raw")
                stats["repair_used"] = bool(decode_meta.get("repair_used", False))
                stats["output_chars"] = len(content or "")
                stats["finish_reason"] = finish_reason
                script = build_script_from_model_payload(text, payload, "llama-cpp-python")
                stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
                return script, stats
            except Exception as exc:
                last_error = exc
                if finish_reason in {"length", "max_tokens"} or not content.strip():
                    continue
                continue
        if last_error is not None:
            raise last_error
        raise RuntimeError("llama parse failed with empty output")
    except Exception as exc:
        logger.exception("LLM parse failed, falling back to mock parser")
        set_last_error(str(exc))
        stats["fallback"] = True
        stats["error"] = str(exc)
        stats["decode_strategy"] = "fallback_llama"
        script = build_mock_script(text, prompt=prompt, parser_name="demo-llm-fallback")
        stats["duration_ms"] = int((time.perf_counter() - started) * 1000)
        return script, stats
