from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from uuid import uuid4

from fastapi import HTTPException

from backend.engine.mixer_engine import MixerEngine
from backend.engine.waveform_peaks import build_peaks_payload
from backend.models import PostprocessRequest
from backend.persistence import append_project_event, load_project, save_project
from .project_snapshot_service import create_project_snapshot
from .tts_finalize_service import should_use_source_timeline
from .tts_path_service import (
    project_postprocess_assets_dir,
    project_processed_chapters_dir,
    project_processed_dir,
    to_output_relpath,
)
from .tts_runtime_service import emit_task_event
from .tts_task_service import config_payload_for_segment_cache, hash_payload, public_task


def _refresh_segment_source_config_hashes_if_generation_config_unchanged(*, project, next_config) -> None:
    previous_payload = config_payload_for_segment_cache(project.synthesis_config)
    next_payload = config_payload_for_segment_cache(next_config)
    if previous_payload != next_payload:
        return
    next_hash = hash_payload(next_payload)
    for asset in (project.audio_assets.segments or {}).values():
        if asset is not None and getattr(asset, "source_config_hash", ""):
            asset.source_config_hash = next_hash


def _build_segment_inputs(*, project, output_dir: Path) -> list[dict]:
    inputs: list[dict] = []
    for segment in project.script.segments:
        asset = project.audio_assets.segments.get(segment.id)
        if asset is None or not asset.audio_relpath:
            continue
        path = output_dir / asset.audio_relpath
        if not path.exists():
            continue
        inputs.append(
            {
                "segment_id": segment.id,
                "speaker": segment.speaker,
                "text": segment.text,
                "path": str(path),
                "source_start_ms": getattr(segment, "source_start_ms", None),
                "source_end_ms": getattr(segment, "source_end_ms", None),
                "source_duration_ms": getattr(segment, "source_duration_ms", None),
            }
        )
    return inputs


def _build_segment_timeline_ms(*, project, gap_duration_ms: int) -> list[dict]:
    use_source_timeline = should_use_source_timeline(config=project.synthesis_config, project=project)
    timeline: list[dict] = []
    cursor = 0
    for idx, segment in enumerate(project.script.segments):
        asset = project.audio_assets.segments.get(segment.id)
        duration = int(getattr(asset, "duration_ms", 0) or 0)
        if duration <= 0:
            duration = 1
        start = cursor
        if use_source_timeline:
            raw = getattr(segment, "source_start_ms", None)
            try:
                if raw is not None:
                    start = max(0, int(raw))
            except Exception:
                start = cursor
        end = start + duration
        timeline.append(
            {
                "segment_id": segment.id,
                "index": idx,
                "start_ms": start,
                "end_ms": end,
                "duration_ms": duration,
            }
        )
        cursor = max(cursor, end)
        if idx < len(project.script.segments) - 1 and not use_source_timeline:
            cursor += max(0, int(gap_duration_ms))
    return timeline


def _trim_silence(audio, *, threshold_db: int, min_silence_ms: int):
    try:
        from pydub.silence import detect_leading_silence
    except Exception:
        return audio, 0, 0

    leading = int(
        detect_leading_silence(
            audio,
            silence_thresh=int(threshold_db),
            chunk_size=max(1, int(min_silence_ms)),
        )
    )
    trailing = int(
        detect_leading_silence(
            audio.reverse(),
            silence_thresh=int(threshold_db),
            chunk_size=max(1, int(min_silence_ms)),
        )
    )
    if leading <= 0 and trailing <= 0:
        return audio, 0, 0
    if leading + trailing >= len(audio):
        return audio, 0, 0
    end = max(leading, len(audio) - trailing)
    return audio[leading:end], leading, trailing


def _clamp_chapter_markers(project, timeline: list[dict], markers: list[dict]) -> list[dict]:
    if not timeline:
        return []
    index_by_segment_id = {item["segment_id"]: idx for idx, item in enumerate(timeline)}
    cleaned: list[tuple[int, dict]] = []
    for marker in markers:
        marker_id = str(marker.get("id") or "").strip()
        title = str(marker.get("title") or "").strip()
        start_segment_id = str(marker.get("start_segment_id") or "").strip()
        if not marker_id or not start_segment_id:
            continue
        if start_segment_id not in index_by_segment_id:
            continue
        cleaned.append(
            (
                index_by_segment_id[start_segment_id],
                {
                    "id": marker_id,
                    "title": title or f"章节 {len(cleaned) + 1}",
                    "start_segment_id": start_segment_id,
                },
            )
        )
    if not cleaned:
        first_segment_id = timeline[0]["segment_id"]
        return [{"id": "chapter-1", "title": "章节 1", "start_segment_id": first_segment_id}]
    dedup = {}
    for idx, marker in cleaned:
        prev = dedup.get(idx)
        if prev is None:
            dedup[idx] = marker
    ordered = [dedup[idx] for idx in sorted(dedup.keys())]
    return ordered


