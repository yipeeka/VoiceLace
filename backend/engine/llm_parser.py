from __future__ import annotations

import json
from typing import Any, Awaitable, Callable


RepairCallback = Callable[[str, dict[str, Any]], Awaitable[str]]


def structured_output_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "additionalProperties": True,
        "properties": {
            "title": {"type": "string"},
            "segments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": True,
                    "properties": {
                        "type": {"type": "string"},
                        "speaker": {"type": "string"},
                        "text": {"type": "string"},
                        "emotion": {"type": "string"},
                        "non_verbal": {"type": "array", "items": {"type": "string"}},
                        "tts_overrides": {"type": "object"},
                    },
                    "required": ["speaker", "text"],
                },
            },
            "character_descriptions": {"type": "object"},
            "metadata": {"type": "object"},
        },
        "required": ["segments"],
    }


def to_gemini_schema_type(schema: Any) -> Any:
    if isinstance(schema, dict):
        out: dict[str, Any] = {}
        for key, value in schema.items():
            if key == "type" and isinstance(value, str):
                out[key] = value.upper()
            elif key in {"properties"} and isinstance(value, dict):
                out[key] = {k: to_gemini_schema_type(v) for k, v in value.items()}
            elif key in {"items"}:
                out[key] = to_gemini_schema_type(value)
            else:
                out[key] = to_gemini_schema_type(value)
        return out
    if isinstance(schema, list):
        return [to_gemini_schema_type(item) for item in schema]
    return schema


def gemini_response_schema() -> dict[str, Any]:
    # Gemini expects Schema type names in UPPERCASE.
    return to_gemini_schema_type(structured_output_schema())


def strip_json_fences(content: str) -> str:
    text = (content or "").strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    return text.strip()


def validate_structured_payload(payload: Any) -> None:
    if not isinstance(payload, dict):
        raise ValueError("LLM payload must be a JSON object")
    segments = payload.get("segments")
    if not isinstance(segments, list):
        raise ValueError("LLM payload missing required list field: segments")


def should_attempt_repair(content: str, error: json.JSONDecodeError, llm_options: dict[str, Any]) -> bool:
    if not llm_options.get("enable_json_repair", True):
        return False
    text = (content or "").strip()
    if not text:
        return False
    # Avoid expensive repair on very large payloads.
    if len(text) > 20000:
        return False
    if "{" not in text:
        return False
    msg = (error.msg or "").lower()
    repairable_tokens = (
        "unterminated",
        "expecting",
        "invalid",
        "delimiter",
        "eof",
        "extra data",
    )
    if any(token in msg for token in repairable_tokens):
        return True
    # Heuristic: unbalanced braces often indicate truncation that repair can fix.
    return text.count("{") > text.count("}")


def extract_json_object(text: str) -> str:
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


async def decode_json_payload_with_meta(
    *,
    content: str,
    llm_options: dict[str, Any],
    provider: str,
    repair_gemini: RepairCallback | None = None,
    repair_llama: RepairCallback | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    cleaned = strip_json_fences(content)
    if not cleaned.strip():
        raise json.JSONDecodeError("Empty content", cleaned, 0)
    try:
        payload = json.loads(cleaned)
        validate_structured_payload(payload)
        return payload, {"strategy": "raw", "repair_used": False}
    except (json.JSONDecodeError, ValueError) as first_error:
        extracted = extract_json_object(cleaned)
        if extracted:
            try:
                payload = json.loads(extracted)
                validate_structured_payload(payload)
                return payload, {"strategy": "extracted", "repair_used": False}
            except (json.JSONDecodeError, ValueError):
                pass
        # JSONDecodeError is a ValueError subclass; only short-circuit on
        # non-JSON schema/structure validation errors.
        if isinstance(first_error, ValueError) and not isinstance(first_error, json.JSONDecodeError):
            raise first_error
        if not should_attempt_repair(cleaned, first_error, llm_options):
            raise first_error
        if provider == "gemini" and repair_gemini is not None:
            repaired = await repair_gemini(cleaned, llm_options)
            repaired_cleaned = strip_json_fences(repaired)
            extracted_repaired = extract_json_object(repaired_cleaned) or repaired_cleaned
            try:
                payload = json.loads(extracted_repaired)
                validate_structured_payload(payload)
                return payload, {"strategy": "repaired_gemini", "repair_used": True}
            except (json.JSONDecodeError, ValueError):
                pass
        if provider == "llama" and repair_llama is not None:
            repaired = await repair_llama(cleaned, llm_options)
            repaired_cleaned = strip_json_fences(repaired)
            extracted_repaired = extract_json_object(repaired_cleaned) or repaired_cleaned
            try:
                payload = json.loads(extracted_repaired)
                validate_structured_payload(payload)
                return payload, {"strategy": "repaired_llama", "repair_used": True}
            except (json.JSONDecodeError, ValueError):
                pass
        raise first_error


async def decode_json_payload(
    *,
    content: str,
    llm_options: dict[str, Any],
    provider: str,
    repair_gemini: RepairCallback | None = None,
    repair_llama: RepairCallback | None = None,
) -> dict[str, Any]:
    payload, _meta = await decode_json_payload_with_meta(
        content=content,
        llm_options=llm_options,
        provider=provider,
        repair_gemini=repair_gemini,
        repair_llama=repair_llama,
    )
    return payload
