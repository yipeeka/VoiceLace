from __future__ import annotations

from pathlib import Path
from typing import Callable

from .dubbing_timeline_service import (
    filter_model_tts_overrides,
    fingerprint_tts_overrides,
    is_source_timeline_lock_enabled,
)
from .tts_task_service import config_payload_for_segment_cache


def _preset_payload_for_backend(*, preset, tts_backend: str) -> dict:
    if preset is None:
        return {}
    backend = (tts_backend or "omnivoice").strip().lower()
    try:
        if backend == "voxcpm2" and hasattr(preset, "resolved_voxcpm2_profile"):
            return preset.resolved_voxcpm2_profile().model_dump(mode="json")
        if backend == "omnivoice" and hasattr(preset, "resolved_omnivoice_profile"):
            return preset.resolved_omnivoice_profile().model_dump(mode="json")
        return preset.model_dump(mode="json")
    except Exception:
        return {"id": getattr(preset, "id", "")}


def build_synthesis_scan_plan(
    *,
    run_segments: list,
    voice_assignments: dict[str, str],
    presets_by_id: dict,
    config,
    cache_dir: Path,
    is_partial: bool,
    rebuild_full: bool,
    target_segment_ids: set[str],
    output_dir: Path,
    project,
    tts_backend: str,
    tts_model_path: str,
    normalize_segment_tts_overrides: Callable[..., dict],
    segment_cache_key: Callable[..., str],
    hash_payload: Callable[[dict], str],
    resolve_segment_asset_path: Callable[..., Path | None],
) -> dict:
    cached_count = 0
    reused_count = 0
    to_generate_count = 0
    scan_items: list[tuple] = []
    unresolved_non_target_ids: list[str] = []

    config_payload = {}
    if config is not None:
        config_payload = config_payload_for_segment_cache(config)
    config_hash = hash_payload(config_payload)
    source_timeline_lock = is_source_timeline_lock_enabled(config=config, project=project)

    for segment in run_segments:
        normalized_overrides = normalize_segment_tts_overrides(segment)
        model_overrides = filter_model_tts_overrides(normalized_overrides, dubbing_timeline=source_timeline_lock)
        fingerprint_overrides = fingerprint_tts_overrides(
            model_overrides=model_overrides,
            segment=segment,
            dubbing_timeline=source_timeline_lock,
        )
        preset_id = voice_assignments.get(segment.speaker)
        preset = presets_by_id.get(preset_id) if preset_id else None
        preset_payload = _preset_payload_for_backend(preset=preset, tts_backend=tts_backend)
        preset_hash = hash_payload(preset_payload)
        key = segment_cache_key(
            text=segment.text,
            preset=preset,
            config=config,
            tts_backend=tts_backend,
            tts_model_path=tts_model_path,
            tts_overrides=model_overrides,
        )
        fingerprint = segment_cache_key(
            text=segment.text,
            preset=preset,
            config=config,
            tts_backend=tts_backend,
            tts_model_path=tts_model_path,
            tts_overrides=fingerprint_overrides,
        )
        cached_path = cache_dir / f"{key}.wav"
        hit = cached_path.exists() and cached_path.is_file() and cached_path.stat().st_size > 0
        project_asset_path = resolve_segment_asset_path(output_dir=output_dir, project=project, segment_id=segment.id)
        can_reuse = (
            is_partial
            and segment.id not in target_segment_ids
            and project_asset_path is not None
            and project_asset_path.exists()
        )
        if is_partial and rebuild_full and segment.id not in target_segment_ids and not can_reuse and not hit:
            unresolved_non_target_ids.append(segment.id)
        if can_reuse:
            reused_count += 1
        elif hit:
            cached_count += 1
        else:
            to_generate_count += 1
        scan_items.append(
            (
                segment,
                preset,
                preset_id,
                preset_hash,
                model_overrides,
                cached_path,
                hit,
                can_reuse,
                project_asset_path,
                fingerprint,
            )
        )

    return {
        "config_hash": config_hash,
        "cached_count": cached_count,
        "reused_count": reused_count,
        "to_generate_count": to_generate_count,
        "scan_items": scan_items,
        "unresolved_non_target_ids": unresolved_non_target_ids,
    }