def _build_chapter_ranges(*, timeline: list[dict], markers: list[dict], trim_leading_ms: int) -> list[dict]:
    index_by_segment_id = {item["segment_id"]: idx for idx, item in enumerate(timeline)}
    starts: list[tuple[int, dict]] = []
    for marker in markers:
        start_segment_id = marker["start_segment_id"]
        starts.append((index_by_segment_id[start_segment_id], marker))
    starts.sort(key=lambda item: item[0])

    chapters: list[dict] = []
    for idx, (start_idx, marker) in enumerate(starts):
        next_start_idx = starts[idx + 1][0] if idx + 1 < len(starts) else len(timeline)
        end_idx = max(start_idx, next_start_idx - 1)
        start_ms = int(timeline[start_idx]["start_ms"]) - int(trim_leading_ms)
        end_ms = int(timeline[end_idx]["end_ms"]) - int(trim_leading_ms)
        start_ms = max(0, start_ms)
        end_ms = max(start_ms + 1, end_ms)
        chapters.append(
            {
                "id": marker["id"],
                "title": marker["title"],
                "start_segment_id": marker["start_segment_id"],
                "end_segment_id": timeline[end_idx]["segment_id"],
                "start_ms": start_ms,
                "end_ms": end_ms,
            }
        )
    return chapters


