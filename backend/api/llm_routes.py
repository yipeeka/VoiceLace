from __future__ import annotations

import asyncio
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from backend.engine.prompts import DEFAULT_PARSE_PROMPT
from backend.models import (
    LlmParseRequest,
    TranslateDubbingSegmentsRequest,
    TranslatePolishRequest,
    TranslationEngineLoadRequest,
)
from backend.persistence import append_project_event, load_project, save_project
from backend.services.dubbing_translation_service import translate_dubbing_segments_for_state
from backend.state import get_app_state

router = APIRouter()
ALLOWED_TRANSLATION_SOURCES = {"primary_local", "secondary_local", "openai", "openai_compatible", "gemini"}


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


def _build_translation_config(state, source: str) -> dict[str, Any]:
    cfg = state.orchestrator.config
    if source == "primary_local":
        return {
            "backend": "llama_cpp",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": bool(cfg.enable_llama_cpp_think_mode),
            "api_model": cfg.llm_api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    if source == "secondary_local":
        return {
            "backend": "llama_cpp",
            "model_path": cfg.secondary_llm_model_path,
            "clip_model_path": cfg.secondary_llm_clip_model_path,
            "n_ctx": int(cfg.secondary_llm_n_ctx),
            "n_gpu_layers": int(cfg.secondary_llm_n_gpu_layers),
            "n_threads": int(cfg.secondary_llm_threads),
            "enable_think_mode": bool(cfg.secondary_enable_llama_cpp_think_mode),
            "api_model": cfg.llm_api_model,
            "options": {
                "temperature": float(cfg.secondary_llm_temperature),
                "top_p": float(cfg.secondary_llm_top_p),
                "top_k": int(cfg.secondary_llm_top_k),
                "min_p": float(cfg.secondary_llm_min_p),
                "presence_penalty": float(cfg.secondary_llm_presence_penalty),
                "repeat_penalty": float(cfg.secondary_llm_repeat_penalty),
                "max_tokens": int(cfg.secondary_llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    if source == "openai":
        api_model = cfg.openai_model or cfg.llm_api_model
        return {
            "backend": "openai",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "api_key": cfg.openai_api_key,
            "api_base_url": cfg.openai_base_url,
            "api_model": api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": api_model,
            },
        }
    if source == "openai_compatible":
        api_model = cfg.openai_compatible_model or cfg.llm_api_model
        return {
            "backend": "openai_compatible",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "api_key": cfg.openai_compatible_api_key,
            "api_base_url": cfg.openai_compatible_base_url,
            "api_model": api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": api_model,
            },
        }
    if source == "gemini":
        api_model = cfg.gemini_model or cfg.llm_api_model
        return {
            "backend": "gemini",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "api_key": cfg.gemini_api_key,
            "api_base_url": cfg.gemini_base_url,
            "api_model": api_model,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_key": cfg.gemini_api_key,
                "api_base_url": cfg.gemini_base_url,
                "api_model": api_model,
            },
        }
    raise HTTPException(status_code=400, detail=f"Unsupported translation source: {source}")


async def _load_translation_engine(state, source: str) -> dict[str, Any]:
    source = (source or "").strip().lower()
    if source not in ALLOWED_TRANSLATION_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported translation source: {source}")

    config = _build_translation_config(state, source)
    engine = state.translation_llm_engine
    if engine.is_loaded:
        await engine.unload_model()

    engine.enable_llama_cpp_think_mode = bool(config["enable_think_mode"])
    try:
        await engine.load_model(
            model_path=config["model_path"],
            clip_model_path=config["clip_model_path"],
            n_ctx=config["n_ctx"],
            n_gpu_layers=config["n_gpu_layers"],
            backend=config["backend"],
            n_threads=config["n_threads"],
            api_key=config.get("api_key", ""),
            api_base_url=config.get("api_base_url", ""),
            api_model=config.get("api_model", ""),
        )
    except Exception as exc:
        state.translation_engine_source = ""
        state.translation_engine_error = str(exc)
        raise HTTPException(status_code=503, detail=f"Translation engine unavailable: {exc}") from exc

    state.translation_engine_source = source
    state.translation_engine_error = ""
    return {
        "status": "ok",
        "source": source,
        "backend": engine.backend_name,
        "model_name": engine.model_name,
        "error": engine.last_error,
    }


@router.get("/translation-engine/status")
async def get_translation_engine_status(state=Depends(get_app_state)):
    engine = state.translation_llm_engine
    return {
        "loaded": bool(engine.is_loaded),
        "source": state.translation_engine_source or "",
        "backend": engine.backend_name,
        "model_name": engine.model_name,
        "error": state.translation_engine_error or engine.last_error or "",
    }


@router.post("/translation-engine/load")
async def load_translation_engine(payload: TranslationEngineLoadRequest, state=Depends(get_app_state)):
    return await _load_translation_engine(state, payload.source)


@router.post("/translation-engine/unload")
async def unload_translation_engine(state=Depends(get_app_state)):
    engine = state.translation_llm_engine
    if engine.is_loaded:
        await engine.unload_model()
    state.translation_engine_source = ""
    state.translation_engine_error = ""
    return {"status": "ok"}


def _build_translate_prompt(*, mode: str, target_language: str) -> str:
    if mode == "passthrough":
        return ""
    if mode == "translate_polish":
        lang = (target_language or "").strip() or "中文"
        return (
            "你是专业翻译与编辑助手。请将用户文本翻译为目标语言并润色，要求："
            "1) 忠实保留事实与语义；2) 输出自然流畅、可直接使用；"
            "3) 不增加原文没有的信息；4) 仅输出最终文本。"
            f"\n目标语言：{lang}"
        )
    return (
        "你是专业文本编辑助手。请在保持原语言和原意不变的前提下润色用户文本，要求："
        "1) 修正病句和语法；2) 提升表达清晰度和自然度；"
        "3) 不新增事实；4) 仅输出润色后的最终文本。"
    )


@router.post("/translate-polish")
async def translate_polish(payload: TranslatePolishRequest, state=Depends(get_app_state)):
    source = (payload.source or "").strip().lower()
    if source not in ALLOWED_TRANSLATION_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported translation source: {payload.source}")
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if payload.mode == "translate_polish" and not (payload.target_language or "").strip():
        raise HTTPException(status_code=400, detail="target_language is required for translate_polish mode")
    if payload.mode == "passthrough":
        return {
            "text": text,
            "source": source,
            "mode": payload.mode,
            "target_language": payload.target_language,
            "backend": "passthrough",
        }

    if not state.translation_llm_engine.is_loaded or state.translation_engine_source != source:
        raise HTTPException(
            status_code=400,
            detail="Translation engine source mismatch or not loaded. Please load translation engine first.",
        )

    config = _build_translation_config(state, source)
    prompt = _build_translate_prompt(mode=payload.mode, target_language=payload.target_language)
    try:
        output = await state.translation_llm_engine.generate_text(
            text=text,
            system_prompt=prompt,
            llm_options=config["options"],
        )
    except Exception as exc:
        state.translation_engine_error = str(exc)
        raise HTTPException(status_code=503, detail=f"Translation unavailable: {exc}") from exc

    state.translation_engine_error = ""
    return {
        "text": output,
        "source": source,
        "mode": payload.mode,
        "target_language": payload.target_language,
        "backend": state.translation_llm_engine.backend_name,
    }


@router.post("/translate-dubbing-segments")
async def translate_dubbing_segments(payload: TranslateDubbingSegmentsRequest, state=Depends(get_app_state)):
    return await translate_dubbing_segments_for_state(
        state=state,
        source=payload.source,
        mode=payload.mode,
        target_language=payload.target_language,
        segments=payload.segments,
        min_speed=payload.min_speed,
        max_speed=payload.max_speed,
        max_concurrency=payload.max_concurrency,
    )


async def _run_translate_dubbing_task(task_id: str, payload: TranslateDubbingSegmentsRequest, state) -> None:
    task = state.llm_tasks[task_id]
    task["status"] = "running"
    task["stage"] = "initializing"
    task["stage_label"] = "正在初始化翻译配音任务"
    task["stage_progress"] = 1
    await _emit(state, task, task_id, {"type": "task_status", "status": "running", "task_kind": "translate_dubbing"})
    await _emit(state, task, task_id, {"type": "progress", "current": 1, "total": 100, "percent": 1})

    try:
        total_segments = len(payload.segments or [])

        async def on_progress(event: dict[str, Any]) -> None:
            stage = str(event.get("stage") or task.get("stage") or "running")
            processed = int(event.get("processed") or 0)
            total = int(event.get("total") or total_segments or 1)
            percent = 5 if total <= 0 else max(5, min(98, int((processed / max(total, 1)) * 90) + 5))
            if stage == "context":
                percent = 5
            elif stage == "compressing":
                percent = max(percent, 92)
            task["stage"] = stage
            task["stage_label"] = str(event.get("stage_label") or task.get("stage_label") or "")
            task["stage_progress"] = percent
            await _emit(
                state,
                task,
                task_id,
                {
                    **event,
                    "type": event.get("type") or "dubbing_progress",
                    "percent": percent,
                    "task_kind": "translate_dubbing",
                },
            )
            await _emit(state, task, task_id, {"type": "progress", "current": processed, "total": total, "percent": percent})

        result = await translate_dubbing_segments_for_state(
            state=state,
            source=payload.source,
            mode=payload.mode,
            target_language=payload.target_language,
            segments=payload.segments,
            min_speed=payload.min_speed,
            max_speed=payload.max_speed,
            max_concurrency=payload.max_concurrency,
            progress_callback=on_progress,
            cancel_check=lambda: task.get("status") == "cancel_requested",
        )

        task["status"] = "done"
        task["result"] = result
        task["stage"] = "done"
        task["stage_label"] = "翻译配音完成"
        task["stage_progress"] = 100
        await _emit(state, task, task_id, {"type": "progress", "current": len(result.get("segments") or []), "total": len(result.get("segments") or []), "percent": 100})
        await _emit(state, task, task_id, {"type": "task_status", "status": "done", "task_kind": "translate_dubbing"})
        await _emit(state, task, task_id, {"type": "complete", "data": result})
    except asyncio.CancelledError:
        task["status"] = "canceled"
        task["stage"] = "canceled"
        task["stage_label"] = "翻译配音任务已取消"
        task["stage_progress"] = task.get("stage_progress", 0)
        await _emit(state, task, task_id, {"type": "task_status", "status": "canceled", "task_kind": "translate_dubbing"})
        await _emit(state, task, task_id, {"type": "canceled", "message": "翻译配音任务已取消"})
        raise
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        task["stage"] = "error"
        task["stage_label"] = "翻译配音失败"
        await _emit(state, task, task_id, {"type": "task_status", "status": "error", "task_kind": "translate_dubbing"})
        await _emit(state, task, task_id, {"type": "error", "message": str(exc)})
    finally:
        state.llm_task_handles.pop(task_id, None)


@router.post("/translate-dubbing-segments/task")
async def enqueue_translate_dubbing_segments_task(payload: TranslateDubbingSegmentsRequest, state=Depends(get_app_state)):
    task_id = str(uuid4())
    state.llm_tasks[task_id] = {
        "task_id": task_id,
        "task_kind": "translate_dubbing",
        "status": "queued",
        "stage": "queued",
        "stage_label": "翻译配音任务排队中",
        "stage_progress": 0,
        "result": None,
        "error": "",
        "project_id": None,
        "events": [{"type": "task_status", "status": "queued", "task_kind": "translate_dubbing"}],
    }
    handle = asyncio.create_task(_run_translate_dubbing_task(task_id, payload, state))
    state.llm_task_handles[task_id] = handle
    return {"task_id": task_id}


@router.get("/translate-dubbing-segments/task/{task_id}")
async def get_translate_dubbing_segments_task(task_id: str, state=Depends(get_app_state)):
    task = state.llm_tasks.get(task_id)
    if task is None or task.get("task_kind") != "translate_dubbing":
        raise HTTPException(status_code=404, detail="Translate dubbing task not found")
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


@router.post("/translate-dubbing-segments/task/{task_id}/cancel")
async def cancel_translate_dubbing_segments_task(task_id: str, state=Depends(get_app_state)):
    task = state.llm_tasks.get(task_id)
    if task is None or task.get("task_kind") != "translate_dubbing":
        raise HTTPException(status_code=404, detail="Translate dubbing task not found")
    if task["status"] in {"done", "error", "canceled"}:
        return {"task_id": task_id, "status": task["status"]}
    handle = state.llm_task_handles.get(task_id)
    if handle is None:
        task["status"] = "canceled"
        await _emit(state, task, task_id, {"type": "canceled", "message": "翻译配音任务已取消"})
        return {"task_id": task_id, "status": "canceled"}
    task["status"] = "cancel_requested"
    await _emit(state, task, task_id, {"type": "cancel_requested", "message": "正在取消翻译配音任务..."})
    handle.cancel()
    return {"task_id": task_id, "status": "cancel_requested"}


async def _run_parse_task(task_id: str, payload: LlmParseRequest, state) -> None:
    task = state.llm_tasks[task_id]
    task["status"] = "running"
    task["parse_mode"] = payload.parse_mode
    task["stage"] = "initializing"
    task["stage_label"] = "正在初始化解析任务"
    task["stage_progress"] = 2
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
        if cfg.llm_backend == "openai_compatible":
            llm_options["api_model"] = cfg.openai_compatible_model or cfg.llm_api_model
            llm_options["api_key"] = cfg.openai_compatible_api_key
            llm_options["api_base_url"] = cfg.openai_compatible_base_url
        elif cfg.llm_backend == "openai":
            llm_options["api_model"] = cfg.openai_model or cfg.llm_api_model
            llm_options["api_key"] = cfg.openai_api_key
            llm_options["api_base_url"] = cfg.openai_base_url
        elif cfg.llm_backend == "gemini":
            llm_options["api_model"] = cfg.gemini_model or cfg.llm_api_model
            llm_options["api_key"] = cfg.gemini_api_key
            llm_options["api_base_url"] = cfg.gemini_base_url

        chunk_counter = {"count": 0}

        async def on_chunk(piece: str) -> None:
            chunk_counter["count"] += 1
            await _emit(state, task, task_id, {"type": "chunk", "data": piece})
            if chunk_counter["count"] % 8 == 0:
                await _emit(state, task, task_id, {"type": "progress", "current": chunk_counter["count"], "total": 100, "percent": min(95, chunk_counter["count"])})

        async def on_chunk_progress(chunk: int, total_chunks: int) -> None:
            if payload.parse_mode == "two_step_pipeline" and task.get("stage") == "step1_structure":
                percent = max(10, min(56, 10 + int((chunk / max(total_chunks, 1)) * 46)))
            else:
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
            if payload.parse_mode == "two_step_pipeline" and task.get("stage") == "step1_structure":
                base = int(((chunk - 1) / max(total_chunks, 1)) * 46)
                percent = max(10, min(54, 10 + base + 2))
            else:
                base = int(((chunk - 1) / max(total_chunks, 1)) * 100)
                percent = max(10, min(95, base + 2))
            task["stage_progress"] = percent
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

        async def on_stage(stage: str, label: str, progress: int) -> None:
            normalized_progress = max(0, min(99, int(progress)))
            task["stage"] = stage
            task["stage_label"] = label
            task["stage_progress"] = normalized_progress
            await _emit(
                state,
                task,
                task_id,
                {
                    "type": "parse_stage",
                    "stage": stage,
                    "stage_label": label,
                    "stage_progress": normalized_progress,
                    "parse_mode": payload.parse_mode,
                },
            )
            await _emit(
                state,
                task,
                task_id,
                {
                    "type": "progress",
                    "current": normalized_progress,
                    "total": 100,
                    "percent": normalized_progress,
                },
            )

        script = await state.llm_engine.parse_text_chunked_stream(
            payload.text,
            payload.system_prompt or cfg.default_system_prompt or DEFAULT_PARSE_PROMPT,
            on_chunk=on_chunk,
            on_chunk_progress=on_chunk_progress,
            on_chunk_start=on_chunk_start,
            llm_options=llm_options,
            parse_mode=payload.parse_mode,
            on_stage=on_stage,
        )

        if payload.project_id:
            project = load_project(state.settings.projects_dir, payload.project_id)
            project.script = script
            project.status = "parsed" if script.segments else "draft"
            save_project(state.settings.projects_dir, project)

        parse_stats = dict(getattr(state.llm_engine, "last_parse_stats", {}) or {})
        if parse_stats:
            task["step_stats"] = parse_stats.get("step_stats") or {}
            await _emit(state, task, task_id, {"type": "parse_stats", "data": parse_stats})

        if state.orchestrator.config.auto_unload_llm_after_parse:
            await _emit(state, task, task_id, {"type": "model_unloading", "engine": "llm", "message": "正在卸载 LLM..."})
            await state.orchestrator.unload_llm()
            await _emit(state, task, task_id, {"type": "model_unloaded", "engine": "llm"})

        result = script.model_dump(mode="json")
        task["status"] = "done"
        task["result"] = result
        task["parse_stats"] = parse_stats if parse_stats else None
        task["stage"] = "done"
        task["stage_label"] = "解析完成"
        task["stage_progress"] = 100
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


def enqueue_parse_task(state, payload: LlmParseRequest) -> str:
    task_id = str(uuid4())
    state.llm_tasks[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "parse_mode": payload.parse_mode,
        "stage": "queued",
        "stage_label": "任务排队中",
        "stage_progress": 0,
        "step_stats": {},
        "result": None,
        "error": "",
        "project_id": payload.project_id,
        "events": [{"type": "task_status", "status": "queued"}],
    }
    handle = asyncio.create_task(_run_parse_task(task_id, payload, state))
    state.llm_task_handles[task_id] = handle
    return task_id


@router.post("/parse")
async def parse_text(payload: LlmParseRequest, state=Depends(get_app_state)):
    task_id = enqueue_parse_task(state, payload)
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
    return JSONResponse(
        status_code=202,
        content={
            "status": task["status"],
            "task_id": task_id,
            "parse_mode": task.get("parse_mode", "verified_five_step_pipeline"),
            "stage": task.get("stage", ""),
            "stage_label": task.get("stage_label", ""),
            "stage_progress": task.get("stage_progress", 0),
            "step_stats": task.get("step_stats", {}),
        },
    )


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
            "parse_mode": task.get("parse_mode", "verified_five_step_pipeline"),
            "stage": task.get("stage", "done"),
            "stage_label": task.get("stage_label", "解析完成"),
            "stage_progress": task.get("stage_progress", 100),
            "step_stats": (stats or {}).get("step_stats", task.get("step_stats", {})),
        }
    return JSONResponse(
        status_code=202,
        content={
            "task_id": task_id,
            "status": task.get("status", "queued"),
            "parse_stats": stats or {},
            "parse_mode": task.get("parse_mode", "verified_five_step_pipeline"),
            "stage": task.get("stage", ""),
            "stage_label": task.get("stage_label", ""),
            "stage_progress": task.get("stage_progress", 0),
            "step_stats": task.get("step_stats", {}),
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
