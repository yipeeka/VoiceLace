from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from backend.engine.llm_parser import extract_json_object, strip_json_fences
from backend.engine.music_prompts import build_music_assist_chat_prompt, build_music_assist_finalize_prompt
from backend.models import (
    AttachMusicAssetRequest,
    MusicAssetCategoryAssignRequest,
    MusicAssetCategoryCreateRequest,
    MusicAssetCategoryRenameRequest,
    MusicAssistChatRequest,
    MusicAssistFinalizeRequest,
    MusicAssistLoadRequest,
    MusicGenerateRequest,
    MusicModelSelectRequest,
    RenameMusicAssetRequest,
)
from backend.persistence import load_project
from backend.runtime_config import save_runtime_config
from backend.services import bind_postprocess_asset_to_project
from backend.state import get_app_state

router = APIRouter()
MUSIC_ASSET_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg"}
MUSIC_TASK_TYPES = {"text2music", "cover", "repaint", "lego", "extract", "complete"}
UNCATEGORIZED_CATEGORY_ID = "uncategorized"
MUSIC_ASSET_CATEGORY_INDEX_FILENAME = ".asset_categories.json"
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
    if source.suffix.lower() not in MUSIC_ASSET_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持音频文件")
    return source


def _music_asset_category_index_path(state) -> Path:
    return state.settings.output_dir / "music" / MUSIC_ASSET_CATEGORY_INDEX_FILENAME


def _default_music_asset_category_index() -> dict[str, Any]:
    return {
        "categories": [],
        "assignments": {},
    }


def _read_music_asset_category_index(state) -> dict[str, Any]:
    path = _music_asset_category_index_path(state)
    if not path.exists():
        return _default_music_asset_category_index()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return _default_music_asset_category_index()
    if not isinstance(payload, dict):
        return _default_music_asset_category_index()
    categories = payload.get("categories")
    assignments = payload.get("assignments")
    if not isinstance(categories, list):
        categories = []
    if not isinstance(assignments, dict):
        assignments = {}
    normalized_categories: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for item in categories:
        if not isinstance(item, dict):
            continue
        category_id = str(item.get("id") or "").strip()
        name = str(item.get("name") or "").strip()
        if not category_id or not name:
            continue
        if category_id == UNCATEGORIZED_CATEGORY_ID or category_id in seen_ids:
            continue
        seen_ids.add(category_id)
        normalized_categories.append(
            {
                "id": category_id,
                "name": name,
                "created_at": str(item.get("created_at") or _now_iso()),
                "updated_at": str(item.get("updated_at") or _now_iso()),
            }
        )
    normalized_assignments: dict[str, str] = {}
    for key, value in assignments.items():
        asset_name = str(key or "").strip()
        category_id = str(value or "").strip()
        if not asset_name or not category_id:
            continue
        if category_id == UNCATEGORIZED_CATEGORY_ID:
            continue
        normalized_assignments[asset_name] = category_id
    return {
        "categories": normalized_categories,
        "assignments": normalized_assignments,
    }


def _write_music_asset_category_index(state, payload: dict[str, Any]) -> None:
    path = _music_asset_category_index_path(state)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _normalize_music_category_name(name: str) -> str:
    normalized = str(name or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="分类名称不能为空")
    if len(normalized) > 40:
        raise HTTPException(status_code=400, detail="分类名称长度不能超过 40")
    return normalized


def _build_music_categories_response(categories: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {"id": UNCATEGORIZED_CATEGORY_ID, "name": "未分类", "builtin": True},
        *[
            {
                "id": str(item.get("id") or ""),
                "name": str(item.get("name") or ""),
                "builtin": False,
            }
            for item in categories
        ],
    ]


