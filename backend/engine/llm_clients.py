from __future__ import annotations

import asyncio
import json
import math
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from backend.config import settings


async def run_openai_parse(
    *,
    openai_client: Any,
    text: str,
    prompt: str | None,
    llm_options: dict[str, Any],
    extraction_prompt: str,
    schema: dict[str, Any],
    logger: Any,
) -> str:
    if openai_client is None:
        raise RuntimeError("OpenAI client is not initialized")
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
    use_schema = bool(llm_options.get("enable_structured_output", True))
    schema_name = str(llm_options.get("structured_schema_name") or "beautyvoice_script")
    response_format = (
        {
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": False,
                "schema": schema,
            },
        }
        if use_schema
        else {"type": "json_object"}
    )

    def _call(rf: dict[str, Any]) -> Any:
        return openai_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": combined_prompt},
                {"role": "user", "content": text},
            ],
            response_format=rf,
            temperature=temperature,
            top_p=top_p,
            presence_penalty=presence_penalty,
            max_tokens=max_tokens,
            extra_body=extra_body,
        )

    try:
        response = await asyncio.to_thread(_call, response_format)
    except Exception:
        if not use_schema:
            raise
        logger.warning("OpenAI structured output unsupported, fallback to json_object")
        response = await asyncio.to_thread(_call, {"type": "json_object"})
    return (response.choices[0].message.content or "").strip()


async def run_gemini_parse(
    *,
    text: str,
    prompt: str | None,
    llm_options: dict[str, Any],
    extraction_prompt: str,
    gemini_schema: dict[str, Any],
    logger: Any,
) -> str:
    combined_prompt = f"{(prompt or '').strip()}\n\n{extraction_prompt.strip()}".strip()
    base_url = settings.gemini_base_url.rstrip("/")
    model = str(llm_options.get("api_model") or settings.gemini_model)
    temperature = float(llm_options.get("temperature", 0.2))
    top_p = float(llm_options.get("top_p", 0.9))
    top_k = int(llm_options.get("top_k", 40))
    max_tokens = int(llm_options.get("max_tokens", 2048))
    presence_penalty = float(llm_options.get("presence_penalty", 0.0))
    use_schema = bool(llm_options.get("enable_structured_output", True))
    url = f"{base_url}/v1beta/models/{urllib_parse.quote(model)}:generateContent?key={urllib_parse.quote(settings.gemini_api_key)}"

    def _call(max_output_tokens: int, include_schema: bool) -> tuple[str, str]:
        generation_config: dict[str, Any] = {
            "responseMimeType": "application/json",
            "temperature": temperature,
            "topP": top_p,
            "topK": top_k,
            "maxOutputTokens": max_output_tokens,
            "presencePenalty": presence_penalty,
        }
        if include_schema and gemini_schema:
            generation_config["responseSchema"] = gemini_schema

        payload = {
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": f"{combined_prompt}\n\n用户文本：\n{text}"}],
                }
            ],
            "generationConfig": generation_config,
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
                if include_schema and exc.code == 400:
                    logger.warning("Gemini responseSchema unsupported, fallback to responseMimeType only")
                    return _call(max_output_tokens, include_schema=False)
                if exc.code in retryable_codes and retry < 3:
                    last_exc = RuntimeError(f"Gemini API error {exc.code}: {body}")
                    wait = (2 ** retry) * 2
                    time.sleep(wait)
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
        out, finish_reason = await asyncio.to_thread(_call, current_max, use_schema)
        last_out = out
        if finish_reason != "MAX_TOKENS":
            return out
    return last_out


async def repair_json_via_gemini(
    *,
    broken_json: str,
    llm_options: dict[str, Any],
) -> str:
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
