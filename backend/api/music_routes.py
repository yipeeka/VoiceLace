from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from backend.engine.llm_parser import extract_json_object, strip_json_fences
from backend.engine.music_prompts import build_music_assist_chat_prompt, build_music_assist_finalize_prompt
from backend.models import (
    AttachMusicAssetRequest,
    MusicAssistChatRequest,
    MusicAssistFinalizeRequest,
    MusicAssistLoadRequest,
    MusicGenerateRequest,
)
from backend.persistence import load_project
from backend.services import bind_postprocess_asset_to_project
from backend.state import get_app_state

router = APIRouter()
ALLOWED_ASSIST_SOURCES = {"primary_local", "secondary_local", "openai", "gemini"}
ALLOWED_VOCAL_LANGUAGES = {"unknown", "zh", "en", "ja", "ko"}
ALLOWED_BPMS = {60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180}
ALLOWED_KEYSCALES = {
    "C major",
    "G major",
    "D major",
    "A major",
    "E major",
    "B major",
    "F# major",
    "F major",
    "Bb major",
    "Eb major",
    "Ab major",
    "A minor",
    "E minor",
    "B minor",
    "F# minor",
    "C# minor",
    "G# minor",
    "D minor",
    "G minor",
    "C minor",
    "F minor",
}
ALLOWED_TIMESIGNATURES = {"4/4", "3/4", "2/4", "6/8", "12/8", "5/4", "7/8"}


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
        "cancel_message": task.get("cancel_message", ""),
        "result": task.get("result"),
    }


async def _mark_music_task_canceled(state, task: dict, task_id: str, *, message: str) -> None:
    task["status"] = "canceled"
    task["finished_at"] = _now_iso()
    task["cancel_message"] = message
    await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "canceled"})
    await _emit_music_event(state, task, task_id, {"type": "canceled", "message": message})


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


def _build_music_assist_config(state, source: str) -> dict[str, Any]:
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
    raise HTTPException(status_code=400, detail=f"Unsupported music assist source: {source}")


async def _load_music_assist_engine(state, source: str) -> dict[str, Any]:
    source = (source or "").strip().lower()
    if source not in ALLOWED_ASSIST_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported music assist source: {source}")

    config = _build_music_assist_config(state, source)
    engine = state.music_assist_llm_engine
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
        state.music_assist_engine_source = ""
        state.music_assist_engine_error = str(exc)
        raise HTTPException(status_code=503, detail=f"Music assist engine unavailable: {exc}") from exc

    state.music_assist_engine_source = source
    state.music_assist_engine_error = ""
    return {
        "status": "ok",
        "source": source,
        "backend": engine.backend_name,
        "model_name": engine.model_name,
        "error": engine.last_error or "",
    }


def _conversation_to_text(messages: list[Any]) -> str:
    lines: list[str] = []
    for item in messages:
        role = getattr(item, "role", "") or ""
        content = (getattr(item, "content", "") or "").strip()
        if not content:
            continue
        if role == "assistant":
            lines.append(f"助手: {content}")
        else:
            lines.append(f"用户: {content}")
    return "\n".join(lines).strip()


def _build_assist_form_snapshot(payload: Any) -> dict[str, Any]:
    return {
        "prompt": (payload.prompt or "").strip(),
        "lyrics": (payload.lyrics or "").strip(),
        "audio_duration": payload.audio_duration,
        "vocal_language": (payload.vocal_language or "").strip().lower() or "unknown",
        "bpm": payload.bpm,
        "keyscale": (payload.keyscale or "").strip() or None,
        "timesignature": (payload.timesignature or "").strip() or None,
    }


def _build_project_text_context(state, payload: Any) -> str:
    chunks: list[str] = []
    direct = str(getattr(payload, "context_text", "") or "").strip()
    if direct:
        chunks.append(direct)
    project_id = str(getattr(payload, "project_id", "") or "").strip()
    if project_id:
        try:
            project = load_project(state.settings.projects_dir, project_id)
            source_text = (project.script.source_text or "").strip()
            if source_text:
                chunks.append(source_text)
        except Exception:
            pass
    if not chunks:
        return ""
    merged = "\n\n".join(chunks).strip()
    if len(merged) > 5000:
        return merged[:5000]
    return merged


def _decode_assist_json(content: str) -> dict[str, Any]:
    cleaned = strip_json_fences(content or "")
    if not cleaned.strip():
        raise ValueError("Music assist returned empty content")
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        extracted = extract_json_object(cleaned)
        if not extracted:
            raise
        payload = json.loads(extracted)
    if not isinstance(payload, dict):
        raise ValueError("Music assist JSON must be an object")
    return payload


def _coerce_duration(value: Any, fallback: float) -> float:
    try:
        result = float(value)
    except Exception:
        return fallback
    return max(1.0, min(120.0, result))