def _build_music_asset_items_with_categories(*, payload: dict[str, Any], candidates: list[Path]) -> tuple[list[dict[str, Any]], bool]:
    categories = payload.get("categories") or []
    assignments = payload.get("assignments") or {}
    category_name_by_id = {
        str(item.get("id") or ""): str(item.get("name") or "")
        for item in categories
        if str(item.get("id") or "").strip()
    }
    items: list[dict[str, Any]] = []
    existing_asset_names: set[str] = set()
    changed = False
    for audio_file in sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True):
        stat = audio_file.stat()
        asset_name = audio_file.name
        existing_asset_names.add(asset_name)
        raw_category_id = str(assignments.get(asset_name) or "").strip()
        category_id = raw_category_id if raw_category_id in category_name_by_id else UNCATEGORIZED_CATEGORY_ID
        if raw_category_id and category_id == UNCATEGORIZED_CATEGORY_ID:
            assignments.pop(asset_name, None)
            changed = True
        items.append(
            {
                "name": asset_name,
                "path": str(audio_file),
                "size": int(stat.st_size),
                "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "category_id": category_id,
                "category_name": category_name_by_id.get(category_id, "未分类"),
            }
        )

    stale_keys = [key for key in list(assignments.keys()) if key not in existing_asset_names]
    if stale_keys:
        for key in stale_keys:
            assignments.pop(key, None)
        changed = True

    return items, changed


def _resolve_music_asset_rename_target(state, source: Path, new_name: str) -> Path:
    music_dir = (state.settings.output_dir / "music").resolve()
    cleaned = str(new_name or "").strip()
    if not cleaned:
        raise HTTPException(status_code=400, detail="new_name 不能为空")
    normalized_name = Path(cleaned).name
    if normalized_name != cleaned:
        raise HTTPException(status_code=400, detail="new_name 非法")
    target = (music_dir / normalized_name).resolve()
    try:
        target.relative_to(music_dir)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="new_name 非法") from exc

    target_suffix = target.suffix.lower()
    if not target_suffix:
        target = target.with_suffix(source.suffix.lower())
        target_suffix = target.suffix.lower()
    if target_suffix not in MUSIC_ASSET_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持音频文件重命名")
    if target == source:
        return source
    if target.exists():
        raise HTTPException(status_code=409, detail="目标文件名已存在")
    return target


def _normalize_music_task_type(task_type: str) -> str:
    normalized = (task_type or "text2music").strip().lower()
    if normalized not in MUSIC_TASK_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported task_type: {task_type}")
    return normalized


def _supported_task_types_from_report(report: dict[str, Any]) -> list[str]:
    supported_task_types = ["text2music", "cover", "repaint"]
    if bool(report.get("supports_lego_complete")):
        supported_task_types.extend(["lego", "extract", "complete"])
    return supported_task_types


