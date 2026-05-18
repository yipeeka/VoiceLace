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
from backend.services.audio_vocal_separation_service import build_vocal_separation_status
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


def normalize_mcp_mount_path(raw: str | None) -> str:
    value = str(raw or "/mcp").strip() or "/mcp"
    if not value.startswith("/"):
        value = f"/{value}"
    value = value.rstrip("/") or "/mcp"
    if value == "/":
        return "/mcp"
    return value


@router.get("/status")
async def get_status(state=Depends(get_app_state)):
    status = await state.orchestrator.get_status()
    status["mcp_enabled"] = bool(getattr(state.orchestrator.config, "mcp_enabled", False))
    status["mcp_mount_path"] = normalize_mcp_mount_path(getattr(state.orchestrator.config, "mcp_mount_path", "/mcp"))
    status["mcp_url"] = status["mcp_mount_path"] if status["mcp_enabled"] else ""
    status["python_executable"] = sys.executable
    spec = importlib.util.find_spec("llama_cpp")
    status["llama_cpp_available"] = bool(spec)
    status["llama_cpp_module_path"] = spec.origin if spec else ""
    status["asr_backend"] = getattr(state.asr_engine, "backend_name", "unknown")
    status["asr_loaded"] = getattr(state.asr_engine, "is_loaded", False)
    status["asr_error"] = getattr(state.asr_engine, "last_error", "")
    status["asr_device"] = getattr(state.asr_engine, "device", "")
    status["asr_model_path"] = getattr(state.asr_engine, "model_path", "")
    status["asr_default_backend"] = getattr(state.asr_engine, "default_backend", "whisper")
    status["qwen3_asr_crispasr_exe"] = getattr(state.asr_engine, "crispasr_exe", "")
    status["qwen3_asr_model_path"] = getattr(state.asr_engine, "qwen3_model_path", "")
    status["qwen3_asr_forced_aligner_model_path"] = getattr(state.asr_engine, "qwen3_forced_aligner_model_path", "")
    status["qwen3_asr_threads"] = int(getattr(state.asr_engine, "qwen3_threads", 0) or 0)
    status["qwen3_asr_language"] = getattr(state.asr_engine, "qwen3_language", "auto")
    status["qwen3_asr_enable_timestamps"] = bool(getattr(state.asr_engine, "qwen3_enable_timestamps", False))
    config = state.orchestrator.config
    vocal_status = build_vocal_separation_status(
        enabled=bool(getattr(config, "asr_vocal_separation_enabled", False)),
        model=str(getattr(config, "asr_vocal_separation_model", "htdemucs") or "htdemucs"),
        repo_dir=str(getattr(config, "asr_vocal_separation_repo_dir", "") or ""),
        device=str(getattr(config, "asr_vocal_separation_device", "") or ""),
        last_error=str(getattr(state, "asr_vocal_separation_error", "") or ""),
    )
    status["asr_vocal_separation"] = vocal_status
    status["asr_vocal_separation_enabled"] = vocal_status["enabled"]
    status["asr_vocal_separation_model"] = vocal_status["model"]
    status["asr_vocal_separation_repo_dir"] = vocal_status["repo_dir"]
    status["asr_vocal_separation_repo_dir_exists"] = vocal_status["repo_dir_exists"]
    status["asr_vocal_separation_available"] = vocal_status["available"]
    status["asr_vocal_separation_error"] = vocal_status["last_error"]
    crispasr_exe = Path(str(status["qwen3_asr_crispasr_exe"] or "")).expanduser() if status["qwen3_asr_crispasr_exe"] else None
    qwen3_model = Path(str(status["qwen3_asr_model_path"] or "")).expanduser() if status["qwen3_asr_model_path"] else None
    qwen3_aligner = (
        Path(str(status["qwen3_asr_forced_aligner_model_path"] or "")).expanduser()
        if status["qwen3_asr_forced_aligner_model_path"]
        else None
    )
    status["qwen3_asr_crispasr_exe_exists"] = bool(crispasr_exe and crispasr_exe.exists() and crispasr_exe.is_file())
    status["qwen3_asr_model_exists"] = bool(qwen3_model and qwen3_model.exists() and qwen3_model.is_file())
    status["qwen3_asr_forced_aligner_model_exists"] = bool(qwen3_aligner and qwen3_aligner.exists() and qwen3_aligner.is_file())
    status["qwen3_asr_ready"] = bool(status["qwen3_asr_crispasr_exe_exists"] and status["qwen3_asr_model_exists"])
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
    old_asr_backend = getattr(state.asr_engine, "default_backend", "whisper")
    old_model_path = getattr(state.asr_engine, "model_path", "")
    old_device = getattr(state.asr_engine, "device", "")
    old_qwen3_crispasr_exe = getattr(state.asr_engine, "crispasr_exe", "")
    old_qwen3_model_path = getattr(state.asr_engine, "qwen3_model_path", "")
    old_qwen3_forced_aligner_model_path = getattr(state.asr_engine, "qwen3_forced_aligner_model_path", "")
    old_qwen3_threads = int(getattr(state.asr_engine, "qwen3_threads", 0) or 0)
    old_qwen3_language = getattr(state.asr_engine, "qwen3_language", "auto")
    old_qwen3_timestamps = bool(getattr(state.asr_engine, "qwen3_enable_timestamps", False))
    old_pyannote_model_id = getattr(state.asr_engine, "pyannote_model_id", "")
    old_pyannote_auth_token = getattr(state.asr_engine, "pyannote_auth_token", "")
    old_pyannote_device = getattr(state.asr_engine, "pyannote_device", "")
    old_music_model_dir = getattr(state.music_engine, "model_dir", "")
    old_music_device_mode = getattr(state.music_engine, "device_mode", "")
    raw_config = payload.model_dump()
    raw_config["mcp_mount_path"] = normalize_mcp_mount_path(raw_config.get("mcp_mount_path"))
    config = OrchestratorConfig(**raw_config)
    next_music_model_dir = state.orchestrator.get_active_music_model_dir(config)
    saved = await state.orchestrator.update_config(config)
    save_runtime_config(state.settings.runtime_config_path, config)
    state.asr_engine.default_backend = config.asr_backend
    state.asr_engine.model_path = config.asr_model_path
    state.asr_engine.device = config.asr_device
    state.asr_engine.crispasr_exe = config.qwen3_asr_crispasr_exe
    state.asr_engine.qwen3_model_path = config.qwen3_asr_model_path
    state.asr_engine.qwen3_forced_aligner_model_path = config.qwen3_asr_forced_aligner_model_path
    state.asr_engine.qwen3_threads = int(config.qwen3_asr_threads)
    state.asr_engine.qwen3_language = config.qwen3_asr_language
    state.asr_engine.qwen3_enable_timestamps = bool(config.qwen3_asr_enable_timestamps)
    state.asr_engine.pyannote_model_id = config.pyannote_model_id
    state.asr_engine.pyannote_auth_token = config.pyannote_auth_token
    state.asr_engine.pyannote_device = config.pyannote_device
    state.asr_vocal_separation_error = ""
    if state.asr_engine.is_loaded and (
        old_asr_backend != config.asr_backend
        or old_model_path != config.asr_model_path
        or old_device != config.asr_device
        or old_qwen3_crispasr_exe != config.qwen3_asr_crispasr_exe
        or old_qwen3_model_path != config.qwen3_asr_model_path
        or old_qwen3_forced_aligner_model_path != config.qwen3_asr_forced_aligner_model_path
        or old_qwen3_threads != int(config.qwen3_asr_threads)
        or old_qwen3_language != config.qwen3_asr_language
        or old_qwen3_timestamps != bool(config.qwen3_asr_enable_timestamps)
        or old_pyannote_model_id != config.pyannote_model_id
        or old_pyannote_auth_token != config.pyannote_auth_token
        or old_pyannote_device != config.pyannote_device
    ):
        await state.orchestrator.unload_asr()
    if state.translation_llm_engine.is_loaded:
        await state.translation_llm_engine.unload_model()
        state.translation_engine_source = ""
        state.translation_engine_error = ""
    if state.music_assist_llm_engine.is_loaded:
        await state.music_assist_llm_engine.unload_model()
        state.music_assist_engine_source = ""
        state.music_assist_engine_error = ""
    if state.music_engine.is_loaded and (
        old_music_model_dir != str(Path(next_music_model_dir).expanduser().resolve())
        or old_music_device_mode != config.music_device_mode
    ):
        await state.music_engine.unload_model()
    return saved


