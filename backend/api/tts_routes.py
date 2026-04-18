from __future__ import annotations

import asyncio
import logging
import shutil
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from backend.models import ExportRequest, SegmentAsset, SynthesizeRequest
from backend.persistence import load_project, save_project
from backend.services import (
    build_project_waveform_response,
    build_tts_status_response,
    build_synthesis_scan_plan,
    build_stale_report,
    create_tts_task_record,
    emit_task_event,
    export_project_archive,
    finalize_rebuild_full,
    load_project_segment_peaks_payload,
    load_project_waveform_payload,
    normalize_segment_tts_overrides,
    project_full_dir as build_project_full_dir,
    project_segment_waveforms_dir as build_project_segment_waveforms_dir,
    project_segments_dir as build_project_segments_dir,
    project_subtitles_dir as build_project_subtitles_dir,
    project_waveforms_dir as build_project_waveforms_dir,
    process_synthesis_segment,
    resolve_export_audio_path,
    resolve_export_audio_response_path,
    resolve_project_segment_audio_path,
    resolve_partial_final_format,
    resolve_segment_asset_path,
    resolve_segment_peaks_path,
    resolve_subtitle_path,
    resolve_subtitle_response_path,
    segment_cache_key,
    should_log_stale_report,
    update_project_audio_assets_after_synthesis,
    write_project_archive,
    hash_payload,
    public_task,
)
from backend.state import get_app_state

