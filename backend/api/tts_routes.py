from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
import zipfile
import wave
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from backend.engine.mixer_engine import MixerEngine, TimelineEntry
from backend.engine.subtitle_gen import timeline_to_lrc, timeline_to_srt
from backend.models import ExportRequest, SegmentAsset, SynthesizeRequest
from backend.persistence import append_project_event, load_project, project_path, read_project_events, save_project
from backend.state import get_app_state

router = APIRouter()
logger = logging.getLogger(__name__)


def _should_log_stale_report(state) -> bool:
    config = getattr(state, "orchestrator", None)
    config = getattr(config, "config", None)
    return bool(getattr(config, "debug_stale_report", False))


def _segment_cache_key(
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
            preset_payload = preset.model_dump()
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


def _hash_payload(payload: dict) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


def _project_output_root(state, project_id: str) -> Path:
    return state.settings.output_dir / "projects" / project_id


def _project_segments_dir(state, project_id: str) -> Path:
    return _project_output_root(state, project_id) / "segments"


def _project_full_dir(state, project_id: str) -> Path:
    return _project_output_root(state, project_id) / "full"


def _project_subtitles_dir(state, project_id: str) -> Path:
    return _project_output_root(state, project_id) / "subtitles"


def _to_output_relpath(state, path: Path) -> str:
    return path.resolve().relative_to(state.settings.output_dir.resolve()).as_posix()


def _from_output_relpath(state, relpath: str | None) -> Path | None:
    if not relpath:
        return None
    return state.settings.output_dir / relpath


def _resolve_segment_asset_path(state, project, segment_id: str) -> Path | None:
    asset = project.audio_assets.segments.get(segment_id)
    if asset is None:
        return None
    candidate = _from_output_relpath(state, asset.audio_relpath)
    if candidate and candidate.exists():
        return candidate
    return None


def _build_stale_report(state, project, config=None) -> dict:
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
    presets_by_id = {preset.id: preset for preset in state.voice_manager.list_presets()}
    config = config or project.synthesis_config
    tts_backend = getattr(state.tts_engine, "backend_name", "unknown")
    tts_model_path = getattr(state.tts_engine, "model_path", "") or getattr(state.orchestrator.config, "tts_model_path", "")
    items: list[dict] = []
    missing_ids: list[str] = []
    stale_ids: list[str] = []
    ready_ids: list[str] = []

    config_payload = {}
    if config is not None:
        try:
            config_payload = config.model_dump()
        except Exception:
            config_payload = {}
    current_config_hash = _hash_payload(config_payload)
    debug_stale_report = _should_log_stale_report(state)

    for segment in project.script.segments:
        preset_id = project.voice_assignments.get(segment.speaker)
        preset = presets_by_id.get(preset_id) if preset_id else None
        preset_payload = {}
        if preset is not None:
            try:
                preset_payload = preset.model_dump()
            except Exception:
                preset_payload = {"id": getattr(preset, "id", "")}
        current_preset_hash = _hash_payload(preset_payload)
        expected_fingerprint = _segment_cache_key(
            text=segment.text,
            preset=preset,
            config=config,
            tts_backend=tts_backend,
            tts_model_path=tts_model_path,
            tts_overrides=segment.tts_overrides,
        )
        asset = project.audio_assets.segments.get(segment.id)
        current_fingerprint = asset.fingerprint if asset else ""
        audio_path = _from_output_relpath(state, asset.audio_relpath) if asset else None
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
                    if (asset.source_tts_overrides or {}) != (segment.tts_overrides or {}):
                        reasons.append("tts_overrides_changed")
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
                    # Fingerprint already covers text/preset/config/backend/model changes.
                    # If it matches the current expected value, those reasons should not
                    # keep the segment in a stale state after a successful regeneration.
                    if current_fingerprint and current_fingerprint == expected_fingerprint:
                        reasons = [
                            reason for reason in reasons if reason not in fingerprint_covered_reasons
                        ]
                        if raw_reasons and not reasons:
                            if debug_stale_report:
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
                    if debug_stale_report:
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
            if status == "missing":
                if debug_stale_report:
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
    if debug_stale_report:
        logger.info(
            "stale-report summary project_id=%s total=%s ready=%s stale=%s missing=%s",
            project.id,
            report["total"],
            report["ready_count"],
            report["stale_count"],
            report["missing_count"],
        )
    return report


async def _emit(state, task: dict, task_id: str, message: dict) -> None:
    task["events"].append(message)
    if task.get("project_id"):
        append_project_event(
            state.settings.projects_dir,
            task["project_id"],
            {
                "source": "tts",
                "task_id": task_id,
                "status": task.get("status", ""),
                "event": message,
            },
        )
    await state.realtime.publish("tts", task_id, message)


def _public_task(task: dict) -> dict:
    return {
        "task_id": task["task_id"],
        "status": task["status"],
        "segments": task["segments"],
        "project_id": task["project_id"],
        "progress": task["progress"],
        "export_url": task["export_url"],
        "subtitle_srt_url": task.get("subtitle_srt_url", ""),
        "subtitle_lrc_url": task.get("subtitle_lrc_url", ""),
        "scope": task.get("scope", "full"),
        "target_segment_ids": task.get("target_segment_ids", []),
        "generated_count": task.get("generated_count", 0),
        "reused_count": task.get("reused_count", 0),
        "error": task["error"],
    }


def _write_silence_wav(path, duration_ms: int = 1000, sample_rate: int = 22050) -> None:
    frames = max(1, int(sample_rate * (duration_ms / 1000)))
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frames)


