from __future__ import annotations

import hashlib
import json


def segment_cache_key(
    *,
    text: str,
    preset,
    config,
    tts_backend: str,
    tts_model_path: str,
    tts_overrides: dict | None = None,
) -> str:
    preset_payload = {}
    if preset is not None:
        try:
            backend = (tts_backend or "omnivoice").strip().lower()
            if backend == "voxcpm2" and hasattr(preset, "resolved_voxcpm2_profile"):
                preset_payload = preset.resolved_voxcpm2_profile().model_dump(mode="json")
            elif backend == "omnivoice" and hasattr(preset, "resolved_omnivoice_profile"):
                preset_payload = preset.resolved_omnivoice_profile().model_dump(mode="json")
            else:
                preset_payload = preset.model_dump(mode="json")
        except Exception:
            preset_payload = {"id": getattr(preset, "id", "")}
    config_payload = {}
    if config is not None:
        try:
            config_payload = config.model_dump()
        except Exception:
            config_payload = {}
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
        "error": task["error"],
    }
