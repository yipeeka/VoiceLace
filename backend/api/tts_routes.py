from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import logging
from pathlib import Path
import tempfile
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from backend.models import ExportRequest, PostprocessRequest, SynthesizeRequest
from backend.persistence import load_project
from backend.services import (
    bind_postprocess_asset_to_project,
    build_project_waveform_response,
    build_project_waveform_response_for_variant,
    build_tts_status_response,
    build_stale_report,
    create_tts_task_record,
    emit_task_event,
    export_project_archive,
    hash_payload,
    load_project_segment_peaks_payload,
    load_project_waveform_payload,
    load_project_waveform_payload_for_variant,
    normalize_segment_tts_overrides,
    public_task,
    resolve_export_audio_path,
    resolve_export_audio_response_path,
    resolve_project_segment_audio_path,
    resolve_segment_asset_path,
    resolve_segment_peaks_path,
    resolve_subtitle_path,
    resolve_subtitle_response_path,
    run_postprocess_task,
    run_synthesis_task,
    segment_cache_key,
    should_log_stale_report,
    write_project_archive,
    write_extended_export_file,
)
from backend.state import get_app_state

router = APIRouter()
logger = logging.getLogger(__name__)


async def _run_synthesis_task(task_id: str, payload: SynthesizeRequest, state) -> None:
    await run_synthesis_task(task_id=task_id, payload=payload, state=state, logger=logger)


async def _run_postprocess_task(task_id: str, payload: PostprocessRequest, state) -> None:
    await run_postprocess_task(task_id=task_id, payload=payload, state=state, logger=logger)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _refresh_tts_queue_positions(state) -> None:
    async with state.tts_queue_lock:
        for idx, queued_task_id in enumerate(state.tts_queue):
            task = state.tts_tasks.get(queued_task_id)
            if task is not None:
                task["queue_position"] = idx + 1
        running_id = state.tts_queue_running_task_id
        if running_id:
            running_task = state.tts_tasks.get(running_id)
            if running_task is not None:
                running_task["queue_position"] = 0


async def _broadcast_tts_queue_positions(state) -> None:
    async with state.tts_queue_lock:
        queued_ids = list(state.tts_queue)
    for idx, queued_task_id in enumerate(queued_ids):
        task = state.tts_tasks.get(queued_task_id)
        if task is None or task.get("status") != "queued":
            continue
        task["queue_position"] = idx + 1
        await emit_task_event(
            state=state,
            task=task,
            task_id=queued_task_id,
            message={"type": "task_status", "status": "queued", "queue_position": idx + 1},
        )


async def _dispatch_tts_task(task_id: str, state) -> None:
    task = state.tts_tasks.get(task_id)
    if task is None:
        return
    payload = task.get("payload")
    if task.get("kind") == "postprocess":
        await _run_postprocess_task(task_id, payload, state)
        return
    await _run_synthesis_task(task_id, payload, state)


async def _tts_queue_worker(state) -> None:
    while True:
        async with state.tts_queue_lock:
            if state.tts_queue_running_task_id is not None:
                return
            if not state.tts_queue:
                state.tts_queue_worker = None
                return
            task_id = state.tts_queue.pop(0)
            state.tts_queue_running_task_id = task_id
        await _refresh_tts_queue_positions(state)
        await _broadcast_tts_queue_positions(state)
        task = state.tts_tasks.get(task_id)
        if task is None or task.get("status") == "canceled":
            async with state.tts_queue_lock:
                state.tts_queue_running_task_id = None
            continue
        task["started_at"] = _now_iso()
        handle = asyncio.create_task(_dispatch_tts_task(task_id, state))
        state.tts_task_handles[task_id] = handle
        try:
            await handle
        except asyncio.CancelledError:
            pass
        finally:
            task["finished_at"] = task.get("finished_at") or _now_iso()
            state.tts_task_handles.pop(task_id, None)
            async with state.tts_queue_lock:
                state.tts_queue_running_task_id = None
            await _refresh_tts_queue_positions(state)
            await _broadcast_tts_queue_positions(state)


