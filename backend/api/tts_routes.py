from __future__ import annotations

import asyncio
import logging
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from backend.models import ExportRequest, SynthesizeRequest
from backend.persistence import load_project
from backend.services import (
    build_project_waveform_response,
    build_tts_status_response,
    build_stale_report,
    create_tts_task_record,
    emit_task_event,
    export_project_archive,
    hash_payload,
    load_project_segment_peaks_payload,
    load_project_waveform_payload,
    normalize_segment_tts_overrides,
    resolve_export_audio_path,
    resolve_export_audio_response_path,
    resolve_project_segment_audio_path,
    resolve_segment_asset_path,
    resolve_segment_peaks_path,
    resolve_subtitle_path,
    resolve_subtitle_response_path,
    run_synthesis_task,
    segment_cache_key,
    should_log_stale_report,
    write_project_archive,
)
from backend.state import get_app_state

router = APIRouter()
logger = logging.getLogger(__name__)


async def _run_synthesis_task(task_id: str, payload: SynthesizeRequest, state) -> None:
    await run_synthesis_task(task_id=task_id, payload=payload, state=state, logger=logger)


@router.post("/synthesize")
async def synthesize(payload: SynthesizeRequest, state=Depends(get_app_state)):
    task_id = str(uuid4())
    state.tts_tasks[task_id] = create_tts_task_record(task_id=task_id, project_id=payload.project_id)
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
    code, payload = build_tts_status_response(task_id, status)
    if code == 200:
        return payload
    return JSONResponse(status_code=code, content=payload)


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
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "canceled", "message": "合成任务已取消"})
        return {"task_id": task_id, "status": "canceled"}
    handle.cancel()
    task["status"] = "cancel_requested"
    await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "cancel_requested", "message": "正在取消合成任务..."})
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
    return build_stale_report(
        output_dir=state.settings.output_dir,
        project=project,
        presets=state.voice_manager.list_presets(),
        config=project.synthesis_config,
        tts_backend=getattr(state.tts_engine, "backend_name", "unknown"),
        tts_model_path=getattr(state.tts_engine, "model_path", "")
        or getattr(state.orchestrator.config, "tts_model_path", ""),
        normalize_segment_tts_overrides=normalize_segment_tts_overrides,
        segment_cache_key=segment_cache_key,
        hash_payload=hash_payload,
        debug_stale_report=should_log_stale_report(state),
        logger=logger,
    )


@router.get("/projects/{project_id}/segments/{segment_id}/audio")
async def get_project_segment_audio(project_id: str, segment_id: str, state=Depends(get_app_state)):
    audio_path = resolve_project_segment_audio_path(
        output_dir=state.settings.output_dir,
        projects_dir=state.settings.projects_dir,
        project_id=project_id,
        segment_id=segment_id,
        resolve_segment_asset_path=resolve_segment_asset_path,
    )
    if audio_path is None or not audio_path.exists():
        raise HTTPException(status_code=404, detail="Project segment audio not found")
    return FileResponse(audio_path, media_type="audio/wav", filename=f"{segment_id}.wav")


@router.get("/projects/{project_id}/segments/{segment_id}/peaks")
async def get_project_segment_peaks(project_id: str, segment_id: str, state=Depends(get_app_state)):
    payload = load_project_segment_peaks_payload(
        output_dir=state.settings.output_dir,
        projects_dir=state.settings.projects_dir,
        project_id=project_id,
        segment_id=segment_id,
        resolve_segment_peaks_path=resolve_segment_peaks_path,
    )
    if payload is None:
        raise HTTPException(status_code=404, detail="Project segment peaks not found")
    return payload


@router.get("/projects/{project_id}/waveform")
async def get_project_waveform(project_id: str, level: int | None = Query(None), state=Depends(get_app_state)):
    try:
        return load_project_waveform_payload(
            output_dir=state.settings.output_dir,
            projects_dir=state.settings.projects_dir,
            project_id=project_id,
            level=level,
            build_project_waveform_response=build_project_waveform_response,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Project full waveform peaks not found")


@router.post("/export")
async def export_audio(payload: ExportRequest, state=Depends(get_app_state)):
    req_format = (payload.format or "wav").lower()
    output, media_type = resolve_export_audio_response_path(
        output_dir=state.settings.output_dir,
        projects_dir=state.settings.projects_dir,
        project_id=payload.project_id,
        req_format=req_format,
        resolve_export_audio_path=resolve_export_audio_path,
    )
    return FileResponse(output, media_type=media_type, filename=output.name)


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
    path = resolve_subtitle_response_path(
        output_dir=state.settings.output_dir,
        projects_dir=state.settings.projects_dir,
        project_id=project_id,
        fmt=fmt,
        resolve_subtitle_path=resolve_subtitle_path,
    )
    if not path.exists():
        raise HTTPException(status_code=404, detail="Subtitle not found")
    media_type = "text/plain; charset=utf-8"
    return FileResponse(path, media_type=media_type, filename=path.name)


@router.get("/export/{project_id}/archive")
async def export_archive(project_id: str, state=Depends(get_app_state)):
    archive_path, manifest, project = export_project_archive(
        output_dir=state.settings.output_dir,
        projects_dir=state.settings.projects_dir,
        project_id=project_id,
        list_presets=state.voice_manager.list_presets,
        write_project_archive=write_project_archive,
    )
    logger.info(
        "Archive exported project_id=%s latest_tts_task_id=%s segment_count=%s preset_count=%s archive=%s",
        project.id,
        manifest.get("latest_tts_task_id"),
        manifest.get("segment_count"),
        manifest.get("preset_count"),
        archive_path.name,
    )

    return FileResponse(archive_path, media_type="application/zip", filename=archive_path.name)
