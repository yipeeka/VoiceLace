from __future__ import annotations

import hashlib
import json


POSTPROCESS_CONFIG_KEYS = {
    "postprocess_enabled",
    "loudness_normalize",
    "target_lufs",
    "trim_silence_enabled",
    "trim_threshold_db",
    "trim_min_silence_ms",
    "fade_in_ms",
    "fade_out_ms",
    "mp3_bitrate_kbps",
    "chapter_markers",
    "bgm_track",
    "ambience_track",
}


def config_payload_for_segment_cache(config) -> dict:
    if config is None:
        return {}
    try:
        payload = config.model_dump()
    except Exception:
        payload = dict(config) if isinstance(config, dict) else {}
    return {key: value for key, value in payload.items() if key not in POSTPROCESS_CONFIG_KEYS}


def full_config_payload(config) -> dict:
    if config is None:
        return {}
    try:
        return config.model_dump()
    except Exception:
        return dict(config) if isinstance(config, dict) else {}


def _preset_payload_for_backend(*, preset, tts_backend: str) -> dict:
    if preset is None:
        return {}
    try:
        backend = (tts_backend or "omnivoice").strip().lower()
        if backend == "voxcpm2" and hasattr(preset, "resolved_voxcpm2_profile"):
            return preset.resolved_voxcpm2_profile().model_dump(mode="json")
        if backend == "omnivoice" and hasattr(preset, "resolved_omnivoice_profile"):
            return preset.resolved_omnivoice_profile().model_dump(mode="json")
        return preset.model_dump(mode="json")
    except Exception:
        return {"id": getattr(preset, "id", "")}


def _segment_cache_key_from_payload(
    *,
    text: str,
    preset_payload: dict,
    config_payload: dict,
    tts_backend: str,
    tts_model_path: str,
    tts_overrides: dict | None = None,
) -> str:
    blob = json.dumps(
        {
            "text": text,
            "preset": preset_payload,
            "config": config_payload,
            "tts_backend": tts_backend,
            "tts_model_path": tts_model_path,
            "tts_overrides": tts_overrides or {},
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


def segment_cache_key(
    *,
    text: str,
    preset,
    config,
    tts_backend: str,
    tts_model_path: str,
    tts_overrides: dict | None = None,
) -> str:
    return _segment_cache_key_from_payload(
        text=text,
        preset_payload=_preset_payload_for_backend(preset=preset, tts_backend=tts_backend),
        config_payload=config_payload_for_segment_cache(config),
        tts_backend=tts_backend,
        tts_model_path=tts_model_path,
        tts_overrides=tts_overrides,
    )


def legacy_segment_cache_key_full_config(
    *,
    text: str,
    preset,
    config,
    tts_backend: str,
    tts_model_path: str,
    tts_overrides: dict | None = None,
) -> str:
    return _segment_cache_key_from_payload(
        text=text,
        preset_payload=_preset_payload_for_backend(preset=preset, tts_backend=tts_backend),
        config_payload=full_config_payload(config),
        tts_backend=tts_backend,
        tts_model_path=tts_model_path,
        tts_overrides=tts_overrides,
    )


def legacy_segment_cache_key_default_postprocess_config(
    *,
    text: str,
    preset,
    config,
    tts_backend: str,
    tts_model_path: str,
    tts_overrides: dict | None = None,
) -> str:
    payload = full_config_payload(config)
    try:
        default_payload = type(config)().model_dump() if config is not None else {}
    except Exception:
        default_payload = {}
    for key in POSTPROCESS_CONFIG_KEYS:
        if key in default_payload:
            payload[key] = default_payload[key]
        else:
            payload.pop(key, None)
    return _segment_cache_key_from_payload(
        text=text,
        preset_payload=_preset_payload_for_backend(preset=preset, tts_backend=tts_backend),
        config_payload=payload,
        tts_backend=tts_backend,
        tts_model_path=tts_model_path,
        tts_overrides=tts_overrides,
    )


def hash_payload(payload: dict) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


def public_task(task: dict) -> dict:
    return {
        "task_id": task["task_id"],
        "kind": task.get("kind", "synthesis"),
        "status": task["status"],
        "segments": task["segments"],
        "project_id": task["project_id"],
        "progress": task["progress"],
        "export_url": task["export_url"],
        "processed_export_url": task.get("processed_export_url", ""),
        "chapter_exports": task.get("chapter_exports", []),
        "subtitle_srt_url": task.get("subtitle_srt_url", ""),
        "subtitle_lrc_url": task.get("subtitle_lrc_url", ""),
        "scope": task.get("scope", "full"),
        "target_segment_ids": task.get("target_segment_ids", []),
        "generated_count": task.get("generated_count", 0),
        "reused_count": task.get("reused_count", 0),
        "queue_position": int(task.get("queue_position", 0) or 0),
        "queued_at": task.get("queued_at", ""),
        "started_at": task.get("started_at", ""),
        "finished_at": task.get("finished_at", ""),
        "failed_count": int(task.get("failed_count", 0) or 0),
        "retry_count": int(task.get("retry_count", 0) or 0),
        "effective_segment_concurrency": int(task.get("effective_segment_concurrency", 1) or 1),
        "background_relpath": task.get("background_relpath", ""),
        "warnings": list(task.get("warnings", []) or []),
        "error": task["error"],
    }
