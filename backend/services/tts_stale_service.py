from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .dubbing_timeline_service import (
    filter_model_tts_overrides,
    fingerprint_tts_overrides,
    is_source_timeline_lock_enabled,
    source_target_duration_ms,
)
from .tts_task_service import (
    config_payload_for_segment_cache,
    legacy_segment_cache_key_default_postprocess_config,
    legacy_segment_cache_key_full_config,
)

TIMELINE_TARGET_DURATION_TOLERANCE_MS = 30


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


def from_output_relpath(output_dir: Path, relpath: str | None) -> Path | None:
    if not relpath:
        return None
    return output_dir / relpath


def resolve_segment_asset_path(*, output_dir: Path, project, segment_id: str) -> Path | None:
    asset = project.audio_assets.segments.get(segment_id)
    if asset is None:
        return None
    candidate = from_output_relpath(output_dir, asset.audio_relpath)
    if candidate and candidate.exists():
        return candidate
    return None


def resolve_segment_peaks_path(*, output_dir: Path, project, segment_id: str) -> Path | None:
    asset = project.audio_assets.segments.get(segment_id)
    if asset is None or not asset.peaks_relpath:
        return None
    candidate = from_output_relpath(output_dir, asset.peaks_relpath)
    if candidate and candidate.exists():
        return candidate
    return None


