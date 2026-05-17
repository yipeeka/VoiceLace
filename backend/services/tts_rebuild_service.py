from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
import wave

from backend.models import ProcessedAudioAssets
from backend.persistence import append_project_event, load_project, save_project

from .project_snapshot_service import create_project_snapshot
from .tts_finalize_service import finalize_rebuild_full, should_use_source_timeline, update_project_audio_assets_after_synthesis
from .tts_path_service import (
    project_full_dir as build_project_full_dir,
    project_subtitles_dir as build_project_subtitles_dir,
    project_waveforms_dir as build_project_waveforms_dir,
)
from .tts_runtime_service import emit_task_event
from .tts_stale_service import from_output_relpath
from .tts_task_service import public_task


def _read_wav_frames(path: Path) -> dict:
    with wave.open(str(path), "rb") as wav_in:
        frame_rate = wav_in.getframerate()
        frame_count = wav_in.getnframes()
        frames = wav_in.readframes(frame_count)
    duration_ms = int((frame_count / frame_rate) * 1000) if frame_rate else 0
    return {
        "frame_rate": frame_rate,
        "frame_count": frame_count,
        "frames": frames,
        "duration_ms": duration_ms,
    }


def _collect_segment_rebuild_inputs(*, project, output_dir: Path) -> tuple[list[dict], dict, bytearray, int, list[str]]:
    segment_inputs: list[dict] = []
    task_segments: dict = {}
    combined_frames = bytearray()
    sample_rate = 24000
    missing_ids: list[str] = []
    gap_ms = int(getattr(project.synthesis_config, "gap_duration_ms", 300) or 0)
    segments = list(project.script.segments or [])

    for index, segment in enumerate(segments):
        asset = (project.audio_assets.segments or {}).get(segment.id)
        path = from_output_relpath(output_dir, getattr(asset, "audio_relpath", None) if asset else None)
        if asset is None or path is None or not path.exists():
            missing_ids.append(segment.id)
            continue

        wav_info = _read_wav_frames(path)
        sample_rate = int(wav_info["frame_rate"] or sample_rate)
        duration_ms = int(getattr(asset, "duration_ms", 0) or wav_info["duration_ms"] or 0)
        segment_inputs.append(
            {
                "segment_id": segment.id,
                "speaker": segment.speaker or "narrator",
                "text": segment.text or "",
                "path": str(path),
                "source_start_ms": getattr(segment, "source_start_ms", None),
                "source_end_ms": getattr(segment, "source_end_ms", None),
                "source_duration_ms": getattr(segment, "source_duration_ms", None),
            }
        )
        task_segments[segment.id] = {
            "segment_id": segment.id,
            "index": index,
            "speaker": segment.speaker or "narrator",
            "text": segment.text or "",
            "source_start_ms": getattr(segment, "source_start_ms", None),
            "source_end_ms": getattr(segment, "source_end_ms", None),
            "source_duration_ms": getattr(segment, "source_duration_ms", None),
            "status": "done",
            "duration_ms": duration_ms,
            "cached": False,
            "reused": True,
            "source": "project_asset",
        }
        combined_frames.extend(wav_info["frames"])
        if index < len(segments) - 1:
            gap_frames = max(1, int(sample_rate * (gap_ms / 1000))) if gap_ms > 0 else 0
            combined_frames.extend(b"\x00\x00" * gap_frames)

    return segment_inputs, task_segments, combined_frames, sample_rate, missing_ids


