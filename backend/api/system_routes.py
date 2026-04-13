from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

from fastapi import APIRouter, Depends

from backend.engine import OrchestratorConfig
from backend.models import FileBrowseRequest, OrchestratorConfigPayload
from backend.runtime_config import save_runtime_config
from backend.state import get_app_state

router = APIRouter()


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
    return status


@router.get("/gpu-info")
async def get_gpu_info(state=Depends(get_app_state)):
    return state.orchestrator.get_gpu_info()


@router.put("/orchestrator/config")
async def update_orchestrator_config(payload: OrchestratorConfigPayload, state=Depends(get_app_state)):
    old_model_path = getattr(state.asr_engine, "model_path", "")
    old_device = getattr(state.asr_engine, "device", "")
    config = OrchestratorConfig(**payload.model_dump())
    saved = await state.orchestrator.update_config(config)
    save_runtime_config(state.settings.runtime_config_path, config)
    state.asr_engine.model_path = config.asr_model_path
    state.asr_engine.device = config.asr_device
    if state.asr_engine.is_loaded and (old_model_path != config.asr_model_path or old_device != config.asr_device):
        await state.asr_engine.unload_model()
    return saved


@router.post("/orchestrator/config/reset")
async def reset_orchestrator_config(state=Depends(get_app_state)):
    old_model_path = getattr(state.asr_engine, "model_path", "")
    old_device = getattr(state.asr_engine, "device", "")
    config = OrchestratorConfig()
    saved = await state.orchestrator.update_config(config)
    save_runtime_config(state.settings.runtime_config_path, config)
    state.asr_engine.model_path = config.asr_model_path
    state.asr_engine.device = config.asr_device
    if state.asr_engine.is_loaded and (old_model_path != config.asr_model_path or old_device != config.asr_device):
        await state.asr_engine.unload_model()
    return saved


@router.post("/load-llm")
async def load_llm(payload: dict, state=Depends(get_app_state)):
    state.orchestrator.config.llm_backend = payload.get("backend", state.orchestrator.config.llm_backend)
    state.orchestrator.config.llm_model_path = payload.get("model_path", "")
    state.orchestrator.config.llm_api_model = payload.get("api_model", state.orchestrator.config.llm_api_model)
    state.orchestrator.config.llm_n_ctx = payload.get("n_ctx", 8192)
    state.orchestrator.config.llm_n_gpu_layers = payload.get("n_gpu_layers", -1)
    state.orchestrator.config.llm_threads = payload.get("threads", state.orchestrator.config.llm_threads)
    await state.orchestrator.ensure_llm_ready()
    return {"status": "ok", "backend": state.llm_engine.backend_name, "error": state.llm_engine.last_error}


@router.post("/unload-llm")
async def unload_llm(state=Depends(get_app_state)):
    await state.orchestrator.unload_llm()
    return {"status": "ok"}


@router.post("/load-tts")
async def load_tts(payload: dict, state=Depends(get_app_state)):
    state.orchestrator.config.tts_model_path = payload.get("model_path", "k2-fsa/OmniVoice")
    state.orchestrator.config.tts_device = payload.get("device", "cuda:0")
    await state.orchestrator.ensure_tts_ready()
    return {"status": "ok", "backend": state.tts_engine.backend_name, "error": state.tts_engine.last_error}


@router.post("/unload-tts")
async def unload_tts(state=Depends(get_app_state)):
    await state.orchestrator.unload_tts()
    return {"status": "ok"}


@router.post("/files/browse")
async def browse_files(payload: FileBrowseRequest):
    base = Path(payload.path).expanduser().resolve()
    entries = []
    if not base.exists():
        return entries
    for item in sorted(base.iterdir(), key=lambda entry: (entry.is_file(), entry.name.lower())):
        if payload.filter and payload.filter not in item.name:
            continue
        entries.append({"name": item.name, "path": str(item), "is_dir": item.is_dir()})
    return entries
