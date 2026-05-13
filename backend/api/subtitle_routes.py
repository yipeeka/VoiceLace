from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from backend.services.subtitle_import_service import create_dubbing_project_from_subtitle, parse_subtitle_bytes, translate_subtitle_preview
from backend.state import get_app_state

router = APIRouter()


async def _emit(state, task: dict, task_id: str, message: dict) -> None:
    task.setdefault("events", []).append(message)
    await state.realtime.publish("llm", task_id, message)


async def _run_translate_subtitle_task(
    task_id: str,
    *,
    state,
    data: bytes,
    filename: str | None,
    target_language: str,
    translation_source: str,
    line_policy: str,
    max_concurrency: int,
) -> None:
    task = state.llm_tasks[task_id]
    task["status"] = "running"
    task["stage"] = "parsing"
    task["stage_label"] = "正在解析字幕"
    task["stage_progress"] = 2
    await _emit(state, task, task_id, {"type": "task_status", "status": "running", "task_kind": "translate_subtitle"})
    await _emit(state, task, task_id, {"type": "dubbing_stage", "stage": "parsing", "stage_label": "正在解析字幕", "processed": 0, "total": 0})

    async def on_progress(event: dict) -> None:
        stage = str(event.get("stage") or task.get("stage") or "")
        processed = int(event.get("processed") or event.get("current") or 0)
        total = int(event.get("total") or 0)
        percent = float(event.get("percent") or 0)
        if total > 0 and percent <= 0:
            percent = min(99.0, max(0.0, processed / total * 100.0))
        task["stage"] = stage or task.get("stage", "")
        task["stage_label"] = str(event.get("stage_label") or task.get("stage_label") or "正在翻译字幕")
        task["stage_progress"] = percent
        await _emit(state, task, task_id, event)
        await _emit(state, task, task_id, {"type": "progress", "current": processed, "total": total, "percent": percent})

    try:
        result = await translate_subtitle_preview(
            state=state,
            data=data,
            filename=filename,
            target_language=target_language,
            translation_source=translation_source,
            line_policy=line_policy,
            max_concurrency=max_concurrency,
            progress_callback=on_progress,
            cancel_check=lambda: task.get("status") == "cancel_requested",
        )
        task["status"] = "done"
        task["result"] = result
        task["stage"] = "done"
        task["stage_label"] = "字幕翻译完成"
        task["stage_progress"] = 100
        await _emit(state, task, task_id, {"type": "progress", "current": int(result.get("segment_count") or 0), "total": int(result.get("segment_count") or 0), "percent": 100})
        await _emit(state, task, task_id, {"type": "task_status", "status": "done", "task_kind": "translate_subtitle"})
        await _emit(state, task, task_id, {"type": "complete", "data": result})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        task["stage"] = "canceled"
        task["stage_label"] = "字幕翻译任务已取消"
        await _emit(state, task, task_id, {"type": "task_status", "status": "canceled", "task_kind": "translate_subtitle"})
        await _emit(state, task, task_id, {"type": "canceled", "message": "字幕翻译任务已取消"})
        raise
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        task["stage"] = "error"
        task["stage_label"] = "字幕翻译失败"
        state.translation_engine_error = str(exc)
        await _emit(state, task, task_id, {"type": "task_status", "status": "error", "task_kind": "translate_subtitle"})
        await _emit(state, task, task_id, {"type": "error", "message": str(exc)})
    finally:
        state.llm_task_handles.pop(task_id, None)


@router.post("/preview")
async def preview_subtitle(
    file: UploadFile = File(...),
    mode: str = Form("original"),
    line_policy: str = Form("auto"),
):
    try:
        return parse_subtitle_bytes(
            await file.read(),
            filename=file.filename,
            line_policy=line_policy,
            mode=mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"字幕解析失败：{exc}") from exc