async def run_rebuild_full_audio_task(*, task_id: str, project_id: str, state, logger) -> None:
    task = state.tts_tasks[task_id]
    project = load_project(state.settings.projects_dir, project_id)
    create_project_snapshot(state.settings.projects_dir, project, reason="before_full_audio_rebuild")
    config = project.synthesis_config
    total = len(project.script.segments or [])
    task["status"] = "running"
    task["scope"] = "rebuild_full_audio"
    task["progress"] = {"current": 0, "total": total}
    task["reused_count"] = total

    await emit_task_event(
        state=state,
        task=task,
        task_id=task_id,
        message={"type": "task_status", "status": "running", "kind": "rebuild_full_audio"},
    )
    await emit_task_event(
        state=state,
        task=task,
        task_id=task_id,
        message={"type": "model_loaded", "engine": "tts", "message": "正在重组完整音频..."},
    )

    try:
        if total <= 0:
            raise RuntimeError("当前项目没有可重组的剧本片段")

        segment_inputs, task_segments, combined_frames, sample_rate, missing_ids = _collect_segment_rebuild_inputs(
            project=project,
            output_dir=state.settings.output_dir,
        )
        if missing_ids:
            preview = ", ".join(missing_ids[:8])
            suffix = "..." if len(missing_ids) > 8 else ""
            raise RuntimeError(f"剩余片段音频不完整，无法重组完整音频：{preview}{suffix}")
        if len(segment_inputs) != total:
            raise RuntimeError("剩余片段音频不完整，无法重组完整音频")

        project_full_dir = build_project_full_dir(output_dir=state.settings.output_dir, project_id=project_id)
        project_full_dir.mkdir(parents=True, exist_ok=True)
        project_subtitles_dir = build_project_subtitles_dir(output_dir=state.settings.output_dir, project_id=project_id)
        project_subtitles_dir.mkdir(parents=True, exist_ok=True)
        project_waveforms_dir = build_project_waveforms_dir(output_dir=state.settings.output_dir, project_id=project_id)
        project_waveforms_dir.mkdir(parents=True, exist_ok=True)

        wav_export_path = project_full_dir / "mix.wav"
        mp3_export_path = project_full_dir / "mix.mp3"
        srt_path = project_subtitles_dir / "book.srt"
        lrc_path = project_subtitles_dir / "book.lrc"
        full_peaks_path = project_waveforms_dir / "full.peaks.json"

        use_source_timeline = should_use_source_timeline(config=config, project=project)
        finalize = finalize_rebuild_full(
            output_dir=state.settings.output_dir,
            project_id=project_id,
            config=config,
            segment_inputs=segment_inputs,
            task_segments=task_segments,
            combined_frames=combined_frames,
            sample_rate=sample_rate,
            wav_export_path=wav_export_path,
            mp3_export_path=mp3_export_path,
            srt_path=srt_path,
            lrc_path=lrc_path,
            full_peaks_path=full_peaks_path,
            use_source_timeline=use_source_timeline,
        )
        final_format = finalize["final_format"]

        update_project_audio_assets_after_synthesis(
            project=project,
            task_id=task_id,
            rebuild_full=True,
            segment_assets=dict(project.audio_assets.segments or {}),
            output_dir=state.settings.output_dir,
            wav_export_path=wav_export_path,
            mp3_export_path=mp3_export_path,
            srt_path=srt_path,
            lrc_path=lrc_path,
            full_peaks_path=full_peaks_path,
        )
        project.audio_assets.processed = ProcessedAudioAssets()
        project.status = "done"
        save_project(state.settings.projects_dir, project)
        append_project_event(
            state.settings.projects_dir,
            project.id,
            {
                "source": "tts",
                "status": project.status,
                "event": {
                    "type": "full_audio_rebuilt",
                    "message": f"完整音频已重组，共 {total} 段",
                    "task_id": task_id,
                },
            },
        )

        task["segments"] = task_segments
        task["status"] = "done"
        task["progress"] = {"current": total, "total": total}
        task["export_url"] = f"/api/v1/tts/export?project_id={project_id}&format={final_format}&variant=raw"
        task["subtitle_srt_url"] = f"/api/v1/tts/subtitle?project_id={project_id}&format=srt"
        task["subtitle_lrc_url"] = f"/api/v1/tts/subtitle?project_id={project_id}&format=lrc"
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "progress", "current": total, "total": total},
        )
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "complete", "data": public_task(task)})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "canceled", "message": "重组音频任务已取消"})
        raise
    except Exception as exc:
        logger.exception("Full audio rebuild failed project_id=%s task_id=%s", project_id, task_id)
        task["status"] = "error"
        task["error"] = str(exc)
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "error", "message": str(exc)})
