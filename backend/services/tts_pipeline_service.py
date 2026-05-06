from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from fastapi import HTTPException

from backend.engine.tts_engine import TTSEngine
from backend.models import FailedSegmentAsset, SegmentAsset, SynthesizeRequest
from backend.persistence import load_project, save_project
from .project_snapshot_service import create_project_snapshot

from .tts_finalize_service import finalize_rebuild_full, resolve_partial_final_format, update_project_audio_assets_after_synthesis
from .tts_path_service import (
    project_full_dir as build_project_full_dir,
    project_segment_waveforms_dir as build_project_segment_waveforms_dir,
    project_segments_dir as build_project_segments_dir,
    project_subtitles_dir as build_project_subtitles_dir,
    project_waveforms_dir as build_project_waveforms_dir,
)
from .tts_runtime_service import emit_task_event, normalize_segment_tts_overrides
from .tts_scan_service import build_synthesis_scan_plan
from .tts_segment_service import process_synthesis_segment
from .tts_stale_service import resolve_segment_asset_path
from .tts_task_service import hash_payload, public_task, segment_cache_key


async def run_synthesis_task(*, task_id: str, payload: SynthesizeRequest, state, logger) -> None:
    task = state.tts_tasks[task_id]
    project = load_project(state.settings.projects_dir, payload.project_id)
    create_project_snapshot(state.settings.projects_dir, project, reason="before_synthesis_run")
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
    sample_rate: int = getattr(state.tts_engine, "sample_rate", TTSEngine.SAMPLE_RATE)
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
    failed_count = 0
    retry_count = 0
    retry_attempts = max(0, int(getattr(config, "tts_retry_attempts", 2) or 0))
    auto_retry = bool(getattr(config, "tts_auto_retry", True))
    effective_segment_concurrency = 1

    task["status"] = "running"
    task["scope"] = "partial" if is_partial else "full"
    task["target_segment_ids"] = sorted(target_segment_ids)
    task["rebuild_full"] = rebuild_full
    task["generated_count"] = 0
    task["reused_count"] = 0
    task["failed_count"] = 0
    task["retry_count"] = 0
    task["effective_segment_concurrency"] = effective_segment_concurrency
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
        target_tts_backend = config.get_tts_backend() if config is not None else "omnivoice"
        await state.orchestrator.ensure_tts_ready(tts_backend=target_tts_backend)
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "model_loaded", "engine": "tts", "backend": state.tts_engine.backend_name},
        )

        total = len(run_segments)
        tts_backend = target_tts_backend
        if tts_backend == "voxcpm2":
            tts_model_path = (
                getattr(state.tts_engine, "model_path", "")
                or getattr(state.orchestrator.config, "voxcpm_tts_model_path", "")
            )
        else:
            tts_model_path = (
                getattr(state.tts_engine, "model_path", "")
                or getattr(state.orchestrator.config, "tts_model_path", "")
            )
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
            segment_out = None
            last_exc: Exception | None = None
            attempts_used = 0
            max_attempts = 1 + retry_attempts if auto_retry else 1
            for attempt_index in range(max_attempts):
                attempts_used = attempt_index + 1
                try:
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
                    break
                except Exception as exc:
                    last_exc = exc
                    if attempt_index < max_attempts - 1:
                        retry_count += 1
                        await emit_task_event(
                            state=state,
                            task=task,
                            task_id=task_id,
                            message={
                                "type": "segment_retry",
                                "segment_id": segment.id,
                                "index": index,
                                "attempt": attempt_index + 2,
                                "max_attempts": max_attempts,
                                "message": str(exc),
                            },
                        )
                        continue
            if segment_out is None:
                failed_count += 1
                fail_message = str(last_exc) if last_exc is not None else "unknown synthesis error"
                task["segments"][segment.id] = {
                    "segment_id": segment.id,
                    "index": index,
                    "speaker": segment.speaker,
                    "text": segment.text,
                    "status": "failed",
                    "error": fail_message,
                    "attempts": attempts_used,
                    "fingerprint": fingerprint,
                }
                await emit_task_event(
                    state=state,
                    task=task,
                    task_id=task_id,
                    message={
                        "type": "segment_failed",
                        "segment_id": segment.id,
                        "index": index,
                        "speaker": segment.speaker,
                        "text": segment.text,
                        "status": "failed",
                        "error": fail_message,
                        "attempts": attempts_used,
                    },
                )
                task["progress"] = {"current": index + 1, "total": total}
                task["generated_count"] = generated_count
                task["reused_count"] = reused_count
                task["failed_count"] = failed_count
                task["retry_count"] = retry_count
                await emit_task_event(
                    state=state,
                    task=task,
                    task_id=task_id,
                    message={
                        "type": "progress",
                        "current": index + 1,
                        "total": total,
                        "percent": int(((index + 1) / max(total, 1)) * 100),
                        "failed_count": failed_count,
                        "retry_count": retry_count,
                    },
                )
                continue

            segment_assets[segment.id] = segment_out["segment_asset"]
            segment_result = segment_out["segment_result"]
            generated_count += int(segment_out["generated_count_delta"] or 0)
            if "frame_rate" in segment_out and int(segment_out["frame_rate"]) > 0:
                sample_rate = int(segment_out["frame_rate"])
            task["segments"][segment.id] = segment_result
            segment_inputs.append(segment_out["segment_input"])
            task["progress"] = {"current": index + 1, "total": total}
            task["generated_count"] = generated_count
            task["reused_count"] = reused_count
            task["failed_count"] = failed_count
            task["retry_count"] = retry_count

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
                message={
                    "type": "progress",
                    "current": index + 1,
                    "total": total,
                    "percent": int(((index + 1) / max(total, 1)) * 100),
                    "failed_count": failed_count,
                    "retry_count": retry_count,
                },
            )

        final_format = "wav"
        wav_export_path = project_full_dir / "mix.wav"
        mp3_export_path = project_full_dir / "mix.mp3"
        srt_path = project_subtitles_dir / "book.srt"
        lrc_path = project_subtitles_dir / "book.lrc"
        full_peaks_path = project_waveforms_dir / "full.peaks.json"

        can_rebuild_full = rebuild_full and failed_count == 0
        if can_rebuild_full:
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

        task["status"] = "partial_failed" if failed_count > 0 else "done"
        task["export_url"] = f"/api/v1/tts/export?project_id={payload.project_id}&format={final_format}&variant=raw"
        task["subtitle_srt_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=srt"
        task["subtitle_lrc_url"] = f"/api/v1/tts/subtitle?project_id={payload.project_id}&format=lrc"
        if failed_count == 0:
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
        else:
            project.audio_assets.latest_task_id = task_id
            project.audio_assets.segments.update(segment_assets)
            project.status = "voices_configured" if project.voice_assignments else "parsed"

        failed_map = {item.segment_id: item for item in (project.audio_assets.failed_segments or []) if item.segment_id}
        for segment_id in segment_assets.keys():
            failed_map.pop(segment_id, None)
        for segment_id, result in task["segments"].items():
            if result.get("status") != "failed":
                continue
            failed_map[segment_id] = FailedSegmentAsset(
                segment_id=segment_id,
                error=str(result.get("error") or ""),
                attempts=int(result.get("attempts") or 0),
                task_id=task_id,
                failed_at=datetime.now(timezone.utc).isoformat(),
                fingerprint=str(result.get("fingerprint") or ""),
            )
        project.audio_assets.failed_segments = list(failed_map.values())
        save_project(state.settings.projects_dir, project)

        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "complete", "data": public_task(task)})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        project.status = "voices_configured" if project.voice_assignments else "parsed"
        save_project(state.settings.projects_dir, project)
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "canceled", "message": "合成任务已取消"})
        raise
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        project.status = "voices_configured" if project.voice_assignments else "parsed"
        save_project(state.settings.projects_dir, project)
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "error", "message": str(exc)})
    finally:
        task["finished_at"] = task.get("finished_at") or datetime.now(timezone.utc).isoformat()
        state.tts_task_handles.pop(task_id, None)
