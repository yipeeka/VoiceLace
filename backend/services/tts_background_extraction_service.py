from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import tempfile

from fastapi import HTTPException

from backend.engine.waveform_peaks import build_peaks_payload
from backend.persistence import append_project_event, load_project, save_project
from .audio_vocal_separation_service import normalize_demucs_model, prepare_background_audio_for_remix
from .project_snapshot_service import create_project_snapshot
from .tts_path_service import project_postprocess_assets_dir, to_output_relpath
from .tts_runtime_service import emit_task_event
from .tts_stale_service import from_output_relpath
from .tts_task_service import public_task


def resolve_project_background_source_audio(*, output_dir: Path, project) -> tuple[Path, list[str]]:
    warnings: list[str] = []
    source = from_output_relpath(output_dir, project.audio_assets.source_audio_wav_relpath)
    if source and source.exists() and source.is_file():
        return source, warnings

    source = from_output_relpath(output_dir, project.audio_assets.source_audio_mp3_relpath)
    if source and source.exists() and source.is_file():
        warnings.append("当前项目只有 MP3 原音频，背景声提取质量可能低于 WAV。")
        return source, warnings

    raise HTTPException(status_code=400, detail="项目没有可用于提取背景声的原音频，请先从音频/视频创建配音项目或上传原音频。")


async def run_background_extraction_task(*, task_id: str, project_id: str, state, logger) -> None:
    task = state.tts_tasks[task_id]
    warnings: list[str] = []
    stages = ["source", "separate", "bind"]

    task["status"] = "running"
    task["scope"] = "extract_background"
    task["progress"] = {"current": 0, "total": len(stages)}
    await emit_task_event(
        state=state,
        task=task,
        task_id=task_id,
        message={"type": "task_status", "status": "running", "kind": "extract_background"},
    )

    try:
        project = load_project(state.settings.projects_dir, project_id)
        create_project_snapshot(state.settings.projects_dir, project, reason="before_background_extraction")

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "source", "message": "读取项目原音频"},
        )
        source_audio, source_warnings = resolve_project_background_source_audio(output_dir=state.settings.output_dir, project=project)
        warnings.extend(source_warnings)
        task["progress"] = {"current": 1, "total": len(stages)}
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": 1, "total": len(stages)})

        config = getattr(state.orchestrator, "config", None)
        demucs_model = normalize_demucs_model(getattr(config, "asr_vocal_separation_model", "htdemucs"))
        demucs_repo_dir = str(getattr(config, "asr_vocal_separation_repo_dir", "") or "")
        demucs_device = str(
            getattr(config, "asr_vocal_separation_device", "")
            or getattr(config, "asr_device", "")
            or "cpu"
        )

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "separate", "message": "提取无人物背景声"},
        )
        with tempfile.TemporaryDirectory(prefix="tts_bg_", dir=state.settings.output_dir) as tmp_dir:
            separation = await prepare_background_audio_for_remix(
                source_audio,
                enabled=True,
                model=demucs_model,
                repo_dir=demucs_repo_dir,
                device=demucs_device,
                work_dir=Path(tmp_dir),
            )
            warnings.extend(separation.warnings)
            if not separation.used or separation.background_path is None:
                raise RuntimeError("背景声提取失败：" + (" | ".join(warnings) if warnings else "未生成 no_vocals.wav"))

            assets_dir = project_postprocess_assets_dir(output_dir=state.settings.output_dir, project_id=project.id)
            assets_dir.mkdir(parents=True, exist_ok=True)
            background_path = assets_dir / "ambience_from_source.wav"
            shutil.copyfile(separation.background_path, background_path)

        task["progress"] = {"current": 2, "total": len(stages)}
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": 2, "total": len(stages)})

        await emit_task_event(
            state=state,
            task=task,
            task_id=task_id,
            message={"type": "postprocess_stage", "stage": "bind", "message": "绑定为环境音轨"},
        )
        relpath = to_output_relpath(output_dir=state.settings.output_dir, path=background_path)
        project = load_project(state.settings.projects_dir, project_id)
        project.synthesis_config.postprocess_enabled = True
        project.synthesis_config.ambience_track.relpath = relpath
        project.synthesis_config.ambience_track.loop = False
        project.synthesis_config.ambience_track.gain_db = -8.0
        project.synthesis_config.ambience_track.ducking_enabled = True
        project.synthesis_config.ambience_track.ducking_db = 6.0
        project.synthesis_config.ambience_track.offset_ms = 0
        saved = save_project(state.settings.projects_dir, project)

        peaks_path = background_path.with_suffix(".peaks.json")
        try:
            peaks_payload = build_peaks_payload(wav_path=background_path, levels=[1024, 2048, 4096])
            peaks_path.write_text(json.dumps(peaks_payload, ensure_ascii=False), encoding="utf-8")
        except Exception as exc:
            warnings.append(f"背景声波形生成失败：{exc}")

        append_project_event(
            state.settings.projects_dir,
            project_id,
            {
                "source": "tts",
                "kind": "postprocess",
                "event": {
                    "type": "background_extracted",
                    "relpath": relpath,
                    "source_audio": str(source_audio.name),
                    "warnings": warnings,
                },
            },
        )

        task["status"] = "done"
        task["background_relpath"] = relpath
        task["warnings"] = warnings
        task["progress"] = {"current": len(stages), "total": len(stages)}
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        task["project_updated_at"] = saved.updated_at.isoformat() if getattr(saved, "updated_at", None) else ""
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "progress", "current": len(stages), "total": len(stages)})
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "complete", "data": public_task(task)})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "canceled", "message": "背景声提取任务已取消"})
        raise
    except HTTPException as exc:
        task["status"] = "error"
        task["error"] = str(exc.detail)
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "error", "message": task["error"]})
    except Exception as exc:
        logger.exception("background extraction task failed task_id=%s", task_id)
        task["status"] = "error"
        task["error"] = str(exc)
        task["finished_at"] = datetime.now(timezone.utc).isoformat()
        await emit_task_event(state=state, task=task, task_id=task_id, message={"type": "error", "message": str(exc)})