def _normalize_music_assist_result(payload: dict[str, Any], fallback_form: dict[str, Any]) -> dict[str, Any]:
    prompt = str(payload.get("prompt") or fallback_form.get("prompt") or "").strip()
    lyrics = str(payload.get("lyrics") or fallback_form.get("lyrics") or "").strip()
    if not prompt:
        raise ValueError("Music assist result missing prompt")

    raw_lang = str(payload.get("vocal_language") or fallback_form.get("vocal_language") or "unknown").strip().lower()
    vocal_language = raw_lang if raw_lang in ALLOWED_VOCAL_LANGUAGES else "unknown"

    bpm = payload.get("bpm", fallback_form.get("bpm"))
    try:
        bpm_value = int(bpm) if bpm is not None else None
    except Exception:
        bpm_value = None
    if bpm_value not in ALLOWED_BPMS:
        bpm_value = None

    keyscale = str(payload.get("keyscale") or fallback_form.get("keyscale") or "").strip() or None
    if keyscale not in ALLOWED_KEYSCALES:
        keyscale = None

    timesignature = str(payload.get("timesignature") or fallback_form.get("timesignature") or "").strip() or None
    if timesignature not in ALLOWED_TIMESIGNATURES:
        timesignature = None

    notes = str(payload.get("notes") or "").strip()
    warnings_raw = payload.get("warnings")
    warnings: list[str] = []
    if isinstance(warnings_raw, list):
        warnings = [str(item).strip() for item in warnings_raw if str(item).strip()]

    return {
        "prompt": prompt,
        "lyrics": lyrics,
        "audio_duration": _coerce_duration(payload.get("audio_duration"), fallback_form.get("audio_duration") or 30.0),
        "vocal_language": vocal_language,
        "bpm": bpm_value,
        "keyscale": keyscale,
        "timesignature": timesignature,
        "notes": notes,
        "warnings": warnings,
    }


async def _run_music_task(task_id: str, payload: MusicGenerateRequest, state) -> None:
    task = state.music_tasks[task_id]
    output_path: Path | None = None
    try:
        if task.get("status") == "canceled":
            return
        async with state.music_task_lock:
            if task.get("status") == "canceled":
                return
            task["status"] = "running"
            task["started_at"] = _now_iso()
            await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "running"})

            if not bool(state.orchestrator.config.music_enabled):
                raise RuntimeError("音乐生成功能未启用（music_enabled=false）")
            if not state.orchestrator.config.music_model_dir.strip():
                raise RuntimeError("未配置音乐模型目录（music_model_dir）")

            async with state.music_assist_lock:
                if state.music_assist_llm_engine.is_loaded:
                    await state.music_assist_llm_engine.unload_model()
                    state.music_assist_engine_source = ""
                    state.music_assist_engine_error = ""

            if task.get("status") == "cancel_requested":
                await _mark_music_task_canceled(state, task, task_id, message="音乐生成任务已取消（生成前）")
                return

            await _emit_music_event(state, task, task_id, {"type": "task_stage", "stage": "loading_model"})
            await state.orchestrator.ensure_music_ready()

            if task.get("status") == "cancel_requested":
                await _mark_music_task_canceled(state, task, task_id, message="音乐生成任务已取消（模型加载后）")
                return

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

            if task.get("status") == "cancel_requested":
                if output_path is not None:
                    output_path.unlink(missing_ok=True)
                task["result"] = None
                await _mark_music_task_canceled(state, task, task_id, message="已请求取消，生成结果已丢弃")
                return

            task["status"] = "done"
            task["finished_at"] = _now_iso()
            task["cancel_message"] = ""
            task["result"] = {
                **result,
                "audio_url": f"/api/v1/music/tasks/{task_id}/audio",
                "model_dir": state.orchestrator.config.music_model_dir,
                "device_mode": state.orchestrator.config.music_device_mode,
            }
            await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "done"})
            await _emit_music_event(state, task, task_id, {"type": "complete", "data": task["result"]})
    except asyncio.CancelledError:
        if task.get("status") not in {"done", "error", "canceled"}:
            await _mark_music_task_canceled(state, task, task_id, message="音乐生成任务已取消")
    except Exception as exc:
        if task.get("status") == "cancel_requested":
            if output_path is not None:
                output_path.unlink(missing_ok=True)
            await _mark_music_task_canceled(state, task, task_id, message="音乐生成任务已取消")
            return
        task["status"] = "error"
        task["error"] = str(exc)
        task["finished_at"] = _now_iso()
        task["cancel_message"] = ""
        await _emit_music_event(state, task, task_id, {"type": "task_status", "status": "error"})
        await _emit_music_event(state, task, task_id, {"type": "error", "message": str(exc)})
    finally:
        state.music_task_handles.pop(task_id, None)


