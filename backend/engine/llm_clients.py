from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib import parse as urllib_parse

import httpx

from backend.config import settings

_gemini_schema_unsupported_models: set[str] = {
    # Known model family where responseSchema is often rejected by API.
    "gemini-3.1-flash-lite-preview",
}


def _is_schema_unsupported_error(body: str) -> bool:
    text = (body or "").lower()
    if not text:
        return False
    return (
        "responseschema" in text
        or "response schema" in text
        or "unknown name \"responseschema\"" in text
        or "unknown name 'responseschema'" in text
    )


def _normalize_gemini_model_name(model: str) -> str:
    name = (model or "").strip()
    if not name:
        return ""
    if name.startswith("models/"):
        name = name[len("models/") :]
    return name.strip("/")


def _build_gemini_generate_url(*, base_url: str, model: str, api_key: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        base = "https://generativelanguage.googleapis.com"
    normalized_model = _normalize_gemini_model_name(model)
    if not normalized_model:
        raise RuntimeError("Gemini model is empty. Please set BV_GEMINI_MODEL or llm_api_model.")
    if base.endswith("/v1beta"):
        api_prefix = base
    elif base.endswith("/v1"):
        api_prefix = base
    else:
        # Keep existing behavior/default to v1beta to preserve compatibility.
        api_prefix = f"{base}/v1beta"
    return (
        f"{api_prefix}/models/{urllib_parse.quote(normalized_model)}:generateContent"
        f"?key={urllib_parse.quote(api_key or '')}"
    )


async def run_openai_parse(
    *,
    openai_client: Any,
    text: str,
    prompt: str | None,
    llm_options: dict[str, Any],
    extraction_prompt: str,
    schema: dict[str, Any],
    logger: Any,
    default_model: str | None = None,
) -> str:
    if openai_client is None:
        raise RuntimeError("OpenAI client is not initialized")
    combined_prompt = f"{(prompt or '').strip()}\n\n{extraction_prompt.strip()}".strip()
    model = str(llm_options.get("api_model") or default_model or settings.openai_model)
    temperature = float(llm_options.get("temperature", 0.2))
    # OpenAI API path: only pass temperature from tuning params.
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
        )

    try:
        response = await asyncio.to_thread(_call, response_format)
    except Exception:
        if not use_schema:
            raise
        logger.warning("OpenAI structured output unsupported, fallback to json_object")
        response = await asyncio.to_thread(_call, {"type": "json_object"})
    return (response.choices[0].message.content or "").strip()


