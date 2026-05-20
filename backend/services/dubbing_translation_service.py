from __future__ import annotations

import asyncio
import hashlib
import json
import re
from copy import deepcopy
from typing import Any, Awaitable, Callable

from fastapi import HTTPException
from backend.services.dubbing_timeline_service import (
    TARGET_DURATION_MAX_SEC,
    TARGET_DURATION_MIN_SEC,
    apply_reasonable_dubbing_timeline,
    estimate_speaking_seconds,
    resolve_target_duration_sec,
)

ALLOWED_TRANSLATION_SOURCES = {"primary_local", "secondary_local", "openai", "openai_compatible", "gemini"}
PROMPT_VERSION = "dubbing-batch-v2"
DEFAULT_MIN_SPEED = 0.8
DEFAULT_MAX_SPEED = 1.2
LOCAL_BATCH_SEGMENT_LIMIT = 12
LOCAL_BATCH_CHAR_LIMIT = 2200
API_BATCH_SEGMENT_LIMIT = 48
API_BATCH_CHAR_LIMIT = 10000

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None] | None]
CancelCheck = Callable[[], bool]

_CONTEXT_HINTS_CACHE: dict[str, str] = {}
_SEGMENT_TRANSLATION_CACHE: dict[str, dict[str, Any]] = {}


