from __future__ import annotations

import asyncio
import re
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
from backend.state import get_app_state

router = APIRouter()
ALLOWED_TRANSLATION_SOURCES = {"primary_local", "secondary_local", "openai", "gemini"}


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
        return {
            "backend": "openai",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
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
    if source == "gemini":
        return {
            "backend": "gemini",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
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


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _safe_duration_from_ms(start_ms: int | None, end_ms: int | None) -> float | None:
    if start_ms is None or end_ms is None:
        return None
    delta = int(end_ms) - int(start_ms)
    if delta <= 0:
        return None
    return max(0.3, min(60.0, delta / 1000.0))


def _estimate_speaking_seconds(text: str) -> float:
    raw = str(text or "").strip()
    if not raw:
        return 0.4
    cjk_count = len(re.findall(r"[\u4e00-\u9fff]", raw))
    latin_tokens = re.findall(r"[A-Za-z0-9']+", raw)
    punctuation = re.findall(r"[，。！？；,.!?;:]", raw)
    if cjk_count > 0:
        base = cjk_count / 4.6
    else:
        base = max(1, len(latin_tokens)) / 2.8
    pause = len(punctuation) * 0.08
    return max(0.4, min(60.0, base + pause))


def _build_dubbing_translate_prompt(*, target_language: str, target_duration_sec: float) -> str:
    lang = (target_language or "").strip() or "中文"
    return (
        "你是配音翻译编辑。请将用户输入翻译成目标语言，结果用于旁白/对白配音。"
        "要求：忠实原意、自然口语、尽量简洁，不要解释，不要注释。"
        f"\n目标语言：{lang}"
        f"\n目标口播时长：约 {target_duration_sec:.2f} 秒"
        "\n只输出最终译文正文。"
    )


def _build_dubbing_compress_prompt(*, target_language: str, target_duration_sec: float) -> str:
    lang = (target_language or "").strip() or "中文"
    return (
        "你是配音文本压缩编辑。请在保持原意的前提下，把文本压缩为更短的口播版本。"
        "要求：自然顺口，不要丢失关键信息，不要解释。"
        f"\n目标语言：{lang}"
        f"\n目标口播时长：约 {target_duration_sec:.2f} 秒"
        "\n只输出压缩后的正文。"
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
    source = (payload.source or "").strip().lower()
    if source not in ALLOWED_TRANSLATION_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported translation source: {payload.source}")
    if not payload.segments:
        raise HTTPException(status_code=400, detail="segments is required")
    if payload.min_speed > payload.max_speed:
        raise HTTPException(status_code=400, detail="min_speed must be <= max_speed")

    if not state.translation_llm_engine.is_loaded or state.translation_engine_source != source:
        raise HTTPException(
            status_code=400,
            detail="Translation engine source mismatch or not loaded. Please load translation engine first.",
        )

    config = _build_translation_config(state, source)
    translated_rows: list[dict[str, Any]] = []
    combined_source: list[str] = []
    combined_target: list[str] = []

    for idx, segment in enumerate(payload.segments):
        source_text = str(segment.text or "").strip()
        speaker = (str(segment.speaker or "").strip() or "narrator")
        seg_id = str(segment.id or f"dub-seg-{idx + 1}").strip() or f"dub-seg-{idx + 1}"
        start_ms = int(segment.start_ms) if segment.start_ms is not None else None
        end_ms = int(segment.end_ms) if segment.end_ms is not None else None

        target_duration_sec = _safe_duration_from_ms(start_ms, end_ms)
        if target_duration_sec is None:
            target_duration_sec = _estimate_speaking_seconds(source_text)
        target_duration_sec = _clamp(float(target_duration_sec), 0.3, 60.0)

        translated_text = source_text
        if source_text:
            prompt = _build_dubbing_translate_prompt(
                target_language=payload.target_language,
                target_duration_sec=target_duration_sec,
            )
            translated_text = (
                await state.translation_llm_engine.generate_text(
                    text=source_text,
                    system_prompt=prompt,
                    llm_options=config["options"],
                )
            ).strip()

            estimated_sec = _estimate_speaking_seconds(translated_text)
            if estimated_sec > target_duration_sec * float(payload.max_speed):
                compress_prompt = _build_dubbing_compress_prompt(
                    target_language=payload.target_language,
                    target_duration_sec=target_duration_sec,
                )
                compressed = (
                    await state.translation_llm_engine.generate_text(
                        text=translated_text,
                        system_prompt=compress_prompt,
                        llm_options=config["options"],
                    )
                ).strip()
                if compressed:
                    translated_text = compressed

        estimated_target_sec = _estimate_speaking_seconds(translated_text)
        if target_duration_sec <= 0:
            suggested_speed = 1.0
        else:
            suggested_speed = estimated_target_sec / target_duration_sec
        suggested_speed = _clamp(float(suggested_speed), float(payload.min_speed), float(payload.max_speed))

        duration_ms: int | None = None
        if start_ms is not None and end_ms is not None and end_ms >= start_ms:
            duration_ms = int(end_ms - start_ms)

        source_line = f"{speaker}：{source_text}" if source_text else ""
        target_line = f"{speaker}：{translated_text}" if translated_text else ""
        if source_line:
            combined_source.append(source_line)
        if target_line:
            combined_target.append(target_line)

        translated_rows.append(
            {
                "id": seg_id,
                "index": idx,
                "speaker": speaker,
                "source_text": source_text,
                "text": translated_text,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": duration_ms,
                "target_duration_sec": round(float(target_duration_sec), 3),
                "estimated_duration_sec": round(float(estimated_target_sec), 3),
                "tts_overrides": {
                    "duration": round(float(target_duration_sec), 3),
                    "speed": round(float(suggested_speed), 3),
                },
            }
        )

    state.translation_engine_error = ""
    return {
        "source": source,
        "target_language": payload.target_language,
        "backend": state.translation_llm_engine.backend_name,
        "segments": translated_rows,
        "source_text": "\n".join(combined_source),
        "translated_text": "\n".join(combined_target),
    }


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
            payload.system_prompt or DEFAULT_PARSE_PROMPT,
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