@router.post("/create-dubbing-project")
async def create_subtitle_dubbing_project(
    file: UploadFile = File(...),
    project_name: str | None = Form(None),
    mode: str = Form("original"),
    target_language: str = Form("中文"),
    translation_source: str = Form("secondary_local"),
    line_policy: str = Form("auto"),
    translated_segments: str | None = Form(None),
    state=Depends(get_app_state),
):
    try:
        return await create_dubbing_project_from_subtitle(
            state=state,
            data=await file.read(),
            filename=file.filename,
            project_name=project_name,
            mode=mode,
            target_language=target_language,
            translation_source=translation_source,
            line_policy=line_policy,
            translated_segments_json=translated_segments,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"创建字幕配音项目失败：{exc}") from exc


@router.post("/translate-preview")
async def translate_subtitle(
    file: UploadFile = File(...),
    target_language: str = Form("中文"),
    translation_source: str = Form("secondary_local"),
    line_policy: str = Form("auto"),
    max_concurrency: int = Form(1),
    state=Depends(get_app_state),
):
    try:
        return await translate_subtitle_preview(
            state=state,
            data=await file.read(),
            filename=file.filename,
            target_language=target_language,
            translation_source=translation_source,
            line_policy=line_policy,
            max_concurrency=max_concurrency,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        state.translation_engine_error = str(exc)
        raise HTTPException(status_code=503, detail=f"字幕翻译失败：{exc}") from exc


@router.post("/translate-preview/task")
async def enqueue_translate_subtitle_task(
    file: UploadFile = File(...),
    target_language: str = Form("中文"),
    translation_source: str = Form("secondary_local"),
    line_policy: str = Form("auto"),
    max_concurrency: int = Form(1),
    state=Depends(get_app_state),
):
    task_id = str(uuid4())
    state.llm_tasks[task_id] = {
        "task_id": task_id,
        "task_kind": "translate_subtitle",
        "status": "queued",
        "stage": "queued",
        "stage_label": "字幕翻译任务排队中",
        "stage_progress": 0,
        "result": None,
        "error": "",
        "project_id": None,
        "events": [{"type": "task_status", "status": "queued", "task_kind": "translate_subtitle"}],
    }
    handle = asyncio.create_task(
        _run_translate_subtitle_task(
            task_id,
            state=state,
            data=await file.read(),
            filename=file.filename,
            target_language=target_language,
            translation_source=translation_source,
            line_policy=line_policy,
            max_concurrency=max_concurrency,
        )
    )
    state.llm_task_handles[task_id] = handle
    return {"task_id": task_id}


@router.get("/translate-preview/task/{task_id}")
async def get_translate_subtitle_task(task_id: str, state=Depends(get_app_state)):
    task = state.llm_tasks.get(task_id)
    if task is None or task.get("task_kind") != "translate_subtitle":
        raise HTTPException(status_code=404, detail="Subtitle translation task not found")
    payload = {
        "task_id": task_id,
        "status": task.get("status", "queued"),
        "stage": task.get("stage", ""),
        "stage_label": task.get("stage_label", ""),
        "stage_progress": task.get("stage_progress", 0),
        "error": task.get("error", ""),
    }
    if task.get("status") == "done":
        payload["result"] = task.get("result")
        return payload
    if task.get("status") in {"error", "canceled"}:
        return payload
    return JSONResponse(status_code=202, content=payload)


@router.post("/translate-preview/task/{task_id}/cancel")
async def cancel_translate_subtitle_task(task_id: str, state=Depends(get_app_state)):
    task = state.llm_tasks.get(task_id)
    if task is None or task.get("task_kind") != "translate_subtitle":
        raise HTTPException(status_code=404, detail="Subtitle translation task not found")
    if task["status"] in {"done", "error", "canceled"}:
        return {"task_id": task_id, "status": task["status"]}
    handle = state.llm_task_handles.get(task_id)
    if handle is None:
        task["status"] = "canceled"
        await _emit(state, task, task_id, {"type": "canceled", "message": "字幕翻译任务已取消"})
        return {"task_id": task_id, "status": "canceled"}
    task["status"] = "cancel_requested"
    await _emit(state, task, task_id, {"type": "cancel_requested", "message": "正在取消字幕翻译任务..."})
    handle.cancel()
    return {"task_id": task_id, "status": "cancel_requested"}