def clamp_float(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _sha256_text(value: Any) -> str:
    return hashlib.sha256(_stable_json(value).encode("utf-8")).hexdigest()


def safe_duration_from_ms(start_ms: int | None, end_ms: int | None) -> float | None:
    if start_ms is None or end_ms is None:
        return None
    delta = int(end_ms) - int(start_ms)
    if delta <= 0:
        return None
    return max(TARGET_DURATION_MIN_SEC, min(TARGET_DURATION_MAX_SEC, delta / 1000.0))


def build_dubbing_translate_prompt(
    *,
    mode: str,
    target_language: str,
    target_duration_sec: float,
    context_hints: str = "",
) -> str:
    lang = (target_language or "").strip() or "中文"
    hints_block = f"\n术语与纠错参考：\n{context_hints}" if context_hints else ""
    if mode == "polish_only":
        return (
            "你是配音文本润色编辑。请先修正文中明显识别错漏，在保持原语言和原意不变的前提下润色。"
            "要求：自然口语、适合旁白/对白配音、尽量简洁，不要解释，不要注释。"
            f"\n目标口播时长：约 {target_duration_sec:.2f} 秒"
            "\n时长优先级：先保证语义，再尽量贴近时长。若略超时，请使用更短句式或省略可省略修饰。"
            f"{hints_block}"
            "\n只输出润色后的正文。"
        )
    return (
        "你是配音翻译编辑。请先修正文中明显识别错漏，再翻译成目标语言，结果用于旁白/对白配音。"
        "要求：忠实原意、自然口语、尽量简洁，不要解释，不要注释。"
        f"\n目标语言：{lang}"
        f"\n目标口播时长：约 {target_duration_sec:.2f} 秒"
        "\n时长优先级：先保证语义，再尽量贴近时长。若略超时，请使用更短句式或省略可省略修饰。"
        f"{hints_block}"
        "\n只输出最终译文正文。"
    )


def build_dubbing_compress_prompt(*, target_language: str, target_duration_sec: float) -> str:
    lang = (target_language or "").strip() or "中文"
    return (
        "你是配音文本压缩编辑。请在保持原意的前提下，把文本压缩为更短的口播版本。"
        "要求：自然顺口，不要丢失关键信息，不要解释。必要时可加入适量停顿标点（如逗号、省略号）帮助语速控制。"
        f"\n目标语言：{lang}"
        f"\n目标口播时长：约 {target_duration_sec:.2f} 秒"
        "\n只输出压缩后的正文。"
    )


def build_dubbing_batch_translate_prompt(*, mode: str, target_language: str, context_hints: str = "") -> str:
    lang = (target_language or "").strip() or "中文"
    hints_block = f"\n术语与纠错参考：\n{context_hints}" if context_hints else ""
    if mode == "polish_only":
        return (
            "你是配音文本润色编辑。请把用户给出的 JSON 数组逐项润色。"
            "每项包含 id、speaker、text、target_duration_sec。"
            "要求：先修正文中明显识别错漏；保持原语言和原意不变；自然口语、尽量简洁；"
            "尽量贴近 target_duration_sec 对应的口播时长。"
            f"{hints_block}"
            '\n只输出 JSON 数组，不要解释。格式：[{"id":"原 id","text":"润色后文本"}]'
        )
    return (
        "你是配音翻译编辑。请把用户给出的 JSON 数组逐项翻译为目标语言。"
        "每项包含 id、speaker、text、target_duration_sec。"
        "要求：先修正文中明显识别错漏，再翻译；忠实原意、自然口语、尽量简洁；"
        "尽量贴近 target_duration_sec 对应的口播时长。"
        f"\n目标语言：{lang}"
        f"{hints_block}"
        '\n只输出 JSON 数组，不要解释。格式：[{"id":"原 id","text":"译文"}]'
    )


def build_dubbing_batch_compress_prompt(*, target_language: str) -> str:
    lang = (target_language or "").strip() or "中文"
    return (
        "你是配音文本压缩编辑。用户会给出 JSON 数组，每项包含 id、text、target_duration_sec。"
        "请在保持原意前提下压缩 text，使其更适合目标口播时长。"
        "要求自然顺口，不要解释。"
        f"\n目标语言：{lang}"
        '\n只输出 JSON 数组，格式：[{"id":"原 id","text":"压缩后文本"}]'
    )


def build_context_hints_prompt(*, target_language: str) -> str:
    lang = (target_language or "").strip() or "中文"
    return (
        "你是配音预处理助手。请基于给定文本做全局理解，输出精简参考："
        "\n1) 固定短语/专有名词建议译法；"
        "\n2) 可能的 ASR 错漏与更合理写法；"
        "\n3) 语气与风格建议（用于保持段落一致性）。"
        f"\n目标语言：{lang}"
        "\n输出要求：每行一条，最多 12 条，不要输出 JSON，不要解释。"
    )


def _normalize_input_segments(segments: list[Any]) -> tuple[list[dict[str, Any]], int]:
    normalized_rows: list[dict[str, Any]] = []
    dropped = 0
    used_ids: set[str] = set()
    for idx, segment in enumerate(segments):
        getter = segment.get if isinstance(segment, dict) else lambda key, default=None: getattr(segment, key, default)
        source_text = str(getter("text", "") or "").strip()
        if not source_text:
            dropped += 1
            continue
        speaker = (str(getter("speaker", "") or "").strip() or "narrator")
        seg_id = str(getter("id", "") or f"dub-seg-{idx + 1}").strip() or f"dub-seg-{idx + 1}"
        if seg_id in used_ids:
            seg_id = f"{seg_id}-{idx + 1}"
        used_ids.add(seg_id)
        raw_start = getter("start_ms", None)
        raw_end = getter("end_ms", None)
        start_ms = int(raw_start) if raw_start is not None else None
        end_ms = int(raw_end) if raw_end is not None else None
        if start_ms is not None and end_ms is not None and end_ms <= start_ms:
            end_ms = start_ms + 1
        normalized_rows.append(
            {
                "id": seg_id,
                "index": idx,
                "speaker": speaker,
                "source_text": source_text,
                "start_ms": start_ms,
                "end_ms": end_ms,
            }
        )
    return normalized_rows, dropped


def _chunk_lines(lines: list[str], *, max_chars: int = 2800) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for line in lines:
        candidate_len = current_len + len(line) + 1
        if current and candidate_len > max_chars:
            chunks.append("\n".join(current))
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len = candidate_len
    if current:
        chunks.append("\n".join(current))
    return chunks


async def _collect_context_hints(
    *,
    state,
    config: dict[str, Any],
    normalized_segments: list[dict[str, Any]],
    target_language: str,
) -> str:
    if not normalized_segments:
        return ""
    numbered_lines = [
        f"{idx + 1}. {str(row.get('source_text') or '').strip()}"
        for idx, row in enumerate(normalized_segments)
        if str(row.get("source_text") or "").strip()
    ]
    if not numbered_lines:
        return ""

    cache_key = _sha256_text(
        {
            "version": PROMPT_VERSION,
            "kind": "context_hints",
            "backend": config.get("backend"),
            "model": config.get("model_path") or config.get("api_model") or "",
            "target_language": target_language,
            "segments": [
                {
                    "id": row.get("id"),
                    "speaker": row.get("speaker"),
                    "text": row.get("source_text"),
                    "start_ms": row.get("start_ms"),
                    "end_ms": row.get("end_ms"),
                }
                for row in normalized_segments
            ],
        }
    )
    if cache_key in _CONTEXT_HINTS_CACHE:
        return _CONTEXT_HINTS_CACHE[cache_key]

    prompt = build_context_hints_prompt(target_language=target_language)
    chunk_payloads = _chunk_lines(numbered_lines, max_chars=2800)
    if not chunk_payloads:
        return ""

    hints: list[str] = []
    for payload in chunk_payloads:
        try:
            result = await state.translation_llm_engine.generate_text(
                text=payload,
                system_prompt=prompt,
                llm_options=config["options"],
            )
            text = str(result or "").strip()
            if text:
                hints.append(text)
        except Exception:
            # Context hints are best-effort; failures should not block segment translation.
            continue
    result = "\n".join(hints).strip()
    _CONTEXT_HINTS_CACHE[cache_key] = result
    return result


def _json_array_from_model_output(raw: str) -> list[dict[str, Any]]:
    text = str(raw or "").strip()
    if not text:
        raise ValueError("empty model output")
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.S | re.I)
    if fenced:
        text = fenced.group(1).strip()
    if not text.startswith("["):
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            text = text[start : end + 1]
    payload = json.loads(text)
    if not isinstance(payload, list):
        raise ValueError("model output is not a JSON array")
    rows: list[dict[str, Any]] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        item_id = str(item.get("id") or "").strip()
        item_text = str(item.get("text") or "").strip()
        if item_id:
            rows.append({"id": item_id, "text": item_text})
    if not rows:
        raise ValueError("model output contains no usable rows")
    return rows