def _merge_optional_track(audio, *, output_dir: Path, track_config, track_name: str, warnings: list[str]):
    relpath = str(getattr(track_config, "relpath", "") or "").strip()
    if not relpath:
        return audio
    try:
        from pydub import AudioSegment
    except Exception:
        warnings.append(f"{track_name} 混音不可用：缺少 pydub")
        return audio

    path = output_dir / relpath
    if not path.exists():
        warnings.append(f"{track_name} 素材不存在：{relpath}")
        return audio

    try:
        with path.open("rb") as fp:
            layer = AudioSegment.from_file(fp, format=path.suffix.lstrip(".") or None)
        layer = layer.set_channels(audio.channels).set_frame_rate(audio.frame_rate)
        gain_db = float(getattr(track_config, "gain_db", 0.0) or 0.0)
        if gain_db:
            layer = layer + gain_db
        if bool(getattr(track_config, "ducking_enabled", False)):
            ducking_db = abs(float(getattr(track_config, "ducking_db", 8.0) or 8.0))
            layer = _apply_dynamic_ducking(
                voice=audio,
                music=layer,
                ducking_db=ducking_db,
            )
        offset_ms = int(getattr(track_config, "offset_ms", 0) or 0)
        if offset_ms > 0:
            layer = AudioSegment.silent(duration=offset_ms, frame_rate=audio.frame_rate) + layer
        elif offset_ms < 0:
            layer = layer[abs(offset_ms):]
        if bool(getattr(track_config, "loop", True)) and len(layer) > 0:
            repeats = (len(audio) // len(layer)) + 1
            layer = layer * max(1, repeats)
        layer = layer[: len(audio)]
        return audio.overlay(layer)
    except Exception as exc:
        warnings.append(f"{track_name} 混音失败：{exc}")
        return audio


def _apply_dynamic_ducking(*, voice, music, ducking_db: float):
    """Apply lightweight sidechain-like ducking based on speech activity.

    This is a simple chunk-based envelope:
    - detect active speech chunks by dBFS threshold
    - attenuate BGM by ducking_db when active
    - recover using release smoothing to avoid pumping
    """
    from pydub import AudioSegment

    if len(music) <= 0:
        return music

    chunk_ms = 50
    speech_threshold_dbfs = -38.0
    attack_step = 0.65
    release_step = 0.15
    max_cut = max(0.0, float(ducking_db))

    adjusted = AudioSegment.silent(duration=0, frame_rate=music.frame_rate)
    current_cut = 0.0
    total_len = len(music)
    cursor = 0

    while cursor < total_len:
        end = min(total_len, cursor + chunk_ms)
        voice_chunk = voice[cursor:end] if cursor < len(voice) else AudioSegment.silent(duration=end - cursor)
        music_chunk = music[cursor:end]

        is_active = voice_chunk.dBFS != float("-inf") and voice_chunk.dBFS >= speech_threshold_dbfs
        target_cut = max_cut if is_active else 0.0
        step = attack_step if target_cut > current_cut else release_step
        current_cut = current_cut + (target_cut - current_cut) * step

        if current_cut > 0:
            music_chunk = music_chunk.apply_gain(-current_cut)
        adjusted += music_chunk
        cursor = end

    return adjusted.set_channels(voice.channels).set_frame_rate(voice.frame_rate)


def bind_postprocess_asset_to_project(
    *,
    projects_dir: Path,
    output_dir: Path,
    project_id: str,
    asset_type: str,
    source_path: Path,
    delete_source: bool = True,
) -> dict:
    project = load_project(projects_dir, project_id)
    normalized_type = (asset_type or "").strip().lower()
    if normalized_type not in {"bgm", "ambience"}:
        raise HTTPException(status_code=400, detail="asset type 必须为 bgm 或 ambience")

    assets_dir = project_postprocess_assets_dir(output_dir=output_dir, project_id=project_id)
    assets_dir.mkdir(parents=True, exist_ok=True)
    suffix = source_path.suffix or ".wav"
    filename = f"{normalized_type}_{uuid4().hex[:10]}{suffix}"
    target_path = assets_dir / filename
    shutil.copyfile(source_path, target_path)
    if delete_source:
        source_path.unlink(missing_ok=True)

    relpath = to_output_relpath(output_dir=output_dir, path=target_path)
    if normalized_type == "bgm":
        project.synthesis_config.bgm_track.relpath = relpath
    else:
        project.synthesis_config.ambience_track.relpath = relpath
    save_project(projects_dir, project)

    append_project_event(
        projects_dir,
        project_id,
        {
            "source": "tts",
            "kind": "postprocess",
            "event": {
                "type": "postprocess_asset_bound",
                "asset_type": normalized_type,
                "relpath": relpath,
            },
        },
    )
    return {
        "project_id": project_id,
        "asset_type": normalized_type,
        "relpath": relpath,
    }


async def run_postprocess_task(*, task_id: str, payload: PostprocessRequest, state, logger) -> None:
    task = state.tts_tasks[task_id]
    project = load_project(state.settings.projects_dir, payload.project_id)
    create_project_snapshot(state.settings.projects_dir, project, reason="before_postprocess_run")
    config = payload.config or project.synthesis_config
    _refresh_segment_source_config_hashes_if_generation_config_unchanged(project=project, next_config=config)
    project.synthesis_config = config
    save_project(state.settings.projects_dir, project)

    processed_dir = project_processed_dir(output_dir=state.settings.output_dir, project_id=project.id)
    chapters_dir = project_processed_chapters_dir(output_dir=state.settings.output_dir, project_id=project.id)
    processed_dir.mkdir(parents=True, exist_ok=True)
    chapters_dir.mkdir(parents=True, exist_ok=True)

    stages = ["rebuild", "trim", "fade", "loudness", "mix", "encode", "chapter"]
    warnings: list[str] = []

    task["status"] = "running"
    task["scope"] = "postprocess"
    task["progress"] = {"current": 0, "total": len(stages)}
    await emit_task_event(
        state=state,
        task=task,
        task_id=task_id,
        message={"type": "task_status", "status": "running", "kind": "postprocess"},
    )

    try:
        from pydub import AudioSegment
    except Exception as exc:
        task["status"] = "error"
        task["error"] = f"后处理不可用：{exc}"
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "error", "message": task["error"]},
        )
        return

    try:
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "rebuild", "message": "重建基础音轨"},
        )
        segment_inputs = _build_segment_inputs(project=project, output_dir=state.settings.output_dir)
        timeline = _build_segment_timeline_ms(project=project, gap_duration_ms=int(config.gap_duration_ms))
        rebuilt_audio = None
        if segment_inputs and len(segment_inputs) == len(project.script.segments):
            try:
                use_source_timeline = should_use_source_timeline(config=config, project=project)
                rebuilt_audio, _ = MixerEngine().mix_segments(
                    segment_inputs=segment_inputs,
                    gap_ms=int(config.gap_duration_ms),
                    crossfade_ms=0,
                    normalize=False,
                    target_sample_rate=24000,
                    use_source_timeline=use_source_timeline,
                )
            except Exception as exc:
                warnings.append(f"重建音轨失败，已回退原始整轨：{exc}")

        if rebuilt_audio is None:
            raw_wav_path = (
                state.settings.output_dir / project.audio_assets.full_wav_relpath
                if project.audio_assets.full_wav_relpath
                else None
            )
            if raw_wav_path is None or not raw_wav_path.exists():
                raise RuntimeError("缺少原始整轨 WAV，无法执行后处理")
            with raw_wav_path.open("rb") as wav_in:
                rebuilt_audio = AudioSegment.from_file(wav_in, format="wav")

        task["progress"] = {"current": 1, "total": len(stages)}
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "progress", "current": 1, "total": len(stages)},
        )

        trim_leading = 0
        trim_trailing = 0
        if bool(config.trim_silence_enabled):
            await emit_task_event(
                state=state,
                task=task,
                task_id=task_id,
                message={"type": "postprocess_stage", "stage": "trim", "message": "静音裁剪"},
            )
            rebuilt_audio, trim_leading, trim_trailing = _trim_silence(
                rebuilt_audio,
                threshold_db=int(config.trim_threshold_db),
                min_silence_ms=int(config.trim_min_silence_ms),
            )
        task["progress"] = {"current": 2, "total": len(stages)}
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": 2, "total": len(stages)})

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "fade", "message": "应用淡入淡出"},
        )
        fade_in_ms = max(0, int(config.fade_in_ms or 0))
        fade_out_ms = max(0, int(config.fade_out_ms or 0))
        if fade_in_ms > 0:
            rebuilt_audio = rebuilt_audio.fade_in(fade_in_ms)
        if fade_out_ms > 0:
            rebuilt_audio = rebuilt_audio.fade_out(min(fade_out_ms, max(1, len(rebuilt_audio))))
        task["progress"] = {"current": 3, "total": len(stages)}
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": 3, "total": len(stages)})

        if bool(config.loudness_normalize):
            await emit_task_event(
                state=state,
                task=task,
                task_id=task_id,
                message={"type": "postprocess_stage", "stage": "loudness", "message": "响度归一化"},
            )
            if rebuilt_audio.dBFS != float("-inf"):
                gain_db = float(config.target_lufs) - float(rebuilt_audio.dBFS)
                rebuilt_audio = rebuilt_audio.apply_gain(gain_db)
        task["progress"] = {"current": 4, "total": len(stages)}
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": 4, "total": len(stages)})

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "mix", "message": "混入背景与环境音"},
        )
        rebuilt_audio = _merge_optional_track(
            rebuilt_audio,
            output_dir=state.settings.output_dir,
            track_config=config.ambience_track,
            track_name="环境音",
            warnings=warnings,
        )
        rebuilt_audio = _merge_optional_track(
            rebuilt_audio,
            output_dir=state.settings.output_dir,
            track_config=config.bgm_track,
            track_name="背景音乐",
            warnings=warnings,
        )
        task["progress"] = {"current": 5, "total": len(stages)}
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": 5, "total": len(stages)})

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "encode", "message": "导出后处理音频"},
        )
        processed_wav_path = processed_dir / "processed.wav"
        processed_mp3_path = processed_dir / "processed.mp3"
        with processed_wav_path.open("wb") as wav_out:
            rebuilt_audio.export(wav_out, format="wav")

        mp3_ok = False
        try:
            with processed_mp3_path.open("wb") as mp3_out:
                rebuilt_audio.export(mp3_out, format="mp3", bitrate=f"{int(config.mp3_bitrate_kbps)}k")
            mp3_ok = processed_mp3_path.exists() and processed_mp3_path.stat().st_size > 0
        except Exception as exc:
            warnings.append(f"MP3 导出失败，已仅保留 WAV：{exc}")
            mp3_ok = False
        if not mp3_ok and processed_mp3_path.exists():
            processed_mp3_path.unlink(missing_ok=True)

        processed_peaks_path = processed_dir / "processed.peaks.json"
        processed_peaks_payload = build_peaks_payload(wav_path=processed_wav_path, levels=[1024, 2048, 4096])
        processed_peaks_path.write_text(json.dumps(processed_peaks_payload, ensure_ascii=False), encoding="utf-8")

        task["progress"] = {"current": 6, "total": len(stages)}
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": 6, "total": len(stages)})

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "chapter", "message": "导出章节音频"},
        )
        marker_dicts = [marker.model_dump(mode="json") for marker in (config.chapter_markers or [])]
        markers = _clamp_chapter_markers(project, timeline, marker_dicts)
        chapter_ranges = _build_chapter_ranges(timeline=timeline, markers=markers, trim_leading_ms=trim_leading)
        chapter_exports = []
        for chapter in chapter_ranges:
            chapter_wav = chapters_dir / f"{chapter['id']}.wav"
            chapter_mp3 = chapters_dir / f"{chapter['id']}.mp3"
            start_ms = max(0, int(chapter["start_ms"]))
            end_ms = min(int(chapter["end_ms"]), len(rebuilt_audio))
            if end_ms <= start_ms:
                continue
            chapter_audio = rebuilt_audio[start_ms:end_ms]
            with chapter_wav.open("wb") as wav_out:
                chapter_audio.export(wav_out, format="wav")
            chapter_mp3_ok = False
            try:
                with chapter_mp3.open("wb") as mp3_out:
                    chapter_audio.export(mp3_out, format="mp3", bitrate=f"{int(config.mp3_bitrate_kbps)}k")
                chapter_mp3_ok = chapter_mp3.exists() and chapter_mp3.stat().st_size > 0
            except Exception:
                chapter_mp3_ok = False
            if not chapter_mp3_ok and chapter_mp3.exists():
                chapter_mp3.unlink(missing_ok=True)

            chapter_exports.append(
                {
                    "id": chapter["id"],
                    "title": chapter["title"],
                    "start_segment_id": chapter["start_segment_id"],
                    "end_segment_id": chapter["end_segment_id"],
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "duration_ms": end_ms - start_ms,
                    "wav_relpath": to_output_relpath(output_dir=state.settings.output_dir, path=chapter_wav),
                    "mp3_relpath": (
                        to_output_relpath(output_dir=state.settings.output_dir, path=chapter_mp3) if chapter_mp3_ok else None
                    ),
                }
            )

        manifest = {
            "schema_version": 1,
            "task_id": task_id,
            "trim": {"leading_ms": trim_leading, "trailing_ms": trim_trailing},
            "warnings": warnings,
            "chapter_count": len(chapter_exports),
        }
        manifest_path = processed_dir / "processed.manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

        project.audio_assets.processed.full_wav_relpath = to_output_relpath(
            output_dir=state.settings.output_dir,
            path=processed_wav_path,
        )
        project.audio_assets.processed.full_mp3_relpath = (
            to_output_relpath(output_dir=state.settings.output_dir, path=processed_mp3_path) if mp3_ok else None
        )
        project.audio_assets.processed.full_peaks_relpath = to_output_relpath(
            output_dir=state.settings.output_dir,
            path=processed_peaks_path,
        )
        project.audio_assets.processed.manifest_relpath = to_output_relpath(
            output_dir=state.settings.output_dir,
            path=manifest_path,
        )
        project.audio_assets.processed.chapters = chapter_exports
        save_project(state.settings.projects_dir, project)

        task["status"] = "done"
        task["export_url"] = f"/api/v1/tts/export?project_id={project.id}&format=wav&variant=processed"
        task["processed_export_url"] = task["export_url"]
        task["chapter_exports"] = [
            {
                "id": item["id"],
                "title": item["title"],
                "wav_url": f"/api/v1/tts/export/chapter?project_id={project.id}&chapter_id={item['id']}&format=wav&variant=processed",
                "mp3_url": f"/api/v1/tts/export/chapter?project_id={project.id}&chapter_id={item['id']}&format=mp3&variant=processed",
            }
            for item in chapter_exports
        ]
        task["progress"] = {"current": len(stages), "total": len(stages)}
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": len(stages), "total": len(stages)})
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={
                "type": "complete",
                "data": public_task(task),
            },
        )
    except asyncio.CancelledError:
        task["status"] = "canceled"
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "canceled", "message": "后处理任务已取消"},
        )
        raise
    except Exception as exc:
        logger.exception("postprocess task failed task_id=%s", task_id)
        task["status"] = "error"
        task["error"] = str(exc)
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "error", "message": str(exc)},
        )