def _ensure_tts_queue_worker(state) -> None:
    worker = getattr(state, "tts_queue_worker", None)
    if worker is None or worker.done():
        state.tts_queue_worker = asyncio.create_task(_tts_queue_worker(state))


async def _enqueue_tts_task(*, state, task_id: str) -> int:
    async with state.tts_queue_lock:
        state.tts_queue.append(task_id)
        queue_position = len(state.tts_queue)
        task = state.tts_tasks.get(task_id)
        if task is not None:
            task["queue_position"] = queue_position
            task["queued_at"] = _now_iso()
    await _refresh_tts_queue_positions(state)
    await _broadcast_tts_queue_positions(state)
    _ensure_tts_queue_worker(state)
    return queue_position


@router.post("/synthesize")
async def synthesize(payload: SynthesizeRequest, state=Depends(get_app_state)):
    task_id = str(uuid4())
    task = create_tts_task_record(task_id=task_id, project_id=payload.project_id, kind="synthesis")
    task["payload"] = payload
    state.tts_tasks[task_id] = task
    queue_position = await _enqueue_tts_task(state=state, task_id=task_id)
    await emit_task_event(
        state=state,
        task=task,
        task_id=task_id,
        message={"type": "task_status", "status": "queued", "queue_position": queue_position},
    )
    return {"task_id": task_id, "queue_position": queue_position}


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
    await _refresh_tts_queue_positions(state)
    code, payload = build_tts_status_response(task_id, status)
    if code == 200:
        return payload
    return JSONResponse(status_code=code, content=payload)


@router.post("/projects/{project_id}/postprocess")
async def start_postprocess(project_id: str, payload: PostprocessRequest | None = None, state=Depends(get_app_state)):
    resolved = payload or PostprocessRequest(project_id=project_id)
    resolved.project_id = project_id
    task_id = str(uuid4())
    task = create_tts_task_record(task_id=task_id, project_id=project_id, kind="postprocess")
    task["payload"] = resolved
    state.tts_tasks[task_id] = task
    queue_position = await _enqueue_tts_task(state=state, task_id=task_id)
    await emit_task_event(
        state=state,
        task=task,
        task_id=task_id,
        message={"type": "task_status", "status": "queued", "kind": "postprocess", "queue_position": queue_position},
    )
    return {"task_id": task_id, "queue_position": queue_position}


@router.get("/postprocess/{task_id}")
async def get_postprocess_status(task_id: str, state=Depends(get_app_state)):
    status = state.tts_tasks.get(task_id)
    if status is None or status.get("kind") != "postprocess":
        raise HTTPException(status_code=404, detail="Postprocess task not found")
    await _refresh_tts_queue_positions(state)
    code, payload = build_tts_status_response(task_id, status)
    if code == 200:
        return payload
    return JSONResponse(status_code=code, content=payload)


@router.get("/queue")
async def get_tts_queue(state=Depends(get_app_state)):
    await _refresh_tts_queue_positions(state)
    running_task_id = state.tts_queue_running_task_id
    running = public_task(state.tts_tasks[running_task_id]) if running_task_id and running_task_id in state.tts_tasks else None
    async with state.tts_queue_lock:
        queued_ids = list(state.tts_queue)
    queued = [public_task(state.tts_tasks[item_id]) for item_id in queued_ids if item_id in state.tts_tasks]
    return {
        "running": running,
        "queued": queued,
        "queued_count": len(queued),
    }


@router.post("/projects/{project_id}/postprocess/assets")
async def upload_postprocess_asset(
    project_id: str,
    type: str = Query(..., description="bgm|ambience"),
    file: UploadFile = File(...),
    state=Depends(get_app_state),
):
    suffix = "".join(Path(file.filename or "").suffixes) or ".wav"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        payload = await file.read()
        tmp.write(payload)
        tmp_path = Path(tmp.name)
    return bind_postprocess_asset_to_project(
        projects_dir=state.settings.projects_dir,
        output_dir=state.settings.output_dir,
        project_id=project_id,
        asset_type=type,
        source_path=tmp_path,
    )