def _target_duration_for_row(row: dict[str, Any]) -> float:
    start_ms = int(row["start_ms"]) if row.get("start_ms") is not None else None
    end_ms = int(row["end_ms"]) if row.get("end_ms") is not None else None
    target_duration_sec = resolve_target_duration_sec(start_ms, end_ms)
    if target_duration_sec is None:
        target_duration_sec = estimate_speaking_seconds(str(row.get("source_text") or ""))
    return clamp_float(float(target_duration_sec), TARGET_DURATION_MIN_SEC, TARGET_DURATION_MAX_SEC)


def _duration_ms_for_row(row: dict[str, Any]) -> int | None:
    start_ms = int(row["start_ms"]) if row.get("start_ms") is not None else None
    end_ms = int(row["end_ms"]) if row.get("end_ms") is not None else None
    if start_ms is not None and end_ms is not None and end_ms >= start_ms:
        return int(end_ms - start_ms)
    return None


def _build_result_row(
    *,
    row: dict[str, Any],
    translated_text: str,
    min_speed: float,
    max_speed: float,
) -> dict[str, Any]:
    target_duration_sec = _target_duration_for_row(row)
    estimated_target_sec = estimate_speaking_seconds(translated_text)
    return {
        "id": str(row.get("id") or ""),
        "index": int(row.get("index") or 0),
        "speaker": str(row.get("speaker") or "narrator"),
        "source_text": str(row.get("source_text") or "").strip(),
        "text": str(translated_text or "").strip(),
        "start_ms": row.get("start_ms"),
        "end_ms": row.get("end_ms"),
        "duration_ms": _duration_ms_for_row(row),
        "target_duration_sec": round(float(target_duration_sec), 3),
        "estimated_duration_sec": round(float(estimated_target_sec), 3),
        "tts_overrides": {},
    }