def _validate_music_generation_payload(state, payload: MusicGenerateRequest) -> dict[str, Any]:
    from backend.engine.music_engine import MusicEngine

    selected_variant = str(getattr(state.orchestrator.config, "music_model_variant", "turbo") or "turbo").strip().lower()
    task_type = _normalize_music_task_type(payload.task_type)
    source_name = (payload.source_asset_name or "").strip()
    reference_name = (payload.reference_asset_name or "").strip()
    track_name = (payload.track_name or "").strip() or None
    complete_track_classes = [str(item).strip() for item in (payload.complete_track_classes or []) if str(item).strip()]

    source_required = task_type in {"cover", "repaint", "lego", "extract", "complete"}
    if source_required and not source_name:
        raise HTTPException(status_code=400, detail=f"{task_type} 任务需要 source_asset_name")
    if task_type in {"extract", "lego"} and not track_name:
        raise HTTPException(status_code=400, detail=f"{task_type} 任务需要 track_name")
    if task_type in {"repaint", "lego"}:
        repaint_start = payload.repainting_start
        repaint_end = payload.repainting_end
        if repaint_start is not None and repaint_end is not None and repaint_end > 0 and repaint_start >= repaint_end:
            raise HTTPException(status_code=400, detail="repainting_start 必须小于 repainting_end")
    if selected_variant == "turbo":
        shift = float(payload.shift)
        if shift not in {1.0, 2.0, 3.0}:
            raise HTTPException(status_code=400, detail="Turbo 模型只支持 shift 1.0 / 2.0 / 3.0")
    if selected_variant == "base" and (int(payload.num_inference_steps) < 32 or int(payload.num_inference_steps) > 100):
        raise HTTPException(status_code=400, detail="Base 模型推理步数需要 32 - 100")
    if task_type in {"lego", "extract", "complete"}:
        model_report = MusicEngine.validate_model_dir(
            state.orchestrator.get_active_music_model_dir(state.orchestrator.config)
        )
        if bool(model_report.get("is_turbo")):
            raise HTTPException(status_code=400, detail=f"{task_type} 任务仅支持 Base 模型，当前模型为 Turbo")

    source_audio_path = _resolve_music_asset_path(state, source_name) if source_name else None
    reference_audio_path = _resolve_music_asset_path(state, reference_name) if reference_name else None

    return {
        "task_type": task_type,
        "source_asset_name": source_name or None,
        "reference_asset_name": reference_name or None,
        "source_audio_path": source_audio_path,
        "reference_audio_path": reference_audio_path,
        "track_name": track_name,
        "complete_track_classes": complete_track_classes,
    }


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
            active_music_model_dir = state.orchestrator.get_active_music_model_dir(state.orchestrator.config)
            if not active_music_model_dir.strip():
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
            runtime_options = task.get("runtime_options") or {}
            selected_variant = str(getattr(state.orchestrator.config, "music_model_variant", "turbo") or "turbo").strip().lower()
            effective_guidance_scale = 0.0 if selected_variant == "turbo" else payload.guidance_scale
            result = await state.music_engine.generate_to_file(
                task_type=runtime_options.get("task_type", payload.task_type),
                prompt=payload.prompt,
                output_path=output_path,
                lyrics=payload.lyrics,
                audio_duration=payload.audio_duration,
                vocal_language=payload.vocal_language,
                num_inference_steps=payload.num_inference_steps,
                seed=payload.seed,
                source_audio_path=runtime_options.get("source_audio_path"),
                reference_audio_path=runtime_options.get("reference_audio_path"),
                bpm=payload.bpm,
                keyscale=payload.keyscale,
                timesignature=payload.timesignature,
                track_name=runtime_options.get("track_name"),
                complete_track_classes=runtime_options.get("complete_track_classes"),
                repainting_start=payload.repainting_start,
                repainting_end=payload.repainting_end,
                audio_cover_strength=payload.audio_cover_strength,
                guidance_scale=effective_guidance_scale,
                shift=payload.shift,
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
                "model_dir": state.orchestrator.get_active_music_model_dir(state.orchestrator.config),
                "device_mode": state.orchestrator.config.music_device_mode,
                "model_variant": state.orchestrator.config.music_model_variant,
                "task_type": runtime_options.get("task_type", payload.task_type),
                "source_asset_name": runtime_options.get("source_asset_name"),
                "reference_asset_name": runtime_options.get("reference_asset_name"),
                "track_name": runtime_options.get("track_name"),
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
    runtime_options = _validate_music_generation_payload(state, payload)
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
        "runtime_options": runtime_options,
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

    active_model_dir = state.orchestrator.get_active_music_model_dir(state.orchestrator.config)
    report = MusicEngine.validate_model_dir(active_model_dir)
    supported_task_types = _supported_task_types_from_report(report)
    report["music_enabled"] = bool(state.orchestrator.config.music_enabled)
    report["device_mode"] = state.orchestrator.config.music_device_mode
    report["model_variant"] = state.orchestrator.config.music_model_variant
    report["music_turbo_model_dir"] = state.orchestrator.config.music_turbo_model_dir
    report["music_base_model_dir"] = state.orchestrator.config.music_base_model_dir
    report["supported_task_types"] = supported_task_types
    return report


@router.post("/model/select")
async def select_music_model_variant(payload: MusicModelSelectRequest, state=Depends(get_app_state)):
    old_model_dir = getattr(state.music_engine, "model_dir", "")
    config = state.orchestrator.config
    config.music_model_variant = payload.model_variant
    state.orchestrator.set_config(config)
    save_runtime_config(state.settings.runtime_config_path, state.orchestrator.config)
    active_model_dir = state.orchestrator.get_active_music_model_dir(state.orchestrator.config)
    if state.music_engine.is_loaded:
        try:
            resolved_active = str(Path(active_model_dir).expanduser().resolve())
        except Exception:
            resolved_active = str(active_model_dir)
        if old_model_dir != resolved_active:
            await state.music_engine.unload_model()

    from backend.engine.music_engine import MusicEngine

    report = MusicEngine.validate_model_dir(active_model_dir)
    return {
        "status": "ok",
        "model_variant": state.orchestrator.config.music_model_variant,
        "model_dir": active_model_dir,
        "supported_task_types": _supported_task_types_from_report(report),
        "music_enabled": bool(state.orchestrator.config.music_enabled),
        "device_mode": state.orchestrator.config.music_device_mode,
    }


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
    category_payload = _read_music_asset_category_index(state)
    if not music_dir.exists():
        return {
            "items": [],
            "categories": _build_music_categories_response(category_payload.get("categories") or []),
        }
    candidates: list[Path] = []
    for suffix in MUSIC_ASSET_SUFFIXES:
        candidates.extend(music_dir.glob(f"*{suffix}"))
    items, changed = _build_music_asset_items_with_categories(payload=category_payload, candidates=candidates)
    if changed:
        _write_music_asset_category_index(state, category_payload)
    return {
        "items": items,
        "categories": _build_music_categories_response(category_payload.get("categories") or []),
    }


@router.post("/assets/categories")
async def create_music_asset_category(payload: MusicAssetCategoryCreateRequest, state=Depends(get_app_state)):
    category_payload = _read_music_asset_category_index(state)
    categories = category_payload.get("categories") or []
    normalized_name = _normalize_music_category_name(payload.name)
    lowered = normalized_name.lower()
    if lowered == "未分类":
        raise HTTPException(status_code=400, detail="分类名称不可与内置分类重复")
    if any(str(item.get("name") or "").strip().lower() == lowered for item in categories):
        raise HTTPException(status_code=409, detail="分类名称已存在")
    now = _now_iso()
    created = {
        "id": f"cat_{uuid4().hex[:10]}",
        "name": normalized_name,
        "created_at": now,
        "updated_at": now,
    }
    categories.append(created)
    category_payload["categories"] = categories
    _write_music_asset_category_index(state, category_payload)
    return {
        "status": "created",
        "category": {"id": created["id"], "name": created["name"], "builtin": False},
        "categories": _build_music_categories_response(categories),
    }


@router.post("/assets/categories/{category_id}/rename")
async def rename_music_asset_category(category_id: str, payload: MusicAssetCategoryRenameRequest, state=Depends(get_app_state)):
    normalized_id = str(category_id or "").strip()
    if normalized_id == UNCATEGORIZED_CATEGORY_ID:
        raise HTTPException(status_code=400, detail="内置分类不可重命名")
    category_payload = _read_music_asset_category_index(state)
    categories = category_payload.get("categories") or []
    normalized_name = _normalize_music_category_name(payload.name)
    lowered = normalized_name.lower()
    for item in categories:
        if str(item.get("id") or "").strip() != normalized_id and str(item.get("name") or "").strip().lower() == lowered:
            raise HTTPException(status_code=409, detail="分类名称已存在")
    target: dict[str, Any] | None = None
    for item in categories:
        if str(item.get("id") or "").strip() == normalized_id:
            target = item
            break
    if target is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    target["name"] = normalized_name
    target["updated_at"] = _now_iso()
    _write_music_asset_category_index(state, category_payload)
    return {
        "status": "renamed",
        "category": {"id": target["id"], "name": target["name"], "builtin": False},
        "categories": _build_music_categories_response(categories),
    }


@router.delete("/assets/categories/{category_id}")
async def delete_music_asset_category(category_id: str, state=Depends(get_app_state)):
    normalized_id = str(category_id or "").strip()
    if normalized_id == UNCATEGORIZED_CATEGORY_ID:
        raise HTTPException(status_code=400, detail="内置分类不可删除")
    category_payload = _read_music_asset_category_index(state)
    categories = category_payload.get("categories") or []
    assignments = category_payload.get("assignments") or {}
    kept_categories = [item for item in categories if str(item.get("id") or "").strip() != normalized_id]
    if len(kept_categories) == len(categories):
        raise HTTPException(status_code=404, detail="分类不存在")
    for key, value in list(assignments.items()):
        if str(value or "").strip() == normalized_id:
            assignments.pop(key, None)
    category_payload["categories"] = kept_categories
    category_payload["assignments"] = assignments
    _write_music_asset_category_index(state, category_payload)
    return {
        "status": "deleted",
        "category_id": normalized_id,
        "categories": _build_music_categories_response(kept_categories),
    }


@router.post("/assets/{asset_name}/category")
async def set_music_asset_category(asset_name: str, payload: MusicAssetCategoryAssignRequest, state=Depends(get_app_state)):
    source = _resolve_music_asset_path(state, asset_name)
    normalized_id = str(payload.category_id or "").strip()
    category_payload = _read_music_asset_category_index(state)
    assignments = category_payload.get("assignments") or {}
    categories = category_payload.get("categories") or []
    if not normalized_id or normalized_id == UNCATEGORIZED_CATEGORY_ID:
        assignments.pop(source.name, None)
        category_payload["assignments"] = assignments
        _write_music_asset_category_index(state, category_payload)
        return {
            "status": "updated",
            "asset_name": source.name,
            "category_id": UNCATEGORIZED_CATEGORY_ID,
            "category_name": "未分类",
            "categories": _build_music_categories_response(categories),
        }

    target_category = None
    for item in categories:
        if str(item.get("id") or "").strip() == normalized_id:
            target_category = item
            break
    if target_category is None:
        raise HTTPException(status_code=404, detail="分类不存在")
    assignments[source.name] = normalized_id
    category_payload["assignments"] = assignments
    _write_music_asset_category_index(state, category_payload)
    return {
        "status": "updated",
        "asset_name": source.name,
        "category_id": normalized_id,
        "category_name": str(target_category.get("name") or ""),
        "categories": _build_music_categories_response(categories),
    }


@router.post("/assets/upload")
async def upload_music_asset(file: UploadFile = File(...), state=Depends(get_app_state)):
    filename = file.filename or ""
    suffix = Path(filename).suffix.lower() or ".wav"
    if suffix not in MUSIC_ASSET_SUFFIXES:
        raise HTTPException(status_code=400, detail="仅支持 wav/mp3/flac/ogg 文件")
    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="上传文件为空")

    music_dir = state.settings.output_dir / "music"
    music_dir.mkdir(parents=True, exist_ok=True)
    target_name = f"upload_{uuid4().hex[:10]}{suffix}"
    target_path = music_dir / target_name
    target_path.write_bytes(payload)
    stat = target_path.stat()
    return {
        "name": target_name,
        "path": str(target_path),
        "size": int(stat.st_size),
        "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


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
    category_payload = _read_music_asset_category_index(state)
    assignments = category_payload.get("assignments") or {}
    if source.name in assignments:
        assignments.pop(source.name, None)
        category_payload["assignments"] = assignments
        _write_music_asset_category_index(state, category_payload)
    return {"status": "deleted", "asset_name": asset_name}


@router.post("/assets/{asset_name}/rename")
async def rename_music_asset(asset_name: str, payload: RenameMusicAssetRequest, state=Depends(get_app_state)):
    source = _resolve_music_asset_path(state, asset_name)
    target = _resolve_music_asset_rename_target(state, source, payload.new_name)
    if target != source:
        category_payload = _read_music_asset_category_index(state)
        assignments = category_payload.get("assignments") or {}
        old_name = source.name
        old_assignment = assignments.get(old_name)
        try:
            source.rename(target)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"重命名失败: {exc}") from exc
        if old_assignment:
            assignments.pop(old_name, None)
            assignments[target.name] = old_assignment
            category_payload["assignments"] = assignments
            _write_music_asset_category_index(state, category_payload)
    stat = target.stat()
    return {
        "status": "renamed",
        "old_name": source.name,
        "name": target.name,
        "path": str(target),
        "size": int(stat.st_size),
        "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


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