@router.post("/orchestrator/config/reset")
async def reset_orchestrator_config(state=Depends(get_app_state)):
    old_asr_backend = getattr(state.asr_engine, "default_backend", "whisper")
    old_model_path = getattr(state.asr_engine, "model_path", "")
    old_device = getattr(state.asr_engine, "device", "")
    old_qwen3_crispasr_exe = getattr(state.asr_engine, "crispasr_exe", "")
    old_qwen3_model_path = getattr(state.asr_engine, "qwen3_model_path", "")
    old_qwen3_forced_aligner_model_path = getattr(state.asr_engine, "qwen3_forced_aligner_model_path", "")
    old_qwen3_threads = int(getattr(state.asr_engine, "qwen3_threads", 0) or 0)
    old_qwen3_language = getattr(state.asr_engine, "qwen3_language", "auto")
    old_qwen3_timestamps = bool(getattr(state.asr_engine, "qwen3_enable_timestamps", False))
    old_pyannote_model_id = getattr(state.asr_engine, "pyannote_model_id", "")
    old_pyannote_auth_token = getattr(state.asr_engine, "pyannote_auth_token", "")
    old_pyannote_device = getattr(state.asr_engine, "pyannote_device", "")
    old_music_model_dir = getattr(state.music_engine, "model_dir", "")
    old_music_device_mode = getattr(state.music_engine, "device_mode", "")
    config = load_runtime_default_config(state.settings.runtime_defaults_config_path) or OrchestratorConfig()
    config.mcp_mount_path = normalize_mcp_mount_path(config.mcp_mount_path)
    next_music_model_dir = state.orchestrator.get_active_music_model_dir(config)
    saved = await state.orchestrator.update_config(config)
    save_runtime_config(state.settings.runtime_config_path, config)
    state.asr_engine.default_backend = config.asr_backend
    state.asr_engine.model_path = config.asr_model_path
    state.asr_engine.device = config.asr_device
    state.asr_engine.crispasr_exe = config.qwen3_asr_crispasr_exe
    state.asr_engine.qwen3_model_path = config.qwen3_asr_model_path
    state.asr_engine.qwen3_forced_aligner_model_path = config.qwen3_asr_forced_aligner_model_path
    state.asr_engine.qwen3_threads = int(config.qwen3_asr_threads)
    state.asr_engine.qwen3_language = config.qwen3_asr_language
    state.asr_engine.qwen3_enable_timestamps = bool(config.qwen3_asr_enable_timestamps)
    state.asr_engine.pyannote_model_id = config.pyannote_model_id
    state.asr_engine.pyannote_auth_token = config.pyannote_auth_token
    state.asr_engine.pyannote_device = config.pyannote_device
    state.asr_vocal_separation_error = ""
    if state.asr_engine.is_loaded and (
        old_asr_backend != config.asr_backend
        or old_model_path != config.asr_model_path
        or old_device != config.asr_device
        or old_qwen3_crispasr_exe != config.qwen3_asr_crispasr_exe
        or old_qwen3_model_path != config.qwen3_asr_model_path
        or old_qwen3_forced_aligner_model_path != config.qwen3_asr_forced_aligner_model_path
        or old_qwen3_threads != int(config.qwen3_asr_threads)
        or old_qwen3_language != config.qwen3_asr_language
        or old_qwen3_timestamps != bool(config.qwen3_asr_enable_timestamps)
        or old_pyannote_model_id != config.pyannote_model_id
        or old_pyannote_auth_token != config.pyannote_auth_token
        or old_pyannote_device != config.pyannote_device
    ):
        await state.orchestrator.unload_asr()
    if state.translation_llm_engine.is_loaded:
        await state.translation_llm_engine.unload_model()
        state.translation_engine_source = ""
        state.translation_engine_error = ""
    if state.music_assist_llm_engine.is_loaded:
        await state.music_assist_llm_engine.unload_model()
        state.music_assist_engine_source = ""
        state.music_assist_engine_error = ""
    if state.music_engine.is_loaded and (
        old_music_model_dir != str(Path(next_music_model_dir).expanduser().resolve())
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
    if payload.music_model_variant is not None:
        state.orchestrator.config.music_model_variant = payload.music_model_variant
    if payload.music_turbo_model_dir is not None:
        state.orchestrator.config.music_turbo_model_dir = payload.music_turbo_model_dir
    if payload.music_base_model_dir is not None:
        state.orchestrator.config.music_base_model_dir = payload.music_base_model_dir
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
    await state.orchestrator.unload_asr()
    state.asr_engine.last_error = ""
    return {"status": "ok"}


@router.post("/unload-all")
async def unload_all_models(state=Depends(get_app_state)):
    await state.orchestrator.unload_all()
    state.asr_engine.last_error = ""
    if state.translation_llm_engine.is_loaded:
        await state.translation_llm_engine.unload_model()
    state.translation_engine_source = ""
    state.translation_engine_error = ""
    if state.music_assist_llm_engine.is_loaded:
        await state.music_assist_llm_engine.unload_model()
    state.music_assist_engine_source = ""
    state.music_assist_engine_error = ""
    state.orchestrator.release_cuda_memory()
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