def build_stale_report(
    *,
    output_dir: Path,
    project,
    presets: list,
    config,
    tts_backend: str,
    tts_model_path: str,
    normalize_segment_tts_overrides: Callable[..., dict],
    segment_cache_key: Callable[..., str],
    hash_payload: Callable[[dict], str],
    debug_stale_report: bool = False,
    logger=None,
) -> dict[str, Any]:
    fingerprint_covered_reasons = {
        "text_changed",
        "tts_overrides_changed",
        "voice_assignment_changed",
        "preset_changed",
        "synthesis_config_changed",
        "tts_backend_changed",
        "tts_model_changed",
        "fingerprint_missing",
        "fingerprint_mismatch",
    }
    presets_by_id = {preset.id: preset for preset in presets}
    config = config or project.synthesis_config
    items: list[dict] = []
    missing_ids: list[str] = []
    stale_ids: list[str] = []
    ready_ids: list[str] = []

    config_payload = {}
    if config is not None:
        config_payload = config_payload_for_segment_cache(config)
    current_config_hash = hash_payload(config_payload)
    source_timeline_lock = is_source_timeline_lock_enabled(config=config, project=project)

    for segment in project.script.segments:
        normalized_overrides = normalize_segment_tts_overrides(segment, strict=False)
        model_overrides = filter_model_tts_overrides(normalized_overrides, dubbing_timeline=source_timeline_lock)
        expected_overrides = fingerprint_tts_overrides(
            model_overrides=model_overrides,
            segment=segment,
            dubbing_timeline=source_timeline_lock,
        )
        preset_id = project.voice_assignments.get(segment.speaker)
        preset = presets_by_id.get(preset_id) if preset_id else None
        preset_payload = _preset_payload_for_backend(preset=preset, tts_backend=tts_backend)
        current_preset_hash = hash_payload(preset_payload)
        expected_fingerprint = segment_cache_key(
            text=segment.text,
            preset=preset,
            config=config,
            tts_backend=tts_backend,
            tts_model_path=tts_model_path,
            tts_overrides=expected_overrides,
        )
        legacy_expected_fingerprint = legacy_segment_cache_key_full_config(
            text=segment.text,
            preset=preset,
            config=config,
            tts_backend=tts_backend,
            tts_model_path=tts_model_path,
            tts_overrides=normalized_overrides,
        )
        legacy_default_postprocess_fingerprint = legacy_segment_cache_key_default_postprocess_config(
            text=segment.text,
            preset=preset,
            config=config,
            tts_backend=tts_backend,
            tts_model_path=tts_model_path,
            tts_overrides=normalized_overrides,
        )
        asset = project.audio_assets.segments.get(segment.id)
        current_fingerprint = asset.fingerprint if asset else ""
        audio_path = from_output_relpath(output_dir, asset.audio_relpath) if asset else None
        status = "ready"
        reasons: list[str] = []

        if asset is None:
            status = "missing"
            reasons.append("missing_audio")
            missing_ids.append(segment.id)
        else:
            if audio_path is None or not audio_path.exists():
                status = "missing"
                reasons.append("missing_audio")
                missing_ids.append(segment.id)
            else:
                has_snapshot = bool(
                    current_fingerprint
                    or asset.source_text
                    or asset.source_speaker
                    or asset.source_type
                    or asset.source_emotion
                    or asset.source_tts_overrides
                    or asset.source_voice_preset_id
                    or asset.source_preset_hash
                    or asset.source_config_hash
                    or asset.source_tts_backend
                    or asset.source_tts_model_path
                )
                if has_snapshot:
                    if (asset.source_text or "") != (segment.text or ""):
                        reasons.append("text_changed")
                    if (asset.source_speaker or "") != (segment.speaker or ""):
                        reasons.append("speaker_changed")
                    if (asset.source_type or "") != (segment.type or ""):
                        reasons.append("type_changed")
                    if (asset.source_emotion or "") != (segment.emotion or ""):
                        reasons.append("emotion_changed")
                    if (asset.source_tts_overrides or {}) != model_overrides:
                        reasons.append("tts_overrides_changed")
                    target_duration_ms = source_target_duration_ms(segment) if source_timeline_lock else None
                    if (
                        target_duration_ms is not None
                        and abs(int(getattr(asset, "duration_ms", 0) or 0) - int(target_duration_ms))
                        > TIMELINE_TARGET_DURATION_TOLERANCE_MS
                    ):
                        reasons.append("timeline_target_changed")
                    if (asset.source_voice_preset_id or None) != (preset_id or None):
                        reasons.append("voice_assignment_changed")
                    if asset.source_preset_hash and asset.source_preset_hash != current_preset_hash:
                        reasons.append("preset_changed")
                    if asset.source_config_hash and asset.source_config_hash != current_config_hash:
                        reasons.append("synthesis_config_changed")
                    if asset.source_tts_backend and asset.source_tts_backend != tts_backend:
                        reasons.append("tts_backend_changed")
                    if asset.source_tts_model_path and asset.source_tts_model_path != tts_model_path:
                        reasons.append("tts_model_changed")
                    if not current_fingerprint:
                        reasons.append("fingerprint_missing")
                    elif current_fingerprint != expected_fingerprint and not reasons:
                        reasons.append("fingerprint_mismatch")

                    raw_reasons = list(reasons)
                    fingerprint_candidates = {expected_fingerprint}
                    if not source_timeline_lock:
                        fingerprint_candidates.update({legacy_expected_fingerprint, legacy_default_postprocess_fingerprint})
                    fingerprint_matches = bool(current_fingerprint and current_fingerprint in fingerprint_candidates)
                    if fingerprint_matches:
                        reasons = [reason for reason in reasons if reason not in fingerprint_covered_reasons]
                        if raw_reasons and not reasons and debug_stale_report and logger:
                            logger.info(
                                "stale-report resolved_by_fingerprint_match "
                                "project_id=%s segment_id=%s index=%s speaker=%s "
                                "raw_reasons=%s preset_id=%s source_preset_id=%s "
                                "expected_fingerprint=%s current_fingerprint=%s",
                                project.id,
                                segment.id,
                                segment.index,
                                segment.speaker,
                                raw_reasons,
                                preset_id,
                                asset.source_voice_preset_id,
                                expected_fingerprint,
                                current_fingerprint,
                            )

                if reasons:
                    status = "stale"
                    stale_ids.append(segment.id)
                    if debug_stale_report and logger:
                        logger.info(
                            "stale-report stale "
                            "project_id=%s segment_id=%s index=%s speaker=%s reasons=%s "
                            "preset_id=%s source_preset_id=%s current_preset_hash=%s source_preset_hash=%s "
                            "expected_fingerprint=%s current_fingerprint=%s",
                            project.id,
                            segment.id,
                            segment.index,
                            segment.speaker,
                            reasons,
                            preset_id,
                            asset.source_voice_preset_id,
                            current_preset_hash,
                            asset.source_preset_hash,
                            expected_fingerprint,
                            current_fingerprint,
                        )
                else:
                    ready_ids.append(segment.id)
            if status == "missing" and debug_stale_report and logger:
                logger.info(
                    "stale-report missing "
                    "project_id=%s segment_id=%s index=%s speaker=%s has_asset=%s audio_relpath=%s",
                    project.id,
                    segment.id,
                    segment.index,
                    segment.speaker,
                    bool(asset),
                    asset.audio_relpath if asset else "",
                )

        items.append(
            {
                "segment_id": segment.id,
                "index": segment.index,
                "status": status,
                "reason": reasons[0] if reasons else "",
                "reasons": reasons,
                "expected_fingerprint": expected_fingerprint,
                "current_fingerprint": current_fingerprint,
                "legacy_expected_fingerprint": legacy_expected_fingerprint,
                "legacy_default_postprocess_fingerprint": legacy_default_postprocess_fingerprint,
                "has_audio_file": bool(asset and audio_path and audio_path.exists()),
            }
        )

    report = {
        "project_id": project.id,
        "total": len(project.script.segments),
        "missing_count": len(missing_ids),
        "stale_count": len(stale_ids),
        "ready_count": len(ready_ids),
        "missing_segment_ids": missing_ids,
        "stale_segment_ids": stale_ids,
        "ready_segment_ids": ready_ids,
        "items": items,
    }
    if debug_stale_report and logger:
        logger.info(
            "stale-report summary project_id=%s total=%s ready=%s stale=%s missing=%s",
            project.id,
            report["total"],
            report["ready_count"],
            report["stale_count"],
            report["missing_count"],
        )
    return report
