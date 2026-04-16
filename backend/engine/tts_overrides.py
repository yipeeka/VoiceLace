from __future__ import annotations

from typing import Any


SUPPORTED_TTS_OVERRIDES = (
    "speed",
    "duration",
    "denoise",
    "num_step",
    "guidance_scale",
)


def _ensure_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"tts_overrides.{field} must be a number")
    return float(value)


def normalize_tts_overrides(tts_overrides: dict[str, Any] | None) -> dict[str, Any]:
    if tts_overrides is None:
        return {}
    if not isinstance(tts_overrides, dict):
        raise ValueError("tts_overrides must be a JSON object")

    unknown_fields = sorted(set(tts_overrides) - set(SUPPORTED_TTS_OVERRIDES))
    if unknown_fields:
        raise ValueError(f"Unsupported tts_overrides field: {', '.join(unknown_fields)}")

    normalized: dict[str, Any] = {}

    if "speed" in tts_overrides:
        speed = _ensure_number(tts_overrides["speed"], "speed")
        if not 0.5 <= speed <= 2.0:
            raise ValueError("tts_overrides.speed must be between 0.5 and 2.0")
        normalized["speed"] = speed

    if "duration" in tts_overrides:
        duration = _ensure_number(tts_overrides["duration"], "duration")
        if not 0.0 < duration <= 60.0:
            raise ValueError("tts_overrides.duration must be between 0 and 60")
        normalized["duration"] = duration

    if "denoise" in tts_overrides:
        denoise = tts_overrides["denoise"]
        if not isinstance(denoise, bool):
            raise ValueError("tts_overrides.denoise must be a boolean")
        normalized["denoise"] = denoise

    if "num_step" in tts_overrides:
        num_step = tts_overrides["num_step"]
        if isinstance(num_step, bool) or not isinstance(num_step, int):
            raise ValueError("tts_overrides.num_step must be an integer")
        if not 1 <= num_step <= 128:
            raise ValueError("tts_overrides.num_step must be between 1 and 128")
        normalized["num_step"] = num_step

    if "guidance_scale" in tts_overrides:
        guidance_scale = _ensure_number(tts_overrides["guidance_scale"], "guidance_scale")
        if not 0.0 <= guidance_scale <= 10.0:
            raise ValueError("tts_overrides.guidance_scale must be between 0 and 10")
        normalized["guidance_scale"] = guidance_scale

    return normalized