@router.post("/generate")
async def generate_music(payload: MusicGenerateRequest, state=Depends(get_app_state)):
    if not bool(state.orchestrator.config.music_enabled):
        raise HTTPException(status_code=400, detail="音乐生成功能未启用（music_enabled=false）")
    for item in state.music_tasks.values():
        if item.get("status") in {"queued", "running", "cancel_requested"}:
            raise HTTPException(status_code=409, detail="已有音乐任务正在进行，请等待当前任务结束")
    task_id = str(uuid4())
    task = {
        "task_id": task_id,
        "status": "queued",
        "project_id": payload.project_id,
        "created_at": _now_iso(),
        "started_at": "",
        "finished_at": "",
        "error": "",
        "cancel_message": "",
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


@router.get("/assist/status")
async def get_music_assist_status(state=Depends(get_app_state)):
    async with state.music_assist_lock:
        engine = state.music_assist_llm_engine
        return {
            "loaded": bool(engine.is_loaded),
            "source": state.music_assist_engine_source or "",
            "backend": engine.backend_name,
            "model_name": engine.model_name,
            "error": state.music_assist_engine_error or engine.last_error or "",
        }


@router.post("/assist/load")
async def load_music_assist(payload: MusicAssistLoadRequest, state=Depends(get_app_state)):
    async with state.music_assist_lock:
        return await _load_music_assist_engine(state, payload.source)


@router.post("/assist/unload")
async def unload_music_assist(state=Depends(get_app_state)):
    async with state.music_assist_lock:
        engine = state.music_assist_llm_engine
        if engine.is_loaded:
            await engine.unload_model()
        state.music_assist_engine_source = ""
        state.music_assist_engine_error = ""
        return {"status": "ok"}


@router.post("/assist/chat")
async def chat_music_assist(payload: MusicAssistChatRequest, state=Depends(get_app_state)):
    async with state.music_assist_lock:
        source = (payload.source or "").strip().lower()
        if source not in ALLOWED_ASSIST_SOURCES:
            raise HTTPException(status_code=400, detail=f"Unsupported music assist source: {payload.source}")
        if not state.music_assist_llm_engine.is_loaded or state.music_assist_engine_source != source:
            raise HTTPException(status_code=400, detail="Music assist engine source mismatch or not loaded. Please load engine first.")

        transcript = _conversation_to_text(payload.messages)
        if not transcript:
            raise HTTPException(status_code=400, detail="messages is required")

        form_snapshot = _build_assist_form_snapshot(payload)
        project_context = _build_project_text_context(state, payload)
        config = _build_music_assist_config(state, source)
        system_prompt = build_music_assist_chat_prompt(current_form=form_snapshot, project_context=project_context)
        try:
            reply = await state.music_assist_llm_engine.generate_text(
                text=transcript,
                system_prompt=system_prompt,
                llm_options=config["options"],
            )
        except Exception as exc:
            state.music_assist_engine_error = str(exc)
            raise HTTPException(status_code=503, detail=f"Music assist unavailable: {exc}") from exc

        state.music_assist_engine_error = ""
        return {
            "reply": reply.strip(),
            "source": source,
            "backend": state.music_assist_llm_engine.backend_name,
            "warnings": [],
        }


@router.post("/assist/finalize")
async def finalize_music_assist(payload: MusicAssistFinalizeRequest, state=Depends(get_app_state)):
    async with state.music_assist_lock:
        source = (payload.source or "").strip().lower()
        if source not in ALLOWED_ASSIST_SOURCES:
            raise HTTPException(status_code=400, detail=f"Unsupported music assist source: {payload.source}")
        if not state.music_assist_llm_engine.is_loaded or state.music_assist_engine_source != source:
            raise HTTPException(status_code=400, detail="Music assist engine source mismatch or not loaded. Please load engine first.")

        transcript = _conversation_to_text(payload.messages)
        if not transcript:
            raise HTTPException(status_code=400, detail="messages is required")

        form_snapshot = _build_assist_form_snapshot(payload)
        project_context = _build_project_text_context(state, payload)
        config = _build_music_assist_config(state, source)
        system_prompt = build_music_assist_finalize_prompt(current_form=form_snapshot, project_context=project_context)
        try:
            output = await state.music_assist_llm_engine.generate_text(
                text=transcript,
                system_prompt=system_prompt,
                llm_options=config["options"],
            )
            parsed = _decode_assist_json(output)
            normalized = _normalize_music_assist_result(parsed, form_snapshot)
        except Exception as exc:
            state.music_assist_engine_error = str(exc)
            raise HTTPException(status_code=503, detail=f"Music assist finalize failed: {exc}") from exc

        state.music_assist_engine_error = ""
        return {
            **normalized,
            "source": source,
            "backend": state.music_assist_llm_engine.backend_name,
        }


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
    if task["status"] == "queued":
        await _mark_music_task_canceled(state, task, task_id, message="音乐生成任务已取消（排队中）")
        return {"task_id": task_id, "status": "canceled"}
    if task["status"] != "cancel_requested":
        task["status"] = "cancel_requested"
        await _emit_music_event(state, task, task_id, {"type": "cancel_requested", "message": "正在取消音乐生成任务..."})
    return {"task_id": task_id, "status": "cancel_requested"}


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


@router.delete("/assets/{asset_name}")
async def delete_music_asset(asset_name: str, state=Depends(get_app_state)):
    source = _resolve_music_asset_path(state, asset_name)
    source.unlink(missing_ok=True)
    return {"status": "deleted", "asset_name": asset_name}


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
