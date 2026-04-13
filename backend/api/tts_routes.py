from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
from datetime import datetime, timezone
import zipfile
import wave
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from backend.engine.mixer_engine import MixerEngine, TimelineEntry
from backend.engine.subtitle_gen import timeline_to_lrc, timeline_to_srt
from backend.models import ExportRequest, SynthesizeRequest
from backend.persistence import append_project_event, load_project, project_path, read_project_events, save_project
from backend.state import get_app_state

router = APIRouter()


def _segment_cache_key(
    *,
    text: str,
    preset,
    config,
    tts_backend: str,
    tts_model_path: str,
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
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


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
    cache_dir = state.settings.data_dir / "cache" / "tts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    sample_rate = 22050
    combined_frames = bytearray()
    segment_inputs: list[dict] = []

    task["status"] = "running"
    task["progress"] = {"current": 0, "total": len(project.script.segments)}
    await _emit(state, task, task_id, {"type": "task_status", "status": "running"})
    await _emit(state, task, task_id, {"type": "model_loading", "engine": "tts", "message": "正在加载 TTS..."})

    try:
        await state.orchestrator.ensure_tts_ready()
        await _emit(state, task, task_id, {"type": "model_loaded", "engine": "tts", "backend": state.tts_engine.backend_name})

        total = len(project.script.segments)
        cached_count = 0
        to_generate_count = 0
        scan_items: list[tuple] = []
        tts_backend = getattr(state.tts_engine, "backend_name", "unknown")
        tts_model_path = getattr(state.tts_engine, "model_path", "")
        for segment in project.script.segments:
            preset_id = project.voice_assignments.get(segment.speaker)
            preset = presets_by_id.get(preset_id) if preset_id else None
            key = _segment_cache_key(
                text=segment.text,
                preset=preset,
                config=config,
                tts_backend=tts_backend,
                tts_model_path=tts_model_path,
            )
            cached_path = cache_dir / f"{key}.wav"
            hit = cached_path.exists() and cached_path.is_file() and cached_path.stat().st_size > 0
            if hit:
                cached_count += 1
            else:
                to_generate_count += 1
            scan_items.append((segment, preset, cached_path, hit))

        await _emit(
            state,
            task,
            task_id,
            {
                "type": "cache_scan",
                "total": total,
                "cached": cached_count,
                "to_generate": to_generate_count,
            },
        )

        for index, segment in enumerate(project.script.segments):
            await _emit(
                state,
                task,
                task_id,
                {
                    "type": "segment_start",
                    "segment_id": segment.id,
                    "index": index,
                    "total": total,
                    "speaker": segment.speaker,
                    "text": segment.text,
                },
            )
            segment_path = output_dir / f"{segment.id}.wav"
            _, preset, cached_path, cache_hit = scan_items[index]
            if cache_hit:
                shutil.copyfile(cached_path, segment_path)
            else:
                await state.tts_engine.synthesize_to_file(segment.text, segment_path, preset, config)
                if segment_path.exists() and segment_path.stat().st_size > 0:
                    shutil.copyfile(segment_path, cached_path)

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

            if index < total - 1:
                _append_silence(combined_frames, config.gap_duration_ms, sample_rate)

            segment_result = {
                "segment_id": segment.id,
                "index": index,
                "speaker": segment.speaker,
                "text": segment.text,
                "audio_url": f"/api/v1/tts/synthesize/{task_id}/audio/{segment.id}",
                "status": "done",
                "duration_ms": duration_ms,
                "cached": bool(cache_hit),
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

            await _emit(state, task, task_id, {"type": "segment_done", **segment_result, "total": total})
            await _emit(
                state,
                task,
                task_id,
                {"type": "progress", "current": index + 1, "total": total, "percent": int(((index + 1) / max(total, 1)) * 100)},
            )

        wav_export_path = state.settings.output_dir / f"{payload.project_id}.wav"
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

        srt_path = state.settings.output_dir / f"{payload.project_id}.srt"
        lrc_path = state.settings.output_dir / f"{payload.project_id}.lrc"
        srt_path.write_text(timeline_to_srt(timeline or []), encoding="utf-8")
        lrc_path.write_text(timeline_to_lrc(timeline or []), encoding="utf-8")

        final_format = "wav"
        if config.output_format == "mp3":
            mp3_export_path = state.settings.output_dir / f"{payload.project_id}.mp3"
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

        task["status"] = "done"
        task["export_url"] = f"/api/v1/tts/export?project_id={payload.project_id}&format={final_format}"
        task["subtitle_srt_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=srt"
        task["subtitle_lrc_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=lrc"
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


@router.post("/export")
async def export_audio(payload: ExportRequest, state=Depends(get_app_state)):
    req_format = (payload.format or "wav").lower()
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
    segment_dir = state.settings.output_dir / (latest_task_id or "")

    audio_candidates = [
        state.settings.output_dir / f"{project_id}.wav",
        state.settings.output_dir / f"{project_id}.mp3",
    ]
    subtitle_candidates = [
        state.settings.output_dir / f"{project_id}.srt",
        state.settings.output_dir / f"{project_id}.lrc",
    ]
    manifest = {
        "project_id": project.id,
        "project_name": project.name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latest_tts_task_id": latest_task_id,
        "audio_files": [p.name for p in audio_candidates if p.exists()],
        "subtitle_files": [p.name for p in subtitle_candidates if p.exists()],
    }

    with zipfile.ZipFile(archive_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in audio_candidates:
            if path.exists():
                zf.write(path, arcname=f"audio/{path.name}")
        for path in subtitle_candidates:
            if path.exists():
                zf.write(path, arcname=f"subtitles/{path.name}")
        project_json = project_path(state.settings.projects_dir, project_id)
        if project_json.exists():
            zf.write(project_json, arcname="project/project.json")
        if segment_dir.exists() and segment_dir.is_dir():
            for wav in sorted(segment_dir.glob("*.wav")):
                zf.write(wav, arcname=f"segments/{wav.name}")
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    return FileResponse(archive_path, media_type="application/zip", filename=archive_path.name)