@router.post("/synthesize/{task_id}/cancel")
async def cancel_synthesis_task(task_id: str, state=Depends(get_app_state)):
    task = state.tts_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Synthesis task not found")
    if task["status"] in {"done", "partial_failed", "error", "canceled"}:
        return {"task_id": task_id, "status": task["status"]}
    removed_from_queue = False
    async with state.tts_queue_lock:
        if task_id in state.tts_queue:
            state.tts_queue = [item for item in state.tts_queue if item != task_id]
            removed_from_queue = True
    if removed_from_queue:
        task["status"] = "canceled"
        task["finished_at"] = _now_iso()
        await _refresh_tts_queue_positions(state)
        await _broadcast_tts_queue_positions(state)
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "canceled", "message": "排队任务已取消"},
        )
        return {"task_id": task_id, "status": "canceled"}
    handle = state.tts_task_handles.get(task_id)
    if handle is None:
        task["status"] = "canceled"
        task["finished_at"] = task.get("finished_at") or _now_iso()
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "canceled", "message": "合成任务已取消"})
        return {"task_id": task_id, "status": "canceled"}
    handle.cancel()
    task["status"] = "cancel_requested"
    await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "cancel_requested", "message": "正在取消合成任务..."})
    return {"task_id": task_id, "status": "cancel_requested"}