router = APIRouter()
logger = logging.getLogger(__name__)


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
    project_segments_dir = build_project_segments_dir(output_dir=state.settings.output_dir, project_id=payload.project_id)
    project_segments_dir.mkdir(parents=True, exist_ok=True)
    project_full_dir = build_project_full_dir(output_dir=state.settings.output_dir, project_id=payload.project_id)
    project_full_dir.mkdir(parents=True, exist_ok=True)
    project_subtitles_dir = build_project_subtitles_dir(output_dir=state.settings.output_dir, project_id=payload.project_id)
    project_subtitles_dir.mkdir(parents=True, exist_ok=True)
    project_waveforms_dir = build_project_waveforms_dir(output_dir=state.settings.output_dir, project_id=payload.project_id)
    project_waveforms_dir.mkdir(parents=True, exist_ok=True)
    project_segment_waveforms_dir = build_project_segment_waveforms_dir(
        output_dir=state.settings.output_dir, project_id=payload.project_id
    )
    project_segment_waveforms_dir.mkdir(parents=True, exist_ok=True)

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
    await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "task_status", "status": "running"})
    await emit_task_event(
        state=state,
        task=task,
        task_id=task_id,
        message={"type": "model_loading", "engine": "tts", "message": "正在加载 TTS..."},
    )

    try:
        await state.orchestrator.ensure_tts_ready()
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "model_loaded", "engine": "tts", "backend": state.tts_engine.backend_name},
        )

        total = len(run_segments)
        tts_backend = getattr(state.tts_engine, "backend_name", "unknown")
        tts_model_path = getattr(state.tts_engine, "model_path", "") or getattr(state.orchestrator.config, "tts_model_path", "")
        scan_plan = build_synthesis_scan_plan(
            run_segments=run_segments,
            voice_assignments=project.voice_assignments,
            presets_by_id=presets_by_id,
            config=config,
            cache_dir=cache_dir,
            is_partial=is_partial,
            rebuild_full=rebuild_full,
            target_segment_ids=target_segment_ids,
            output_dir=state.settings.output_dir,
            project=project,
            tts_backend=tts_backend,
            tts_model_path=tts_model_path,
            normalize_segment_tts_overrides=normalize_segment_tts_overrides,
            segment_cache_key=segment_cache_key,
            hash_payload=hash_payload,
            resolve_segment_asset_path=resolve_segment_asset_path,
        )
        config_hash = scan_plan["config_hash"]
        cached_count = scan_plan["cached_count"]
        reused_count = scan_plan["reused_count"]
        to_generate_count = scan_plan["to_generate_count"]
        scan_items = scan_plan["scan_items"]
        unresolved_non_target_ids = scan_plan["unresolved_non_target_ids"]

        if is_partial and rebuild_full and unresolved_non_target_ids:
            unresolved_preview = ", ".join(unresolved_non_target_ids[:8])
            suffix = "..." if len(unresolved_non_target_ids) > 8 else ""
            raise RuntimeError(
                "局部重生成仅支持目标段重生成。以下非目标段缺少可复用音频/缓存，请先补齐或加入本次重生成："
                f"{unresolved_preview}{suffix}"
            )

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={
                "type": "cache_scan",
                "scope": task["scope"],
                "total": total,
                "cached": cached_count,
                "reused": reused_count,
                "to_generate": to_generate_count,
            },
        )

        for index, segment in enumerate(run_segments):
            await emit_task_event(
                state=state,
                task=task,
                task_id=task_id,
                message={
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
            (
                _,
                preset,
                preset_id,
                preset_hash,
                normalized_overrides,
                cached_path,
                cache_hit,
                can_reuse,
                project_asset_path,
                fingerprint,
            ) = scan_items[index]
            segment_out = await process_synthesis_segment(
                tts_engine=state.tts_engine,
                segment=segment,
                segment_path=segment_path,
                preset=preset,
                config=config,
                normalized_overrides=normalized_overrides,
                cached_path=cached_path,
                cache_hit=cache_hit,
                can_reuse=can_reuse,
                project_asset_path=project_asset_path,
                rebuild_full=rebuild_full,
                index=index,
                total=total,
                combined_frames=combined_frames,
                sample_rate=sample_rate,
                project_segments_dir=project_segments_dir,
                project_segment_waveforms_dir=project_segment_waveforms_dir,
                output_dir=state.settings.output_dir,
                fingerprint=fingerprint,
                preset_id=preset_id,
                preset_hash=preset_hash,
                config_hash=config_hash,
                tts_backend=tts_backend,
                tts_model_path=tts_model_path,
                task_id=task_id,
                gap_duration_ms=int(config.gap_duration_ms),
            )
            segment_assets[segment.id] = segment_out["segment_asset"]
            segment_result = segment_out["segment_result"]
            generated_count += int(segment_out["generated_count_delta"] or 0)
            task["segments"][segment.id] = segment_result
            segment_inputs.append(segment_out["segment_input"])
            task["progress"] = {"current": index + 1, "total": total}
            task["generated_count"] = generated_count
            task["reused_count"] = reused_count

            await emit_task_event(
                state=state,
                task=task,
                task_id=task_id,
                message={"type": "segment_done", "scope": task["scope"], **segment_result, "total": total},
            )
            await emit_task_event(
                state=state,
                task=task,
                task_id=task_id,
                message={"type": "progress", "current": index + 1, "total": total, "percent": int(((index + 1) / max(total, 1)) * 100)},
            )

        final_format = "wav"
        wav_export_path = project_full_dir / "mix.wav"
        mp3_export_path = project_full_dir / "mix.mp3"
        srt_path = project_subtitles_dir / "book.srt"
        lrc_path = project_subtitles_dir / "book.lrc"
        full_peaks_path = project_waveforms_dir / "full.peaks.json"

        if rebuild_full:
            finalize = finalize_rebuild_full(
                output_dir=state.settings.output_dir,
                project_id=payload.project_id,
                config=config,
                segment_inputs=segment_inputs,
                task_segments=task["segments"],
                combined_frames=combined_frames,
                sample_rate=sample_rate,
                wav_export_path=wav_export_path,
                mp3_export_path=mp3_export_path,
                srt_path=srt_path,
                lrc_path=lrc_path,
                full_peaks_path=full_peaks_path,
            )
            final_format = finalize["final_format"]
            if finalize["mp3_fallback_to_wav"]:
                await emit_task_event(
                    state=state,
                    task=task,
                    task_id=task_id,
                    message={
                        "type": "model_loaded",
                        "engine": "tts",
                        "message": "MP3 导出失败，已自动回退为 WAV 导出。",
                    },
                )
        else:
            final_format = resolve_partial_final_format(
                output_dir=state.settings.output_dir,
                project=project,
                output_format=config.output_format,
            )

        task["status"] = "done"
        task["export_url"] = f"/api/v1/tts/export?project_id={payload.project_id}&format={final_format}"
        task["subtitle_srt_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=srt"
        task["subtitle_lrc_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=lrc"
        update_project_audio_assets_after_synthesis(
            project=project,
            task_id=task_id,
            rebuild_full=rebuild_full,
            segment_assets=segment_assets,
            output_dir=state.settings.output_dir,
            wav_export_path=wav_export_path,
            mp3_export_path=mp3_export_path,
            srt_path=srt_path,
            lrc_path=lrc_path,
            full_peaks_path=full_peaks_path,
        )
        project.status = "done"
        save_project(state.settings.projects_dir, project)

        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "complete", "data": public_task(task)})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        project.status = "voices_configured" if project.voice_assignments else "parsed"
        save_project(state.settings.projects_dir, project)
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "canceled", "message": "合成任务已取消"})
        raise
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        project.status = "voices_configured" if project.voice_assignments else "parsed"
        save_project(state.settings.projects_dir, project)
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "error", "message": str(exc)})
    finally:
        state.tts_task_handles.pop(task_id, None)


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