def _append_silence(frames: bytearray, duration_ms: int = 500, sample_rate: int = 22050) -> None:
    gap_frames = max(1, int(sample_rate * (duration_ms / 1000)))
    frames.extend(b"\x00\x00" * gap_frames)


def _timeline_from_segment_results(segment_results: list[dict], gap_ms: int) -> list[TimelineEntry]:
    timeline: list[TimelineEntry] = []
    cursor = 0
    for idx, item in enumerate(segment_results):
        duration_ms = int(item.get("duration_ms") or 0)
        start_ms = cursor
        end_ms = start_ms + duration_ms
        timeline.append(
            TimelineEntry(
                segment_id=str(item.get("segment_id", "")),
                speaker=str(item.get("speaker", "narrator")),
                text=str(item.get("text", "")),
                start_ms=start_ms,
                end_ms=end_ms,
                duration_ms=duration_ms,
            )
        )
        cursor = end_ms
        if idx < len(segment_results) - 1:
            cursor += max(0, int(gap_ms))
    return timeline


async def _run_synthesis_task(task_id: str, payload: SynthesizeRequest, state) -> None:
    task = state.tts_tasks[task_id]
    project = load_project(state.settings.projects_dir, payload.project_id)
    presets_by_id = {preset.id: preset for preset in state.voice_manager.list_presets()}
    config = payload.config or project.synthesis_config
    project.synthesis_config = config
    project.status = "synthesizing"
    save_project(state.settings.projects_dir, project)

    output_dir = state.settings.output_dir / task_id
    output_dir.mkdir(parents=True, exist_ok=True)
    project_segments_dir = _project_segments_dir(state, payload.project_id)
    project_segments_dir.mkdir(parents=True, exist_ok=True)
    project_full_dir = _project_full_dir(state, payload.project_id)
    project_full_dir.mkdir(parents=True, exist_ok=True)
    project_subtitles_dir = _project_subtitles_dir(state, payload.project_id)
    project_subtitles_dir.mkdir(parents=True, exist_ok=True)

    cache_dir = state.settings.data_dir / "cache" / "tts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    sample_rate = 22050
    combined_frames = bytearray()
    segment_inputs: list[dict] = []
    segment_assets: dict[str, SegmentAsset] = {}
    target_segment_ids = set(payload.segment_ids or [])
    is_partial = bool(target_segment_ids)
    rebuild_full = bool(payload.rebuild_full) if is_partial else True
    if is_partial:
        existing_ids = {segment.id for segment in project.script.segments}
        invalid_ids = sorted(target_segment_ids - existing_ids)
        if invalid_ids:
            raise HTTPException(status_code=400, detail=f"Invalid segment ids: {invalid_ids[:5]}")
    generated_count = 0
    reused_count = 0

    task["status"] = "running"
    task["scope"] = "partial" if is_partial else "full"
    task["target_segment_ids"] = sorted(target_segment_ids)
    task["rebuild_full"] = rebuild_full
    task["generated_count"] = 0
    task["reused_count"] = 0
    run_segments = (
        project.script.segments
        if (not is_partial or rebuild_full)
        else [segment for segment in project.script.segments if segment.id in target_segment_ids]
    )
    task["progress"] = {"current": 0, "total": len(run_segments)}
    await _emit(state, task, task_id, {"type": "task_status", "status": "running"})
    await _emit(state, task, task_id, {"type": "model_loading", "engine": "tts", "message": "正在加载 TTS..."})

    try:
        await state.orchestrator.ensure_tts_ready()
        await _emit(state, task, task_id, {"type": "model_loaded", "engine": "tts", "backend": state.tts_engine.backend_name})

        total = len(run_segments)
        cached_count = 0
        to_generate_count = 0
        scan_items: list[tuple] = []
        unresolved_non_target_ids: list[str] = []
        tts_backend = getattr(state.tts_engine, "backend_name", "unknown")
        tts_model_path = getattr(state.tts_engine, "model_path", "") or getattr(state.orchestrator.config, "tts_model_path", "")
        config_payload = {}
        if config is not None:
            try:
                config_payload = config.model_dump()
            except Exception:
                config_payload = {}
        config_hash = _hash_payload(config_payload)
        for segment in run_segments:
            preset_id = project.voice_assignments.get(segment.speaker)
            preset = presets_by_id.get(preset_id) if preset_id else None
            preset_payload = {}
            if preset is not None:
                try:
                    preset_payload = preset.model_dump()
                except Exception:
                    preset_payload = {"id": getattr(preset, "id", "")}
            preset_hash = _hash_payload(preset_payload)
            key = _segment_cache_key(
                text=segment.text,
                preset=preset,
                config=config,
                tts_backend=tts_backend,
                tts_model_path=tts_model_path,
                tts_overrides=segment.tts_overrides,
            )
            cached_path = cache_dir / f"{key}.wav"
            hit = cached_path.exists() and cached_path.is_file() and cached_path.stat().st_size > 0
            project_asset_path = _resolve_segment_asset_path(state, project, segment.id)
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
            scan_items.append((segment, preset, cached_path, hit, can_reuse, project_asset_path, key))

        if is_partial and rebuild_full and unresolved_non_target_ids:
            unresolved_preview = ", ".join(unresolved_non_target_ids[:8])
            suffix = "..." if len(unresolved_non_target_ids) > 8 else ""
            raise RuntimeError(
                "局部重生成仅支持目标段重生成。以下非目标段缺少可复用音频/缓存，请先补齐或加入本次重生成："
                f"{unresolved_preview}{suffix}"
            )

        await _emit(
            state,
            task,
            task_id,
            {
                "type": "cache_scan",
                "scope": task["scope"],
                "total": total,
                "cached": cached_count,
                "reused": reused_count,
                "to_generate": to_generate_count,
            },
        )

        for index, segment in enumerate(run_segments):
            await _emit(
                state,
                task,
                task_id,
                {
                    "type": "segment_start",
                    "segment_id": segment.id,
                    "index": index,
                    "total": total,
                    "scope": task["scope"],
                    "speaker": segment.speaker,
                    "text": segment.text,
                },
            )
            segment_path = output_dir / f"{segment.id}.wav"
            _, preset, cached_path, cache_hit, can_reuse, project_asset_path, fingerprint = scan_items[index]
            reused = False
            if can_reuse and project_asset_path is not None:
                shutil.copyfile(project_asset_path, segment_path)
                reused = True
            elif cache_hit:
                shutil.copyfile(cached_path, segment_path)
            else:
                await state.tts_engine.synthesize_to_file(segment.text, segment_path, preset, config)
                if segment_path.exists() and segment_path.stat().st_size > 0:
                    shutil.copyfile(segment_path, cached_path)
                generated_count += 1

            try:
                with wave.open(str(segment_path), "rb") as segment_wav:
                    frame_rate = segment_wav.getframerate()
                    frame_count = segment_wav.getnframes()
                    duration_ms = int((frame_count / frame_rate) * 1000)
                    combined_frames.extend(segment_wav.readframes(frame_count))
            except Exception:
                if cache_hit:
                    await state.tts_engine.synthesize_to_file(segment.text, segment_path, preset, config)
                    if segment_path.exists() and segment_path.stat().st_size > 0:
                        shutil.copyfile(segment_path, cached_path)
                    with wave.open(str(segment_path), "rb") as segment_wav:
                        frame_rate = segment_wav.getframerate()
                        frame_count = segment_wav.getnframes()
                        duration_ms = int((frame_count / frame_rate) * 1000)
                        combined_frames.extend(segment_wav.readframes(frame_count))
                    cache_hit = False
                else:
                    raise

            if rebuild_full and index < total - 1:
                _append_silence(combined_frames, config.gap_duration_ms, sample_rate)

            project_segment_path = project_segments_dir / f"{segment.id}.wav"
            shutil.copyfile(segment_path, project_segment_path)
            segment_assets[segment.id] = SegmentAsset(
                segment_id=segment.id,
                audio_relpath=_to_output_relpath(state, project_segment_path),
                duration_ms=duration_ms,
                fingerprint=fingerprint,
                source_text=segment.text or "",
                source_speaker=segment.speaker or "",
                source_type=segment.type or "",
                source_emotion=segment.emotion or "",
                source_tts_overrides=segment.tts_overrides or {},
                source_voice_preset_id=preset_id,
                source_preset_hash=preset_hash,
                source_config_hash=config_hash,
                source_tts_backend=tts_backend,
                source_tts_model_path=tts_model_path,
                source_task_id=task_id,
                created_at=datetime.now(timezone.utc).isoformat(),
                status="ready",
            )

            segment_result = {
                "segment_id": segment.id,
                "index": index,
                "speaker": segment.speaker,
                "text": segment.text,
                "audio_url": f"/api/v1/tts/synthesize/{task_id}/audio/{segment.id}",
                "status": "done",
                "duration_ms": duration_ms,
                "cached": bool(cache_hit),
                "reused": reused,
            }
            task["segments"][segment.id] = segment_result
            segment_inputs.append(
                {
                    "path": str(segment_path),
                    "segment_id": segment.id,
                    "speaker": segment.speaker,
                    "text": segment.text,
                }
            )
            task["progress"] = {"current": index + 1, "total": total}
            task["generated_count"] = generated_count
            task["reused_count"] = reused_count

            await _emit(state, task, task_id, {"type": "segment_done", "scope": task["scope"], **segment_result, "total": total})
            await _emit(
                state,
                task,
                task_id,
                {"type": "progress", "current": index + 1, "total": total, "percent": int(((index + 1) / max(total, 1)) * 100)},
            )

        final_format = "wav"
        wav_export_path = project_full_dir / "mix.wav"
        mp3_export_path = project_full_dir / "mix.mp3"
        srt_path = project_subtitles_dir / "book.srt"
        lrc_path = project_subtitles_dir / "book.lrc"

        if rebuild_full:
            timeline: list[TimelineEntry] | None = None
            try:
                mixed_audio, timeline = MixerEngine().mix_segments(
                    segment_inputs=segment_inputs,
                    gap_ms=int(config.gap_duration_ms),
                    crossfade_ms=30,
                    normalize=True,
                    target_sample_rate=24000,
                )
                with wav_export_path.open("wb") as wav_out:
                    mixed_audio.export(wav_out, format="wav")
            except Exception:
                with wave.open(str(wav_export_path), "wb") as full_wav:
                    full_wav.setnchannels(1)
                    full_wav.setsampwidth(2)
                    full_wav.setframerate(sample_rate)
                    full_wav.writeframes(bytes(combined_frames) or b"\x00\x00" * sample_rate)
                timeline = _timeline_from_segment_results(list(task["segments"].values()), int(config.gap_duration_ms))

            legacy_wav = state.settings.output_dir / f"{payload.project_id}.wav"
            shutil.copyfile(wav_export_path, legacy_wav)

            srt_path.write_text(timeline_to_srt(timeline or []), encoding="utf-8")
            lrc_path.write_text(timeline_to_lrc(timeline or []), encoding="utf-8")
            shutil.copyfile(srt_path, state.settings.output_dir / f"{payload.project_id}.srt")
            shutil.copyfile(lrc_path, state.settings.output_dir / f"{payload.project_id}.lrc")

            if config.output_format == "mp3":
                converted = False
                try:
                    from pydub import AudioSegment

                    with wav_export_path.open("rb") as wav_in:
                        wav_audio = AudioSegment.from_file(wav_in, format="wav")
                    with mp3_export_path.open("wb") as mp3_out:
                        wav_audio.export(mp3_out, format="mp3")
                    converted = mp3_export_path.exists() and mp3_export_path.stat().st_size > 0
                except Exception:
                    converted = False
                if converted:
                    final_format = "mp3"
                    shutil.copyfile(mp3_export_path, state.settings.output_dir / f"{payload.project_id}.mp3")
                else:
                    await _emit(
                        state,
                        task,
                        task_id,
                        {
                            "type": "model_loaded",
                            "engine": "tts",
                            "message": "MP3 导出失败，已自动回退为 WAV 导出。",
                        },
                    )
            elif mp3_export_path.exists():
                mp3_export_path.unlink(missing_ok=True)
        else:
            existing_mp3 = _from_output_relpath(state, project.audio_assets.full_mp3_relpath)
            existing_wav = _from_output_relpath(state, project.audio_assets.full_wav_relpath)
            if config.output_format == "mp3" and existing_mp3 and existing_mp3.exists():
                final_format = "mp3"
            elif existing_wav and existing_wav.exists():
                final_format = "wav"
            elif existing_mp3 and existing_mp3.exists():
                final_format = "mp3"

        task["status"] = "done"
        task["export_url"] = f"/api/v1/tts/export?project_id={payload.project_id}&format={final_format}"
        task["subtitle_srt_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=srt"
        task["subtitle_lrc_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=lrc"
        if rebuild_full:
            project.audio_assets.latest_task_id = task_id
            project.audio_assets.full_wav_relpath = _to_output_relpath(state, wav_export_path)
            project.audio_assets.full_mp3_relpath = _to_output_relpath(state, mp3_export_path) if mp3_export_path.exists() else None
            project.audio_assets.subtitle_srt_relpath = _to_output_relpath(state, srt_path)
            project.audio_assets.subtitle_lrc_relpath = _to_output_relpath(state, lrc_path)
            project.audio_assets.segments = segment_assets
        else:
            project.audio_assets.latest_task_id = task_id
            project.audio_assets.segments.update(segment_assets)
        project.audio_assets.archive_schema_version = 2
        project.status = "done"
        save_project(state.settings.projects_dir, project)

        await _emit(state, task, task_id, {"type": "complete", "data": _public_task(task)})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        project.status = "voices_configured" if project.voice_assignments else "parsed"
        save_project(state.settings.projects_dir, project)
        await _emit(state, task, task_id, {"type": "canceled", "message": "合成任务已取消"})
        raise
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        project.status = "voices_configured" if project.voice_assignments else "parsed"
        save_project(state.settings.projects_dir, project)
        await _emit(state, task, task_id, {"type": "error", "message": str(exc)})
    finally:
        state.tts_task_handles.pop(task_id, None)


@router.post("/synthesize")
async def synthesize(payload: SynthesizeRequest, state=Depends(get_app_state)):
    task_id = str(uuid4())
    state.tts_tasks[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "segments": {},
        "project_id": payload.project_id,
        "progress": {"current": 0, "total": 0},
        "export_url": "",
        "subtitle_srt_url": "",
        "subtitle_lrc_url": "",
        "error": "",
        "events": [{"type": "task_status", "status": "queued"}],
    }
    handle = asyncio.create_task(_run_synthesis_task(task_id, payload, state))
    state.tts_task_handles[task_id] = handle
    return {"task_id": task_id}


@router.post("/synthesize/segments")
async def synthesize_segments(payload: SynthesizeRequest, state=Depends(get_app_state)):
    if not payload.segment_ids:
        raise HTTPException(status_code=400, detail="segment_ids is required")
    return await synthesize(payload, state)


@router.get("/synthesize/{task_id}")
async def get_synthesis_status(task_id: str, state=Depends(get_app_state)):
    status = state.tts_tasks.get(task_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Synthesis task not found")
    if status["status"] == "error":
        raise HTTPException(status_code=500, detail=status["error"])
    public = _public_task(status)
    if status["status"] != "done":
        return JSONResponse(status_code=202, content=public)
    return public


@router.post("/synthesize/{task_id}/cancel")
async def cancel_synthesis_task(task_id: str, state=Depends(get_app_state)):
    task = state.tts_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Synthesis task not found")
    if task["status"] in {"done", "error", "canceled"}:
        return {"task_id": task_id, "status": task["status"]}
    handle = state.tts_task_handles.get(task_id)
    if handle is None:
        task["status"] = "canceled"
        await _emit(state, task, task_id, {"type": "canceled", "message": "合成任务已取消"})
        return {"task_id": task_id, "status": "canceled"}
    handle.cancel()
    task["status"] = "cancel_requested"
    await _emit(state, task, task_id, {"type": "cancel_requested", "message": "正在取消合成任务..."})
    return {"task_id": task_id, "status": "cancel_requested"}


@router.get("/synthesize/{task_id}/audio/{segment_id}")
async def get_segment_audio(task_id: str, segment_id: str, state=Depends(get_app_state)):
    audio_path = state.settings.output_dir / task_id / f"{segment_id}.wav"
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio segment not found")
    return FileResponse(audio_path, media_type="audio/wav", filename=f"{segment_id}.wav")


@router.get("/projects/{project_id}/stale-report")
async def get_project_stale_report(project_id: str, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    return _build_stale_report(state, project, config=project.synthesis_config)


@router.get("/projects/{project_id}/segments/{segment_id}/audio")
async def get_project_segment_audio(project_id: str, segment_id: str, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    audio_path = _resolve_segment_asset_path(state, project, segment_id)
    if audio_path is None or not audio_path.exists():
        raise HTTPException(status_code=404, detail="Project segment audio not found")
    return FileResponse(audio_path, media_type="audio/wav", filename=f"{segment_id}.wav")


@router.post("/export")
async def export_audio(payload: ExportRequest, state=Depends(get_app_state)):
    req_format = (payload.format or "wav").lower()
    project = load_project(state.settings.projects_dir, payload.project_id)
    output = None
    if req_format == "mp3":
        output = _from_output_relpath(state, project.audio_assets.full_mp3_relpath)
    if output is None:
        output = _from_output_relpath(state, project.audio_assets.full_wav_relpath)
    if output is None:
        output = state.settings.output_dir / f"{payload.project_id}.{req_format}"

    if output.exists():
        media_type = "audio/mpeg" if req_format == "mp3" else "audio/wav"
        return FileResponse(output, media_type=media_type, filename=output.name)

    wav_fallback = state.settings.output_dir / f"{payload.project_id}.wav"
    if wav_fallback.exists():
        return FileResponse(wav_fallback, media_type="audio/wav", filename=wav_fallback.name)

    _write_silence_wav(wav_fallback, duration_ms=1000)
    return FileResponse(wav_fallback, media_type="audio/wav", filename=wav_fallback.name)


@router.get("/export")
async def export_audio_get(
    project_id: str = Query(...),
    format: str = Query("wav"),
    state=Depends(get_app_state),
):
    return await export_audio(ExportRequest(project_id=project_id, format=format), state)


@router.get("/subtitle")
async def get_subtitle(project_id: str = Query(...), format: str = Query("srt"), state=Depends(get_app_state)):
    fmt = (format or "srt").lower()
    if fmt not in {"srt", "lrc"}:
        raise HTTPException(status_code=400, detail="Unsupported subtitle format")
    project = load_project(state.settings.projects_dir, project_id)
    path = _from_output_relpath(
        state,
        project.audio_assets.subtitle_srt_relpath if fmt == "srt" else project.audio_assets.subtitle_lrc_relpath,
    )
    if path is None:
        path = state.settings.output_dir / f"{project_id}.{fmt}"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Subtitle not found")
    media_type = "text/plain; charset=utf-8"
    return FileResponse(path, media_type=media_type, filename=path.name)


@router.get("/export/{project_id}/archive")
async def export_archive(project_id: str, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    events = read_project_events(state.settings.projects_dir, project_id, limit=0)
    latest_task_id = None
    for item in reversed(events):
        if item.get("source") != "tts":
            continue
        event = item.get("event") or {}
        if event.get("type") == "complete" and item.get("task_id"):
            latest_task_id = str(item["task_id"])
            break

    archive_path = state.settings.output_dir / f"{project_id}.archive.zip"
    full_wav = _from_output_relpath(state, project.audio_assets.full_wav_relpath)
    full_mp3 = _from_output_relpath(state, project.audio_assets.full_mp3_relpath)
    subtitle_srt = _from_output_relpath(state, project.audio_assets.subtitle_srt_relpath)
    subtitle_lrc = _from_output_relpath(state, project.audio_assets.subtitle_lrc_relpath)
    segment_assets = list(project.audio_assets.segments.values())
    audio_candidates = [path for path in [full_wav, full_mp3] if path and path.exists()]
    subtitle_candidates = [path for path in [subtitle_srt, subtitle_lrc] if path and path.exists()]
    presets = state.voice_manager.list_presets()
    used_preset_ids = {preset_id for preset_id in project.voice_assignments.values() if preset_id}
    used_presets = [preset for preset in presets if preset.id in used_preset_ids]
    manifest = {
        "schema_version": 2,
        "project_id": project.id,
        "project_name": project.name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latest_tts_task_id": latest_task_id,
        "audio_files": [p.name for p in audio_candidates if p.exists()],
        "subtitle_files": [p.name for p in subtitle_candidates if p.exists()],
        "segment_count": len(segment_assets),
        "preset_count": len(used_presets),
        "has_reference_audio": any(bool(p.ref_audio_path) for p in used_presets),
    }

    with zipfile.ZipFile(archive_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in audio_candidates:
            if path.exists():
                zf.write(path, arcname=f"audio/full/{path.name}")
        for path in subtitle_candidates:
            if path.exists():
                zf.write(path, arcname=f"subtitles/{path.name}")
        for asset in segment_assets:
            segment_path = _from_output_relpath(state, asset.audio_relpath)
            if segment_path and segment_path.exists():
                zf.write(segment_path, arcname=f"audio/segments/{segment_path.name}")
        project_json = project_path(state.settings.projects_dir, project_id)
        if project_json.exists():
            zf.write(project_json, arcname="project/project.json")
        zf.writestr(
            "voices/presets.json",
            json.dumps([preset.model_dump(mode="json") for preset in used_presets], ensure_ascii=False, indent=2),
        )
        for preset in used_presets:
            if not preset.ref_audio_path:
                continue
            ref_path = Path(preset.ref_audio_path)
            if ref_path.exists() and ref_path.is_file():
                zf.write(ref_path, arcname=f"voices/ref/{ref_path.name}")
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    return FileResponse(archive_path, media_type="application/zip", filename=archive_path.name)