def _refresh_timing_fields(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    refreshed: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        start_ms = int(item["start_ms"]) if item.get("start_ms") is not None else None
        end_ms = int(item["end_ms"]) if item.get("end_ms") is not None else None
        duration_ms = _duration_ms_for_row(item)
        target_duration_sec = _target_duration_for_row(item)
        estimated_sec = estimate_speaking_seconds(str(item.get("text") or ""))
        item["duration_ms"] = duration_ms
        item["target_duration_sec"] = round(float(target_duration_sec), 3)
        item["estimated_duration_sec"] = round(float(estimated_sec), 3)
        item["start_ms"] = start_ms
        item["end_ms"] = end_ms
        item["tts_overrides"] = dict(item.get("tts_overrides") or {})
        refreshed.append(item)
    return refreshed


def _segment_cache_key(
    *,
    source: str,
    mode: str,
    target_language: str,
    config: dict[str, Any],
    context_hints: str,
    row: dict[str, Any],
    min_speed: float,
    max_speed: float,
) -> str:
    return _sha256_text(
        {
            "version": PROMPT_VERSION,
            "source": source,
            "mode": mode,
            "target_language": target_language,
            "backend": config.get("backend"),
            "model": config.get("model_path") or config.get("api_model") or "",
            "context_hints_hash": hashlib.sha256(str(context_hints or "").encode("utf-8")).hexdigest(),
            "min_speed": min_speed,
            "max_speed": max_speed,
            "segment": {
                "id": row.get("id"),
                "speaker": row.get("speaker"),
                "text": row.get("source_text"),
                "start_ms": row.get("start_ms"),
                "end_ms": row.get("end_ms"),
            },
        }
    )


def _chunk_translation_rows(*, rows: list[dict[str, Any]], backend: str) -> list[list[dict[str, Any]]]:
    if backend == "llama_cpp":
        max_segments = LOCAL_BATCH_SEGMENT_LIMIT
        max_chars = LOCAL_BATCH_CHAR_LIMIT
    else:
        max_segments = API_BATCH_SEGMENT_LIMIT
        max_chars = API_BATCH_CHAR_LIMIT
    chunks: list[list[dict[str, Any]]] = []
    current: list[dict[str, Any]] = []
    current_chars = 0
    for row in rows:
        row_chars = len(str(row.get("source_text") or "")) + 80
        if current and (len(current) >= max_segments or current_chars + row_chars > max_chars):
            chunks.append(current)
            current = [row]
            current_chars = row_chars
        else:
            current.append(row)
            current_chars += row_chars
    if current:
        chunks.append(current)
    return chunks


def _build_batch_payload(rows: list[dict[str, Any]]) -> str:
    payload = []
    for row in rows:
        payload.append(
            {
                "id": str(row.get("id") or ""),
                "speaker": str(row.get("speaker") or "narrator"),
                "text": str(row.get("source_text") or ""),
                "target_duration_sec": round(float(_target_duration_for_row(row)), 3),
            }
        )
    return json.dumps(payload, ensure_ascii=False, indent=2)


async def _maybe_emit(callback: ProgressCallback | None, event: dict[str, Any]) -> None:
    if callback is None:
        return
    result = callback(event)
    if asyncio.iscoroutine(result):
        await result


def _check_canceled(cancel_check: CancelCheck | None) -> None:
    if cancel_check is not None and cancel_check():
        raise asyncio.CancelledError()


def build_translation_config(state, source: str) -> dict[str, Any]:
    cfg = state.orchestrator.config
    if source == "primary_local":
        return {
            "backend": "llama_cpp",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": bool(cfg.enable_llama_cpp_think_mode),
            "api_model": cfg.llm_api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    if source == "secondary_local":
        return {
            "backend": "llama_cpp",
            "model_path": cfg.secondary_llm_model_path,
            "clip_model_path": cfg.secondary_llm_clip_model_path,
            "n_ctx": int(cfg.secondary_llm_n_ctx),
            "n_gpu_layers": int(cfg.secondary_llm_n_gpu_layers),
            "n_threads": int(cfg.secondary_llm_threads),
            "enable_think_mode": bool(cfg.secondary_enable_llama_cpp_think_mode),
            "api_model": cfg.llm_api_model,
            "options": {
                "temperature": float(cfg.secondary_llm_temperature),
                "top_p": float(cfg.secondary_llm_top_p),
                "top_k": int(cfg.secondary_llm_top_k),
                "min_p": float(cfg.secondary_llm_min_p),
                "presence_penalty": float(cfg.secondary_llm_presence_penalty),
                "repeat_penalty": float(cfg.secondary_llm_repeat_penalty),
                "max_tokens": int(cfg.secondary_llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    if source == "openai":
        api_model = cfg.openai_model or cfg.llm_api_model
        return {
            "backend": "openai",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "api_key": cfg.openai_api_key,
            "api_base_url": cfg.openai_base_url,
            "api_model": api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": api_model,
            },
        }
    if source == "openai_compatible":
        api_model = cfg.openai_compatible_model or cfg.llm_api_model
        return {
            "backend": "openai_compatible",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "api_key": cfg.openai_compatible_api_key,
            "api_base_url": cfg.openai_compatible_base_url,
            "api_model": api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": api_model,
            },
        }
    if source == "gemini":
        api_model = cfg.gemini_model or cfg.llm_api_model
        return {
            "backend": "gemini",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "api_key": cfg.gemini_api_key,
            "api_base_url": cfg.gemini_base_url,
            "api_model": api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_key": cfg.gemini_api_key,
                "api_base_url": cfg.gemini_base_url,
                "api_model": api_model,
            },
        }
    raise HTTPException(status_code=400, detail=f"Unsupported translation source: {source}")


async def translate_dubbing_segments_for_state(
    *,
    state,
    source: str,
    target_language: str,
    segments: list[Any],
    mode: str = "translate_polish",
    min_speed: float = DEFAULT_MIN_SPEED,
    max_speed: float = DEFAULT_MAX_SPEED,
    max_concurrency: int = 1,
    progress_callback: ProgressCallback | None = None,
    cancel_check: CancelCheck | None = None,
) -> dict[str, Any]:
    source = (source or "").strip().lower()
    mode = (mode or "translate_polish").strip().lower()
    if mode not in {"passthrough", "polish_only", "translate_polish"}:
        raise HTTPException(status_code=400, detail=f"Unsupported dubbing translation mode: {mode}")
    if mode != "passthrough" and source not in ALLOWED_TRANSLATION_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported translation source: {source}")
    if not segments:
        raise HTTPException(status_code=400, detail="segments is required")
    if min_speed > max_speed:
        raise HTTPException(status_code=400, detail="min_speed must be <= max_speed")
    min_speed = clamp_float(float(min_speed), DEFAULT_MIN_SPEED, DEFAULT_MAX_SPEED)
    max_speed = clamp_float(float(max_speed), DEFAULT_MIN_SPEED, DEFAULT_MAX_SPEED)
    if min_speed > max_speed:
        min_speed = max_speed

    if mode != "passthrough" and (not state.translation_llm_engine.is_loaded or state.translation_engine_source != source):
        raise HTTPException(
            status_code=400,
            detail="Translation engine source mismatch or not loaded. Please load translation engine first.",
        )

    config = build_translation_config(state, source) if mode != "passthrough" else {"backend": "passthrough", "options": {}}
    normalized_segments, dropped_empty = _normalize_input_segments(segments)
    if not normalized_segments:
        raise HTTPException(status_code=400, detail="segments 中没有可用文本（空白片段已过滤）")
    effective_concurrency = max(1, min(8, int(max_concurrency or 1)))
    if config["backend"] == "llama_cpp":
        effective_concurrency = 1
    _check_canceled(cancel_check)
    if mode == "passthrough":
        translated_rows = [
            _build_result_row(
                row=row,
                translated_text=str(row.get("source_text") or "").strip(),
                min_speed=min_speed,
                max_speed=max_speed,
            )
            for row in normalized_segments
        ]
        translated_rows = _refresh_timing_fields(apply_reasonable_dubbing_timeline(translated_rows))
        combined_source = []
        for row in translated_rows:
            speaker = str(row.get("speaker") or "").strip()
            source_text = str(row.get("source_text") or "").strip()
            if source_text:
                combined_source.append(f"{speaker}：{source_text}" if speaker else source_text)
        return {
            "source": source or "passthrough",
            "mode": mode,
            "target_language": target_language,
            "backend": "passthrough",
            "max_concurrency": 1,
            "normalized_segment_count": len(normalized_segments),
            "dropped_empty_segment_count": dropped_empty,
            "cache_hits": 0,
            "translated_segment_count": 0,
            "chunk_count": 0,
            "fallback_chunk_count": 0,
            "over_time_segment_count": 0,
            "context_hints": "",
            "segments": translated_rows,
            "source_text": "\n".join(combined_source),
            "translated_text": "\n".join(combined_source),
        }
    await _maybe_emit(
        progress_callback,
        {
            "type": "dubbing_stage",
            "stage": "context",
            "stage_label": "正在提取术语与上下文",
            "processed": 0,
            "total": len(normalized_segments),
        },
    )
    context_hints = await _collect_context_hints(
        state=state,
        config=config,
        normalized_segments=normalized_segments,
        target_language=target_language,
    )

    async def translate_one(row: dict[str, Any]) -> dict[str, Any]:
        _check_canceled(cancel_check)
        source_text = str(row.get("source_text") or "").strip()
        target_duration_sec = _target_duration_for_row(row)
        prompt = build_dubbing_translate_prompt(
            mode=mode,
            target_language=target_language,
            target_duration_sec=target_duration_sec,
            context_hints=context_hints,
        )
        translated_text = (
            await state.translation_llm_engine.generate_text(
                text=source_text,
                system_prompt=prompt,
                llm_options=config["options"],
            )
        ).strip()
        return _build_result_row(
            row=row,
            translated_text=translated_text or source_text,
            min_speed=min_speed,
            max_speed=max_speed,
        )

    async def translate_batch(chunk: list[dict[str, Any]]) -> list[dict[str, Any]]:
        _check_canceled(cancel_check)
        prompt = build_dubbing_batch_translate_prompt(
            mode=mode,
            target_language=target_language,
            context_hints=context_hints,
        )
        output = await state.translation_llm_engine.generate_text(
            text=_build_batch_payload(chunk),
            system_prompt=prompt,
            llm_options=config["options"],
        )
        parsed = _json_array_from_model_output(output)
        by_id = {str(item["id"]): str(item["text"]) for item in parsed}
        return [
            _build_result_row(
                row=row,
                translated_text=by_id.get(str(row.get("id") or ""), "").strip() or str(row.get("source_text") or "").strip(),
                min_speed=min_speed,
                max_speed=max_speed,
            )
            for row in chunk
        ]

    async def compress_batch(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not rows:
            return []
        _check_canceled(cancel_check)
        payload = [
            {
                "id": str(row.get("id") or ""),
                "text": str(row.get("text") or ""),
                "target_duration_sec": row.get("target_duration_sec"),
            }
            for row in rows
        ]
        try:
            output = await state.translation_llm_engine.generate_text(
                text=json.dumps(payload, ensure_ascii=False, indent=2),
                system_prompt=build_dubbing_batch_compress_prompt(target_language=target_language),
                llm_options=config["options"],
            )
            parsed = _json_array_from_model_output(output)
        except Exception:
            parsed = []
        by_id = {str(item["id"]): str(item["text"]) for item in parsed}
        compressed_rows: list[dict[str, Any]] = []
        for row in rows:
            next_text = by_id.get(str(row.get("id") or "")) or str(row.get("text") or "")
            source_row = {
                "id": row.get("id"),
                "index": row.get("index"),
                "speaker": row.get("speaker"),
                "source_text": row.get("source_text"),
                "start_ms": row.get("start_ms"),
                "end_ms": row.get("end_ms"),
            }
            compressed_rows.append(
                _build_result_row(row=source_row, translated_text=next_text, min_speed=min_speed, max_speed=max_speed)
            )
        return compressed_rows

    cache_hits = 0
    rows_by_id: dict[str, dict[str, Any]] = {}
    rows_to_translate: list[dict[str, Any]] = []
    for row in normalized_segments:
        key = _segment_cache_key(
            source=source,
            mode=mode,
            target_language=target_language,
            config=config,
            context_hints=context_hints,
            row=row,
            min_speed=min_speed,
            max_speed=max_speed,
        )
        row["_cache_key"] = key
        cached = _SEGMENT_TRANSLATION_CACHE.get(key)
        if cached:
            rows_by_id[str(row["id"])] = deepcopy(cached)
            cache_hits += 1
        else:
            rows_to_translate.append(row)

    await _maybe_emit(
        progress_callback,
        {
            "type": "dubbing_stage",
            "stage": "translating",
            "stage_label": "正在批量翻译分段",
            "processed": cache_hits,
            "total": len(normalized_segments),
            "cache_hits": cache_hits,
        },
    )

    chunks = _chunk_translation_rows(rows=rows_to_translate, backend=config["backend"])
    completed = cache_hits
    fallback_chunks = 0

    async def process_chunk(chunk_index: int, chunk: list[dict[str, Any]]) -> list[dict[str, Any]]:
        nonlocal fallback_chunks
        _check_canceled(cancel_check)
        try:
            return await translate_batch(chunk)
        except Exception:
            fallback_chunks += 1
            return [await translate_one(row) for row in chunk]

    semaphore = asyncio.Semaphore(effective_concurrency)

    async def guarded_chunk(chunk_index: int, chunk: list[dict[str, Any]]) -> list[dict[str, Any]]:
        async with semaphore:
            translated = await process_chunk(chunk_index, chunk)
            return translated

    if chunks:
        if effective_concurrency == 1:
            for idx, chunk in enumerate(chunks):
                for translated in await guarded_chunk(idx, chunk):
                    rows_by_id[str(translated["id"])] = translated
                    source_row = next((row for row in chunk if str(row.get("id")) == str(translated["id"])), None)
                    if source_row and source_row.get("_cache_key"):
                        _SEGMENT_TRANSLATION_CACHE[str(source_row["_cache_key"])] = deepcopy(translated)
                completed += len(chunk)
                await _maybe_emit(
                    progress_callback,
                    {
                        "type": "dubbing_progress",
                        "stage": "translating",
                        "processed": completed,
                        "total": len(normalized_segments),
                        "chunk": idx + 1,
                        "total_chunks": len(chunks),
                        "cache_hits": cache_hits,
                    },
                )
        else:
            async def run_and_store(idx: int, chunk: list[dict[str, Any]]) -> None:
                nonlocal completed
                translated_list = await guarded_chunk(idx, chunk)
                for translated in translated_list:
                    rows_by_id[str(translated["id"])] = translated
                    source_row = next((row for row in chunk if str(row.get("id")) == str(translated["id"])), None)
                    if source_row and source_row.get("_cache_key"):
                        _SEGMENT_TRANSLATION_CACHE[str(source_row["_cache_key"])] = deepcopy(translated)
                completed += len(chunk)
                await _maybe_emit(
                    progress_callback,
                    {
                        "type": "dubbing_progress",
                        "stage": "translating",
                        "processed": completed,
                        "total": len(normalized_segments),
                        "chunk": idx + 1,
                        "total_chunks": len(chunks),
                        "cache_hits": cache_hits,
                    },
                )

            await asyncio.gather(*(run_and_store(idx, chunk) for idx, chunk in enumerate(chunks)))

    translated_rows = [
        rows_by_id.get(str(row["id"]))
        or _build_result_row(
            row=row,
            translated_text=str(row.get("source_text") or "").strip(),
            min_speed=min_speed,
            max_speed=max_speed,
        )
        for row in normalized_segments
    ]
    over_time_rows = [
        row
        for row in translated_rows
        if estimate_speaking_seconds(str(row.get("text") or "")) > float(row.get("target_duration_sec") or 0) * float(max_speed)
    ]
    if over_time_rows:
        await _maybe_emit(
            progress_callback,
            {
                "type": "dubbing_stage",
                "stage": "compressing",
                "stage_label": "正在压缩超时片段",
                "processed": len(translated_rows) - len(over_time_rows),
                "total": len(translated_rows),
                "over_time": len(over_time_rows),
            },
        )
        compressed = await compress_batch(over_time_rows)
        compressed_by_id = {str(row.get("id")): row for row in compressed}
        translated_rows = [compressed_by_id.get(str(row.get("id"))) or row for row in translated_rows]
        for row in translated_rows:
            source_row = next((item for item in normalized_segments if str(item.get("id")) == str(row.get("id"))), None)
            if source_row and source_row.get("_cache_key"):
                _SEGMENT_TRANSLATION_CACHE[str(source_row["_cache_key"])] = deepcopy(row)

    translated_rows = _refresh_timing_fields(apply_reasonable_dubbing_timeline(translated_rows))

    combined_source: list[str] = []
    combined_target: list[str] = []
    for row in translated_rows:
        speaker = str(row.get("speaker") or "").strip()
        source_text = str(row.get("source_text") or "").strip()
        translated_text = str(row.get("text") or "").strip()
        source_line = f"{speaker}：{source_text}" if source_text else ""
        target_line = f"{speaker}：{translated_text}" if translated_text else ""
        if source_line:
            combined_source.append(source_line)
        if target_line:
            combined_target.append(target_line)

    state.translation_engine_error = ""
    return {
        "source": source,
        "mode": mode,
        "target_language": target_language,
        "backend": state.translation_llm_engine.backend_name,
        "max_concurrency": effective_concurrency,
        "normalized_segment_count": len(normalized_segments),
        "dropped_empty_segment_count": dropped_empty,
        "cache_hits": cache_hits,
        "translated_segment_count": len(rows_to_translate),
        "chunk_count": len(chunks),
        "fallback_chunk_count": fallback_chunks,
        "over_time_segment_count": len(over_time_rows),
        "context_hints": context_hints,
        "segments": translated_rows,
        "source_text": "\n".join(combined_source),
        "translated_text": "\n".join(combined_target),
    }
