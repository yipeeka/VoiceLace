from __future__ import annotations

import math
import re
from typing import Any

TIMELINE_STRETCH_POLICY_VERSION = 1
TIMING_OVERRIDE_FIELDS = {"duration", "speed"}
MODEL_TTS_OVERRIDE_FIELDS = {"denoise", "num_step", "guidance_scale"}
TARGET_DURATION_MIN_SEC = 0.3
TARGET_DURATION_MAX_SEC = 60.0
TIMELINE_DURATION_BUFFER_SEC = 0.1
TIMELINE_EDGE_GUARD_MS = 20
MIN_REASONABLE_RATIO = 0.85


def _coerce_ms(value: Any) -> int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return int(round(number))


def _segment_has_source_timeline(segment: Any) -> bool:
    start_ms = _coerce_ms(getattr(segment, "source_start_ms", None))
    end_ms = _coerce_ms(getattr(segment, "source_end_ms", None))
    return start_ms is not None and end_ms is not None and end_ms > start_ms


def is_dubbing_timeline_project(*, config: Any, project: Any) -> bool:
    metadata = getattr(getattr(project, "script", None), "metadata", {}) or {}
    if bool(metadata.get("dubbing_source")) or bool(metadata.get("subtitle_source")):
        return True
    if not bool(getattr(config, "timeline_lock_enabled", False)):
        return False
    return any(_segment_has_source_timeline(segment) for segment in getattr(getattr(project, "script", None), "segments", []) or [])


def is_source_timeline_lock_enabled(*, config: Any, project: Any) -> bool:
    if not bool(getattr(config, "timeline_lock_enabled", False)):
        return False
    return any(_segment_has_source_timeline(segment) for segment in getattr(getattr(project, "script", None), "segments", []) or [])


def filter_model_tts_overrides(overrides: dict[str, Any] | None, *, dubbing_timeline: bool) -> dict[str, Any]:
    source = dict(overrides or {})
    if not dubbing_timeline:
        return source
    return {key: value for key, value in source.items() if key not in TIMING_OVERRIDE_FIELDS}


def source_target_duration_ms(segment: Any) -> int | None:
    start_ms = _coerce_ms(getattr(segment, "source_start_ms", None))
    end_ms = _coerce_ms(getattr(segment, "source_end_ms", None))
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        return None
    return int(end_ms - start_ms)


def fingerprint_tts_overrides(
    *,
    model_overrides: dict[str, Any] | None,
    segment: Any,
    dubbing_timeline: bool,
) -> dict[str, Any]:
    payload = dict(model_overrides or {})
    if dubbing_timeline:
        target_ms = source_target_duration_ms(segment)
        if target_ms is not None:
            payload["_timeline_target_duration_ms"] = int(target_ms)
            payload["_timeline_stretch_policy_version"] = TIMELINE_STRETCH_POLICY_VERSION
    return payload


def resolve_target_duration_sec(start_ms: int | None, end_ms: int | None) -> float | None:
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        return None
    raw = max(TARGET_DURATION_MIN_SEC, min(TARGET_DURATION_MAX_SEC, (end_ms - start_ms) / 1000.0))
    return max(TARGET_DURATION_MIN_SEC, min(TARGET_DURATION_MAX_SEC, raw - TIMELINE_DURATION_BUFFER_SEC))


def estimate_speaking_seconds(text: str) -> float:
    raw = str(text or "").strip()
    if not raw:
        return 0.4
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", raw))
    latin_tokens = re.findall(r"[A-Za-z0-9']+", raw)
    punctuation = re.findall(r"[，。！？；,.!?;:]", raw)
    base = cjk_count / 4.6 if cjk_count > 0 else max(1, len(latin_tokens)) / 2.8
    pause = len(punctuation) * 0.08
    return max(0.4, min(TARGET_DURATION_MAX_SEC, base + pause))


