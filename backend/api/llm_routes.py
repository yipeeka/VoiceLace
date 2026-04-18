from __future__ import annotations

import asyncio
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from backend.engine.prompts import DEFAULT_PARSE_PROMPT
from backend.models import LlmParseRequest
from backend.persistence import append_project_event, load_project, save_project
from backend.state import get_app_state

router = APIRouter()


async def _emit(state, task: dict, task_id: str, message: dict) -> None:
    task["events"].append(message)
    if task.get("project_id"):
        append_project_event(
            state.settings.projects_dir,
            task["project_id"],
            {
                "source": "llm",
                "task_id": task_id,
                "status": task.get("status", ""),
                "event": message,
            },
        )
    await state.realtime.publish("llm", task_id, message)


@router.get("/prompts/default")
async def get_default_prompt():
    return {"prompt": DEFAULT_PARSE_PROMPT}


async def _run_parse_task(task_id: str, payload: LlmParseRequest, state) -> None:
    task = state.llm_tasks[task_id]
    task["status"] = "running"
    await _emit(state, task, task_id, {"type": "task_status", "status": "running"})
    await _emit(state, task, task_id, {"type": "model_loading", "engine": "llm", "message": "正在加载 LLM..."})
    await _emit(state, task, task_id, {"type": "progress", "current": 3, "total": 100, "percent": 3})

    try:
        await state.orchestrator.ensure_llm_ready()
        await _emit(state, task, task_id, {"type": "model_loaded", "engine": "llm", "backend": state.llm_engine.backend_name})
        await _emit(state, task, task_id, {"type": "progress", "current": 8, "total": 100, "percent": 8})
        cfg = state.orchestrator.config
        llm_options = {
            "temperature": cfg.llm_temperature,
            "top_p": cfg.llm_top_p,
            "top_k": cfg.llm_top_k,
            "min_p": cfg.llm_min_p,
            "presence_penalty": cfg.llm_presence_penalty,
            "repeat_penalty": cfg.llm_repeat_penalty,
            "max_tokens": cfg.llm_max_tokens,
            "n_ctx": cfg.llm_n_ctx,
            "n_gpu_layers": cfg.llm_n_gpu_layers,
            "n_threads": cfg.llm_threads,
            "backend": cfg.llm_backend,
            "api_model": cfg.llm_api_model,
        }

        chunk_counter = {"count": 0}

        async def on_chunk(piece: str) -> None:
            chunk_counter["count"] += 1
            await _emit(state, task, task_id, {"type": "chunk", "data": piece})
            if chunk_counter["count"] % 8 == 0:
                await _emit(state, task, task_id, {"type": "progress", "current": chunk_counter["count"], "total": 100, "percent": min(95, chunk_counter["count"])})

        async def on_chunk_progress(chunk: int, total_chunks: int) -> None:
            percent = max(10, int((chunk / max(total_chunks, 1)) * 100))
            await _emit(
                state,
                task,
                task_id,
                {
                    "type": "chunk_progress",
                    "chunk": chunk,
                    "total_chunks": total_chunks,
                    "percent": percent,
                },
            )

        async def on_chunk_start(chunk: int, total_chunks: int) -> None:
            base = int(((chunk - 1) / max(total_chunks, 1)) * 100)
            percent = max(10, min(95, base + 2))
            await _emit(
                state,
                task,
                task_id,
                {
                    "type": "chunk_start",
                    "chunk": chunk,
                    "total_chunks": total_chunks,
                    "percent": percent,
                },
            )

        script = await state.llm_engine.parse_text_chunked_stream(
            payload.text,
            payload.system_prompt or DEFAULT_PARSE_PROMPT,
            on_chunk=on_chunk,
            on_chunk_progress=on_chunk_progress,
            on_chunk_start=on_chunk_start,
            llm_options=llm_options,
        )

        if payload.project_id:
            project = load_project(state.settings.projects_dir, payload.project_id)
            project.script = script
            project.status = "parsed" if script.segments else "draft"
            save_project(state.settings.projects_dir, project)

        parse_stats = dict(getattr(state.llm_engine, "last_parse_stats", {}) or {})
        if parse_stats:
            await _emit(state, task, task_id, {"type": "parse_stats", "data": parse_stats})

        if state.orchestrator.config.auto_unload_llm_after_parse:
            await _emit(state, task, task_id, {"type": "model_unloading", "engine": "llm", "message": "正在卸载 LLM..."})
            await state.orchestrator.unload_llm()
            await _emit(state, task, task_id, {"type": "model_unloaded", "engine": "llm"})

        result = script.model_dump(mode="json")
        task["status"] = "done"
        task["result"] = result
        task["parse_stats"] = parse_stats if parse_stats else None
        await _emit(state, task, task_id, {"type": "progress", "current": 100, "total": 100, "percent": 100})
        await _emit(state, task, task_id, {"type": "complete", "data": result})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        await _emit(state, task, task_id, {"type": "canceled", "message": "解析任务已取消"})
        raise
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        await _emit(state, task, task_id, {"type": "error", "message": str(exc)})
    finally:
        state.llm_task_handles.pop(task_id, None)


@router.post("/parse")
async def parse_text(payload: LlmParseRequest, state=Depends(get_app_state)):
    task_id = str(uuid4())
    state.llm_tasks[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "result": None,
        "error": "",
        "project_id": payload.project_id,
        "events": [{"type": "task_status", "status": "queued"}],
    }
    handle = asyncio.create_task(_run_parse_task(task_id, payload, state))
    state.llm_task_handles[task_id] = handle
    return {"task_id": task_id}


@router.get("/parse/{task_id}")
async def get_parse_result(task_id: str, state=Depends(get_app_state)):
    task = state.llm_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Parse task not found")
    if task["status"] == "done":
        return task["result"]
    if task["status"] == "error":
        raise HTTPException(status_code=500, detail=task["error"])
    return JSONResponse(status_code=202, content={"status": task["status"], "task_id": task_id})


@router.get("/parse/{task_id}/stats")
async def get_parse_stats(task_id: str, state=Depends(get_app_state)):
    task = state.llm_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Parse task not found")
    stats = task.get("parse_stats")
    if task.get("status") == "done":
        return {
            "task_id": task_id,
            "status": "done",
            "parse_stats": stats or {},
        }
    return JSONResponse(
        status_code=202,
        content={
            "task_id": task_id,
            "status": task.get("status", "queued"),
            "parse_stats": stats or {},
        },
    )


@router.post("/parse/{task_id}/cancel")
async def cancel_parse_task(task_id: str, state=Depends(get_app_state)):
    task = state.llm_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Parse task not found")
    if task["status"] in {"done", "error", "canceled"}:
        return {"task_id": task_id, "status": task["status"]}
    handle = state.llm_task_handles.get(task_id)
    if handle is None:
        task["status"] = "canceled"
        await _emit(state, task, task_id, {"type": "canceled", "message": "解析任务已取消"})
        return {"task_id": task_id, "status": "canceled"}
    handle.cancel()
    task["status"] = "cancel_requested"
    await _emit(state, task, task_id, {"type": "cancel_requested", "message": "正在取消解析任务..."})
    return {"task_id": task_id, "status": "cancel_requested"}
