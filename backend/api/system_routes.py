from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from backend.engine import OrchestratorConfig
from backend.models import (
    FileBrowseRequest,
    LoadLlmRequest,
    LoadMusicRequest,
    LoadTtsRequest,
    OrchestratorConfigPayload,
)
from backend.runtime_config import (
    load_runtime_default_config,
    save_runtime_config,
    save_runtime_default_config,
)
from backend.state import get_app_state

router = APIRouter()


def _allowed_browse_roots(state) -> list[Path]:
    project_root = state.settings.base_dir.parent.resolve()
    return [
        state.settings.data_dir.resolve(),
        state.settings.projects_dir.resolve(),
        state.settings.voices_dir.resolve(),
        state.settings.output_dir.resolve(),
        (project_root / "models").resolve(),
        (project_root / "samples").resolve(),
    ]


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


@router.get("/status")
async def get_status(state=Depends(get_app_state)):
    status = await state.orchestrator.get_status()
    status["python_executable"] = sys.executable
    spec = importlib.util.find_spec("llama_cpp")
    status["llama_cpp_available"] = bool(spec)
    status["llama_cpp_module_path"] = spec.origin if spec else ""
    status["asr_backend"] = getattr(state.asr_engine, "backend_name", "unknown")
    status["asr_loaded"] = getattr(state.asr_engine, "is_loaded", False)
    status["asr_error"] = getattr(state.asr_engine, "last_error", "")
    status["asr_device"] = getattr(state.asr_engine, "device", "")
    status["asr_model_path"] = getattr(state.asr_engine, "model_path", "")
    pyannote_status = state.asr_engine.get_pyannote_status()
    status["pyannote_model_id"] = pyannote_status.get("pyannote_model_id", "")
    status["pyannote_loaded"] = bool(pyannote_status.get("pyannote_loaded", False))
    status["pyannote_error"] = pyannote_status.get("pyannote_error", "")
    status["pyannote_available"] = bool(pyannote_status.get("pyannote_available", False))
    return status


@router.get("/gpu-info")
async def get_gpu_info(state=Depends(get_app_state)):
    return state.orchestrator.get_gpu_info()


@router.put("/orchestrator/config")
async def update_orchestrator_config(payload: OrchestratorConfigPayload, state=Depends(get_app_state)):
    old_model_path = getattr(state.asr_engine, "model_path", "")
    old_device = getattr(state.asr_engine, "device", "")
    old_pyannote_model_id = getattr(state.asr_engine, "pyannote_model_id", "")
    old_pyannote_auth_token = getattr(state.asr_engine, "pyannote_auth_token", "")
    old_pyannote_device = getattr(state.asr_engine, "pyannote_device", "")
    old_music_model_dir = getattr(state.music_engine, "model_dir", "")
    old_music_device_mode = getattr(state.music_engine, "device_mode", "")
    config = OrchestratorConfig(**payload.model_dump())
    saved = await state.orchestrator.update_config(config)
    save_runtime_config(state.settings.runtime_config_path, config)
    state.asr_engine.model_path = config.asr_model_path
    state.asr_engine.device = config.asr_device
    state.asr_engine.pyannote_model_id = config.pyannote_model_id
    state.asr_engine.pyannote_auth_token = config.pyannote_auth_token
    state.asr_engine.pyannote_device = config.pyannote_device
    if state.asr_engine.is_loaded and (
        old_model_path != config.asr_model_path
        or old_device != config.asr_device
        or old_pyannote_model_id != config.pyannote_model_id
        or old_pyannote_auth_token != config.pyannote_auth_token
        or old_pyannote_device != config.pyannote_device
    ):
        await state.asr_engine.unload_model()
    if state.translation_llm_engine.is_loaded:
        await state.translation_llm_engine.unload_model()
        state.translation_engine_source = ""
        state.translation_engine_error = ""
    if state.music_assist_llm_engine.is_loaded:
        await state.music_assist_llm_engine.unload_model()
        state.music_assist_engine_source = ""
        state.music_assist_engine_error = ""
    if state.music_engine.is_loaded and (
        old_music_model_dir != str(Path(config.music_model_dir).expanduser().resolve())
        or old_music_device_mode != config.music_device_mode
    ):
        await state.music_engine.unload_model()
    return saved