@router.post("/projects/{project_id}/retry-failed")
async def retry_failed_segments(project_id: str, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    failed_ids = [item.segment_id for item in (project.audio_assets.failed_segments or []) if item.segment_id]
    failed_ids = sorted(set(failed_ids))
    if not failed_ids:
        raise HTTPException(status_code=400, detail="当前项目没有失败段可重试")
    payload = SynthesizeRequest(project_id=project_id, config=project.synthesis_config, segment_ids=failed_ids, rebuild_full=False)
    return await synthesize_segments(payload=payload, state=state)


@router.post("/projects/{project_id}/resume")
async def resume_synthesis(project_id: str, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    synthesis_config = project.synthesis_config
    tts_backend = synthesis_config.get_tts_backend() if synthesis_config else "omnivoice"
    if tts_backend == "voxcpm2":
        tts_model_path = getattr(state.orchestrator.config, "voxcpm_tts_model_path", "")
    else:
        tts_model_path = getattr(state.orchestrator.config, "tts_model_path", "")
    stale_report = build_stale_report(
        output_dir=state.settings.output_dir,
        project=project,
        presets=state.voice_manager.list_presets(),
        config=synthesis_config,
        tts_backend=tts_backend,
        tts_model_path=tts_model_path,
        normalize_segment_tts_overrides=normalize_segment_tts_overrides,
        segment_cache_key=segment_cache_key,
        hash_payload=hash_payload,
        debug_stale_report=should_log_stale_report(state),
        logger=logger,
    )
    stale_ids = list(stale_report.get("stale_segment_ids") or [])
    missing_ids = list(stale_report.get("missing_segment_ids") or [])
    failed_ids = [item.segment_id for item in (project.audio_assets.failed_segments or []) if item.segment_id]
    target_ids = sorted(set(stale_ids + missing_ids + failed_ids))
    if not target_ids:
        raise HTTPException(status_code=400, detail="当前项目没有需要续跑的片段")
    payload = SynthesizeRequest(project_id=project_id, config=project.synthesis_config, segment_ids=target_ids, rebuild_full=True)
    return await synthesize_segments(payload=payload, state=state)


@router.get("/synthesize/{task_id}/audio/{segment_id}")
async def get_segment_audio(task_id: str, segment_id: str, state=Depends(get_app_state)):
    audio_path = state.settings.output_dir / task_id / f"{segment_id}.wav"
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio segment not found")
    return FileResponse(audio_path, media_type="audio/wav", filename=f"{segment_id}.wav")


@router.get("/projects/{project_id}/stale-report")
async def get_project_stale_report(project_id: str, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    synthesis_config = project.synthesis_config
    tts_backend = synthesis_config.get_tts_backend() if synthesis_config else "omnivoice"
    if tts_backend == "voxcpm2":
        tts_model_path = getattr(state.orchestrator.config, "voxcpm_tts_model_path", "")
    else:
        tts_model_path = getattr(state.orchestrator.config, "tts_model_path", "")
    return build_stale_report(
        output_dir=state.settings.output_dir,
        project=project,
        presets=state.voice_manager.list_presets(),
        config=synthesis_config,
        tts_backend=tts_backend,
        tts_model_path=tts_model_path,
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
async def get_project_waveform(
    project_id: str,
    level: int | None = Query(None),
    variant: str = Query("raw"),
    state=Depends(get_app_state),
):
    try:
        normalized_variant = (variant or "raw").lower()
        if normalized_variant == "processed":
            return load_project_waveform_payload_for_variant(
                output_dir=state.settings.output_dir,
                projects_dir=state.settings.projects_dir,
                project_id=project_id,
                level=level,
                variant="processed",
                build_project_waveform_response_for_variant=build_project_waveform_response_for_variant,
            )
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
    variant = (payload.variant or "raw").lower()
    try:
        output, media_type = resolve_export_audio_response_path(
            output_dir=state.settings.output_dir,
            projects_dir=state.settings.projects_dir,
            project_id=payload.project_id,
            req_format=req_format,
            variant=variant,
            resolve_export_audio_path=resolve_export_audio_path,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Export audio not found")
    return FileResponse(output, media_type=media_type, filename=output.name)


@router.get("/export")
async def export_audio_get(
    project_id: str = Query(...),
    format: str = Query("wav"),
    variant: str = Query("raw"),
    state=Depends(get_app_state),
):
    return await export_audio(ExportRequest(project_id=project_id, format=format, variant=variant), state)


@router.get("/export/extended")
async def export_extended(
    project_id: str = Query(...),
    kind: str = Query(..., description="script|timestamp_manifest|chapters|metadata|ffmetadata|capcut|premiere_markers"),
    format: str = Query("json"),
    variant: str = Query("raw"),
    profile: str = Query("podcast", description="podcast|audible"),
    state=Depends(get_app_state),
):
    project = load_project(state.settings.projects_dir, project_id)
    normalized_kind = (kind or "").strip().lower()
    normalized_format = (format or "json").strip().lower()
    normalized_variant = (variant or "raw").strip().lower()
    normalized_profile = (profile or "podcast").strip().lower()
    if normalized_kind == "ffmetadata":
        normalized_format = "txt"
    try:
        output, media_type = write_extended_export_file(
            output_dir=state.settings.output_dir,
            project=project,
            kind=normalized_kind,
            fmt=normalized_format,
            variant=normalized_variant,
            profile=normalized_profile,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return FileResponse(output, media_type=media_type, filename=output.name)


@router.get("/export/chapter")
async def export_chapter_audio(
    project_id: str = Query(...),
    chapter_id: str = Query(...),
    format: str = Query("wav"),
    variant: str = Query("processed"),
    state=Depends(get_app_state),
):
    normalized_variant = (variant or "processed").lower()
    if normalized_variant != "processed":
        raise HTTPException(status_code=400, detail="chapter export 仅支持 processed 变体")
    normalized_format = (format or "wav").lower()
    if normalized_format not in {"wav", "mp3"}:
        raise HTTPException(status_code=400, detail="Unsupported chapter format")

    project = load_project(state.settings.projects_dir, project_id)
    chapter = None
    for item in project.audio_assets.processed.chapters:
        item_id = item.get("id") if isinstance(item, dict) else getattr(item, "id", "")
        if item_id == chapter_id:
            chapter = item
            break
    if chapter is None:
        raise HTTPException(status_code=404, detail="Chapter not found")

    relpath = (
        chapter.get("mp3_relpath") if isinstance(chapter, dict) and normalized_format == "mp3"
        else chapter.get("wav_relpath") if isinstance(chapter, dict)
        else getattr(chapter, "mp3_relpath", None) if normalized_format == "mp3"
        else getattr(chapter, "wav_relpath", None)
    )
    if not relpath:
        raise HTTPException(status_code=404, detail="Chapter format not found")
    output = state.settings.output_dir / relpath
    if not output.exists():
        raise HTTPException(status_code=404, detail="Chapter audio file not found")
    media_type = "audio/mpeg" if normalized_format == "mp3" else "audio/wav"
    return FileResponse(output, media_type=media_type, filename=output.name)


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
