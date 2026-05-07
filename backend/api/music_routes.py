from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from backend.models import AttachMusicAssetRequest, MusicGenerateRequest
from backend.services import bind_postprocess_asset_to_project
from backend.state import get_app_state

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _emit_music_event(state, task: dict, task_id: str, message: dict) -> None:
    task["events"].append(message)
    await state.realtime.publish("music", task_id, message)


def _public_music_task(task: dict) -> dict:
    return {
        "task_id": task["task_id"],
        "status": task["status"],
        "project_id": task.get("project_id"),
        "created_at": task.get("created_at", ""),
        "started_at": task.get("started_at", ""),
        "finished_at": task.get("finished_at", ""),
        "error": task.get("error", ""),
        "result": task.get("result"),
    }


def _resolve_music_asset_path(state, asset_name: str) -> Path:
    music_dir = (state.settings.output_dir / "music").resolve()
    source = (music_dir / asset_name).resolve()
    try:
        source.relative_to(music_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="asset_name 非法") from exc
    if not source.exists() or not source.is_file():
        raise HTTPException(status_code=404, detail="Music asset not found")
    if source.suffix.lower() not in {".wav", ".mp3", ".flac", ".ogg"}:
        raise HTTPException(status_code=400, detail="仅支持音频文件")
    return source


async def _run_music_task(task_id: str, payload: MusicGenerateRequest, state) -> None:
    task = state.music_tasks[task_id]
    task["status"] = "running"
    task["started_at"] = _now_iso()
    await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "running"})
    try:
        if not bool(state.orchestrator.config.music_enabled):
            raise RuntimeError("音乐生成功能未启用（music_enabled=false）")
        if not state.orchestrator.config.music_model_dir.strip():
            raise RuntimeError("未配置音乐模型目录（music_model_dir）")

        await _emit_music_event(state, task, task_id, {"type": "task_stage", "stage": "loading_model"})
        await state.orchestrator.ensure_music_ready()

        music_output_dir = state.settings.output_dir / "music"
        output_path = music_output_dir / f"{task_id}.wav"
        await _emit_music_event(state, task, task_id, {"type": "task_stage", "stage": "generating"})
        result = await state.music_engine.generate_to_file(
            prompt=payload.prompt,
            output_path=output_path,
            lyrics=payload.lyrics,
            audio_duration=payload.audio_duration,
            vocal_language=payload.vocal_language,
            num_inference_steps=payload.num_inference_steps,
            seed=payload.seed,
            bpm=payload.bpm,
            keyscale=payload.keyscale,
            timesignature=payload.timesignature,
        )

        task["status"] = "done"
        task["finished_at"] = _now_iso()
        task["result"] = {
            **result,
            "audio_url": f"/api/v1/music/tasks/{task_id}/audio",
            "model_dir": state.orchestrator.config.music_model_dir,
            "device_mode": state.orchestrator.config.music_device_mode,
        }
        await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "done"})
        await _emit_music_event(state, task, task_id, {"type": "complete", "data": task["result"]})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        task["finished_at"] = _now_iso()
        await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "canceled"})
        await _emit_music_event(state, task, task_id, {"type": "canceled", "message": "音乐生成任务已取消"})
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        task["finished_at"] = _now_iso()
        await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "error"})
        await _emit_music_event(state, task, task_id, {"type": "error", "message": str(exc)})
    finally:
        state.music_task_handles.pop(task_id, None)


@router.post("/generate")
async def generate_music(payload: MusicGenerateRequest, state=Depends(get_app_state)):
    if not bool(state.orchestrator.config.music_enabled):
        raise HTTPException(status_code=400, detail="音乐生成功能未启用（music_enabled=false）")
    task_id = str(uuid4())
    task = {
        "task_id": task_id,
        "status": "queued",
        "project_id": payload.project_id,
        "created_at": _now_iso(),
        "started_at": "",
        "finished_at": "",
        "error": "",
        "result": None,
        "events": [{"type": "task_status", "status": "queued"}],
    }
    state.music_tasks[task_id] = task
    await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "queued"})
    handle = asyncio.create_task(_run_music_task(task_id, payload, state))
    state.music_task_handles[task_id] = handle
    return {"task_id": task_id}


@router.get("/model/validate")
async def validate_music_model_dir(state=Depends(get_app_state)):
    from backend.engine.music_engine import MusicEngine

    report = MusicEngine.validate_model_dir(state.orchestrator.config.music_model_dir)
    report["music_enabled"] = bool(state.orchestrator.config.music_enabled)
    report["device_mode"] = state.orchestrator.config.music_device_mode
    return report


@router.get("/tasks/{task_id}")
async def get_music_task(task_id: str, state=Depends(get_app_state)):
    task = state.music_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Music task not found")
    if task["status"] == "error":
        raise HTTPException(status_code=500, detail=task.get("error") or "music task failed")
    if task["status"] not in {"done", "canceled"}:
        return _public_music_task(task)
    return _public_music_task(task)


@router.post("/tasks/{task_id}/cancel")
async def cancel_music_task(task_id: str, state=Depends(get_app_state)):
    task = state.music_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Music task not found")
    if task["status"] in {"done", "error", "canceled"}:
        return {"task_id": task_id, "status": task["status"]}
    handle = state.music_task_handles.get(task_id)
    if handle is not None:
        handle.cancel()
        task["status"] = "cancel_requested"
        await _emit_music_event(state, task, task_id, {"type": "cancel_requested", "message": "正在取消音乐生成任务..."})
        return {"task_id": task_id, "status": "cancel_requested"}
    task["status"] = "canceled"
    task["finished_at"] = _now_iso()
    await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "canceled"})
    return {"task_id": task_id, "status": "canceled"}


@router.get("/tasks/{task_id}/audio")
async def get_music_audio(task_id: str, state=Depends(get_app_state)):
    task = state.music_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Music task not found")
    result = task.get("result") or {}
    output_path = result.get("output_path")
    if not output_path:
        raise HTTPException(status_code=404, detail="Music audio not available")
    path = Path(output_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Music audio file not found")
    return FileResponse(path, media_type="audio/wav", filename=path.name)


@router.get("/assets")
async def list_music_assets(state=Depends(get_app_state)):
    music_dir = state.settings.output_dir / "music"
    if not music_dir.exists():
        return {"items": []}
    items = []
    for wav in sorted(music_dir.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True):
        stat = wav.stat()
        items.append(
            {
                "name": wav.name,
                "path": str(wav),
                "size": int(stat.st_size),
                "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            }
        )
    return {"items": items}


@router.get("/assets/{asset_name}/audio")
async def get_music_asset_audio(asset_name: str, state=Depends(get_app_state)):
    source = _resolve_music_asset_path(state, asset_name)
    media_type = {
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
    }.get(source.suffix.lower(), "application/octet-stream")
    return FileResponse(source, media_type=media_type, filename=source.name)


@router.post("/assets/attach")
async def attach_music_asset(payload: AttachMusicAssetRequest, state=Depends(get_app_state)):
    source = _resolve_music_asset_path(state, payload.asset_name)

    result = bind_postprocess_asset_to_project(
        projects_dir=state.settings.projects_dir,
        output_dir=state.settings.output_dir,
        project_id=payload.project_id,
        asset_type=payload.target,
        source_path=source,
        delete_source=False,
    )
    return {
        **result,
        "asset_name": payload.asset_name,
        "target": payload.target,
    }