@router.post("/orchestrator/config/reset")
async def reset_orchestrator_config(state=Depends(get_app_state)):
    old_model_path = getattr(state.asr_engine, "model_path", "")
    old_device = getattr(state.asr_engine, "device", "")
    old_pyannote_model_id = getattr(state.asr_engine, "pyannote_model_id", "")
    old_pyannote_auth_token = getattr(state.asr_engine, "pyannote_auth_token", "")
    old_pyannote_device = getattr(state.asr_engine, "pyannote_device", "")
    old_music_model_dir = getattr(state.music_engine, "model_dir", "")
    old_music_device_mode = getattr(state.music_engine, "device_mode", "")
    config = load_runtime_default_config(state.settings.runtime_defaults_config_path) or OrchestratorConfig()
    saved = await state.orchestrator.update_config(config)
    save_runtime_config(state.settings.runtime_config_path, config)
    state.asr_engine.model_path = config.asr_model_path
    state.asr_engine.device = config.asr_device
    state.asr_engine.pyannote_model_id = config.pyannote_model_id
    state.asr_engine.pyannote_auth_token = config.pyannote_auth_token
    state.asr_engine.pyannote_device = config.pyannote_device
    if state.asr_engine.is_loaded and (
        old_model_path != config.asr_model_path
        or old_device != config.asr_device
        or old_pyannote_model_id != config.pyannote_model_id
        or old_pyannote_auth_token != config.pyannote_auth_token
        or old_pyannote_device != config.pyannote_device
    ):
        await state.asr_engine.unload_model()
    if state.translation_llm_engine.is_loaded:
        await state.translation_llm_engine.unload_model()
        state.translation_engine_source = ""
        state.translation_engine_error = ""
    if state.music_assist_llm_engine.is_loaded:
        await state.music_assist_llm_engine.unload_model()
        state.music_assist_engine_source = ""
        state.music_assist_engine_error = ""
    if state.music_engine.is_loaded and (
        old_music_model_dir != str(Path(config.music_model_dir).expanduser().resolve())
        or old_music_device_mode != config.music_device_mode
    ):
        await state.music_engine.unload_model()
    return saved


@router.post("/orchestrator/config/defaults/use-current")
async def set_current_orchestrator_config_as_default(state=Depends(get_app_state)):
    current = state.orchestrator.config
    save_runtime_default_config(state.settings.runtime_defaults_config_path, current)
    return {
        "status": "ok",
        "message": "current config saved as reset default",
    }


@router.post("/load-llm")
async def load_llm(payload: LoadLlmRequest, state=Depends(get_app_state)):
    if payload.llm_backend is not None:
        state.orchestrator.config.llm_backend = payload.llm_backend
    if payload.llm_model_path is not None:
        state.orchestrator.config.llm_model_path = payload.llm_model_path
    if payload.llm_clip_model_path is not None:
        state.orchestrator.config.llm_clip_model_path = payload.llm_clip_model_path
    if payload.llm_api_model is not None:
        state.orchestrator.config.llm_api_model = payload.llm_api_model
    if payload.llm_n_ctx is not None:
        state.orchestrator.config.llm_n_ctx = payload.llm_n_ctx
    if payload.llm_n_gpu_layers is not None:
        state.orchestrator.config.llm_n_gpu_layers = payload.llm_n_gpu_layers
    if payload.llm_threads is not None:
        state.orchestrator.config.llm_threads = payload.llm_threads
    await state.orchestrator.ensure_llm_ready()
    return {"status": "ok", "backend": state.llm_engine.backend_name, "error": state.llm_engine.last_error}


@router.post("/unload-llm")
async def unload_llm(state=Depends(get_app_state)):
    await state.orchestrator.unload_llm()
    return {"status": "ok"}


@router.post("/load-tts")
async def load_tts(payload: LoadTtsRequest, state=Depends(get_app_state)):
    target_backend = (payload.tts_backend or "omnivoice").strip().lower()
    if target_backend not in {"omnivoice", "voxcpm2", "mock"}:
        target_backend = "omnivoice"
    if payload.tts_model_path is not None:
        if target_backend == "voxcpm2":
            state.orchestrator.config.voxcpm_tts_model_path = payload.tts_model_path
        else:
            state.orchestrator.config.tts_model_path = payload.tts_model_path
    if payload.tts_device is not None:
        state.orchestrator.config.tts_device = payload.tts_device
    await state.orchestrator.ensure_tts_ready(tts_backend=target_backend)
    return {"status": "ok", "backend": state.tts_engine.backend_name, "error": state.tts_engine.last_error}


@router.post("/unload-tts")
async def unload_tts(state=Depends(get_app_state)):
    await state.orchestrator.unload_tts()
    return {"status": "ok"}


@router.post("/load-music")
async def load_music(payload: LoadMusicRequest, state=Depends(get_app_state)):
    if payload.music_model_dir is not None:
        state.orchestrator.config.music_model_dir = payload.music_model_dir
    if payload.music_device_mode is not None:
        state.orchestrator.config.music_device_mode = payload.music_device_mode
    await state.orchestrator.ensure_music_ready()
    return {"status": "ok", "backend": state.music_engine.backend_name, "error": state.music_engine.last_error}


@router.post("/unload-music")
async def unload_music(state=Depends(get_app_state)):
    await state.orchestrator.unload_music()
    return {"status": "ok"}


@router.post("/unload-asr")
async def unload_asr(state=Depends(get_app_state)):
    await state.asr_engine.unload_model()
    state.asr_engine.last_error = ""
    return {"status": "ok"}


@router.post("/files/browse")
async def browse_files(payload: FileBrowseRequest, state=Depends(get_app_state)):
    base = Path(payload.path).expanduser().resolve()
    allowed_roots = _allowed_browse_roots(state)
    if not any(_is_within(base, root) for root in allowed_roots):
        raise HTTPException(status_code=403, detail="Path is outside allowed browse roots")
    entries = []
    if not base.exists():
        return entries
    for item in sorted(base.iterdir(), key=lambda entry: (entry.is_file(), entry.name.lower())):
        if payload.filter and payload.filter not in item.name:
            continue
        entries.append({"name": item.name, "path": str(item), "is_dir": item.is_dir()})
    return entries