async def run_openai_text(
    *,
    openai_client: Any,
    text: str,
    prompt: str | None,
    llm_options: dict[str, Any],
    extraction_prompt: str,
    default_model: str | None = None,
) -> str:
    if openai_client is None:
        raise RuntimeError("OpenAI client is not initialized")
    combined_prompt = f"{(prompt or '').strip()}\n\n{extraction_prompt.strip()}".strip()
    model = str(llm_options.get("api_model") or default_model or settings.openai_model)
    temperature = float(llm_options.get("temperature", 0.2))

    def _call() -> Any:
        return openai_client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": combined_prompt},
                {"role": "user", "content": text},
            ],
            temperature=temperature,
        )

    response = await asyncio.to_thread(_call)
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
    base_url = str(llm_options.get("api_base_url") or settings.gemini_base_url)
    api_key = str(llm_options.get("api_key") or settings.gemini_api_key)
    model = str(llm_options.get("api_model") or settings.gemini_model)
    temperature = float(llm_options.get("temperature", 0.2))
    # Gemini API path: only pass temperature from tuning params.
    normalized_model = _normalize_gemini_model_name(model)
    use_schema = bool(llm_options.get("enable_structured_output", True)) and (normalized_model not in _gemini_schema_unsupported_models)
    url = _build_gemini_generate_url(
        base_url=base_url,
        model=model,
        api_key=api_key,
    )

    async def _call(include_schema: bool) -> tuple[str, str]:
        generation_config: dict[str, Any] = {
            "responseMimeType": "application/json",
            "temperature": temperature,
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
        retryable_codes = {429, 500, 503}
        timeout = httpx.Timeout(90.0)
        async with httpx.AsyncClient(timeout=timeout) as client:
            for retry in range(4):
                try:
                    response = await client.post(url, json=payload)
                except httpx.RequestError as exc:
                    if retry < 3:
                        await asyncio.sleep((2**retry) * 2)
                        continue
                    raise RuntimeError(
                        f"Gemini API request failed: {exc} "
                        f"(model={_normalize_gemini_model_name(model)}, url={url})"
                    ) from exc

                body = response.text or ""
                if response.is_success:
                    try:
                        parsed = response.json()
                    except Exception as exc:
                        raise RuntimeError(f"Gemini returned invalid JSON response: {body[:400]}") from exc
                    break

                if include_schema and response.status_code == 400 and _is_schema_unsupported_error(body):
                    _gemini_schema_unsupported_models.add(normalized_model)
                    logger.warning(
                        "Gemini responseSchema unsupported for model=%s, fallback to responseMimeType only and cache this decision",
                        normalized_model,
                    )
                    return await _call(include_schema=False)

                if response.status_code in retryable_codes and retry < 3:
                    await asyncio.sleep((2**retry) * 2)
                    continue

                raise RuntimeError(
                    f"Gemini API error {response.status_code}: {body or '<empty body>'} "
                    f"(model={_normalize_gemini_model_name(model)}, url={url})"
                )
            else:
                raise RuntimeError("Gemini API retries exhausted")

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

    out, _finish_reason = await _call(use_schema)
    return out


async def run_gemini_text(
    *,
    text: str,
    prompt: str | None,
    llm_options: dict[str, Any],
    extraction_prompt: str,
) -> str:
    combined_prompt = f"{(prompt or '').strip()}\n\n{extraction_prompt.strip()}".strip()
    base_url = str(llm_options.get("api_base_url") or settings.gemini_base_url)
    api_key = str(llm_options.get("api_key") or settings.gemini_api_key)
    model = str(llm_options.get("api_model") or settings.gemini_model)
    temperature = float(llm_options.get("temperature", 0.2))
    url = _build_gemini_generate_url(
        base_url=base_url,
        model=model,
        api_key=api_key,
    )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": f"{combined_prompt}\n\n用户文本：\n{text}"}],
            }
        ],
        "generationConfig": {
            "temperature": temperature,
        },
    }

    retryable_codes = {429, 500, 503}
    timeout = httpx.Timeout(90.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for retry in range(4):
            try:
                response = await client.post(url, json=payload)
            except httpx.RequestError as exc:
                if retry < 3:
                    await asyncio.sleep((2**retry) * 2)
                    continue
                raise RuntimeError(
                    f"Gemini API request failed: {exc} "
                    f"(model={_normalize_gemini_model_name(model)}, url={url})"
                ) from exc

            body = response.text or ""
            if response.is_success:
                try:
                    parsed = response.json()
                except Exception as exc:
                    raise RuntimeError(f"Gemini returned invalid JSON response: {body[:400]}") from exc
                break

            if response.status_code in retryable_codes and retry < 3:
                await asyncio.sleep((2**retry) * 2)
                continue

            raise RuntimeError(
                f"Gemini API error {response.status_code}: {body or '<empty body>'} "
                f"(model={_normalize_gemini_model_name(model)}, url={url})"
            )
        else:
            raise RuntimeError("Gemini API retries exhausted")

    candidates = parsed.get("candidates") or []
    if not candidates:
        raise RuntimeError("Gemini 返回空候选结果")
    first = candidates[0]
    content = first.get("content") or {}
    parts = content.get("parts") or []
    text_parts = [part.get("text", "") for part in parts if isinstance(part, dict)]
    out = "".join(text_parts).strip()
    if not out:
        raise RuntimeError("Gemini 返回内容为空")
    return out


async def repair_json_via_gemini(
    *,
    broken_json: str,
    llm_options: dict[str, Any],
) -> str:
    base_url = str(llm_options.get("api_base_url") or settings.gemini_base_url)
    api_key = str(llm_options.get("api_key") or settings.gemini_api_key)
    model = str(llm_options.get("api_model") or settings.gemini_model)
    url = _build_gemini_generate_url(
        base_url=base_url,
        model=model,
        api_key=api_key,
    )
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
        },
    }
    retryable_codes = {429, 500, 503}
    timeout = httpx.Timeout(90.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        for retry in range(4):
            try:
                response = await client.post(url, json=payload)
            except httpx.RequestError as exc:
                if retry < 3:
                    await asyncio.sleep((2**retry) * 2)
                    continue
                raise RuntimeError(f"Gemini JSON repair request failed: {exc}") from exc

            body = response.text or ""
            if response.is_success:
                try:
                    parsed = response.json()
                except Exception as exc:
                    raise RuntimeError(f"Gemini JSON 修复返回非法响应: {body[:400]}") from exc
                break

            if response.status_code in retryable_codes and retry < 3:
                await asyncio.sleep((2**retry) * 2)
                continue

            raise RuntimeError(
                f"Gemini JSON 修复失败 {response.status_code}: {body or '<empty body>'} "
                f"(model={_normalize_gemini_model_name(model)}, url={url})"
            )
        else:
            raise RuntimeError("Gemini JSON repair retries exhausted")

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