def _row_timing(row: dict[str, Any]) -> tuple[int, int] | None:
    start_ms = _coerce_ms(row.get("start_ms", row.get("source_start_ms")))
    end_ms = _coerce_ms(row.get("end_ms", row.get("source_end_ms")))
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        return None
    return start_ms, end_ms


def apply_reasonable_dubbing_timeline(
    rows: list[dict[str, Any]],
    *,
    audio_duration_ms: int | None = None,
    text_key: str = "text",
) -> list[dict[str, Any]]:
    adjusted_rows = [dict(row or {}) for row in rows]
    audio_end = _coerce_ms(audio_duration_ms)

    for index, row in enumerate(adjusted_rows):
        timing = _row_timing(row)
        if timing is None:
            continue
        start_ms, end_ms = timing
        current_ms = end_ms - start_ms
        estimated_ms = max(1, int(round(estimate_speaking_seconds(str(row.get(text_key) or row.get("text") or "")) * 1000)))
        minimum_reasonable_ms = max(1, int(round(estimated_ms * MIN_REASONABLE_RATIO)))
        if current_ms >= minimum_reasonable_ms:
            row["duration_ms"] = current_ms
            continue

        previous_end = None
        for prev_index in range(index - 1, -1, -1):
            previous_timing = _row_timing(adjusted_rows[prev_index])
            if previous_timing is not None:
                previous_end = previous_timing[1]
                break
        next_start = None
        for next_index in range(index + 1, len(adjusted_rows)):
            next_timing = _row_timing(adjusted_rows[next_index])
            if next_timing is not None:
                next_start = next_timing[0]
                break

        min_start = max(0, int(previous_end or 0) + TIMELINE_EDGE_GUARD_MS) if previous_end is not None else 0
        max_end = int(next_start) - TIMELINE_EDGE_GUARD_MS if next_start is not None else None
        if audio_end is not None:
            max_end = min(max_end, audio_end) if max_end is not None else audio_end
        if max_end is None:
            max_end = start_ms + estimated_ms
        max_end = max(max_end, start_ms)

        desired_ms = min(estimated_ms, max(1, max_end - min_start))
        extra_ms = max(0, desired_ms - current_ms)
        left_space = max(0, start_ms - min_start)
        right_space = max(0, max_end - end_ms)
        expand_left = min(left_space, extra_ms // 2)
        expand_right = min(right_space, extra_ms - expand_left)
        remaining = extra_ms - expand_left - expand_right
        if remaining > 0:
            add_left = min(left_space - expand_left, remaining)
            expand_left += add_left
            remaining -= add_left
        if remaining > 0:
            add_right = min(right_space - expand_right, remaining)
            expand_right += add_right
            remaining -= add_right

        next_start_ms = max(min_start, start_ms - expand_left)
        next_end_ms = min(max_end, end_ms + expand_right)
        next_duration_ms = max(0, next_end_ms - next_start_ms)
        insufficient_ms = max(0, minimum_reasonable_ms - next_duration_ms)

        row["start_ms"] = next_start_ms
        row["end_ms"] = next_end_ms
        row["duration_ms"] = next_duration_ms
        row["source_start_ms"] = next_start_ms
        row["source_end_ms"] = next_end_ms
        row["source_duration_ms"] = next_duration_ms
        timing_check = dict(row.get("timing_check") or {})
        timing_check["timeline_adjustment"] = {
            "adjusted": bool(next_start_ms != start_ms or next_end_ms != end_ms),
            "original_start_ms": start_ms,
            "original_end_ms": end_ms,
            "original_duration_ms": current_ms,
            "estimated_speaking_ms": estimated_ms,
            "minimum_reasonable_ms": minimum_reasonable_ms,
            "target_duration_ms": next_duration_ms,
            "expanded_before_ms": max(0, start_ms - next_start_ms),
            "expanded_after_ms": max(0, next_end_ms - end_ms),
            "insufficient_ms": insufficient_ms,
        }
        row["timing_check"] = timing_check

    return adjusted_rows
