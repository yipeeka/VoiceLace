from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
from enum import Enum
from typing import Awaitable, Callable

from backend.config import settings


class ModelState(str, Enum):
    IDLE = "idle"
    LOADING_LLM = "loading_llm"
    LLM_READY = "llm_ready"
    LLM_WORKING = "llm_working"
    UNLOADING_LLM = "unloading_llm"
    LOADING_TTS = "loading_tts"
    TTS_READY = "tts_ready"
    TTS_WORKING = "tts_working"
    UNLOADING_TTS = "unloading_tts"


@dataclass(slots=True)
class OrchestratorConfig:
    auto_serial: bool = settings.default_auto_serial
    auto_unload_llm_after_parse: bool = settings.default_auto_unload_llm_after_parse
    auto_load_tts_before_synth: bool = settings.default_auto_load_tts_before_synth
    debug_stale_report: bool = settings.default_debug_stale_report
    enable_llama_cpp_think_mode: bool = settings.default_enable_llama_cpp_think_mode
    llm_backend: str = settings.default_llm_backend
    llm_model_path: str = settings.default_llm_model_path
    llm_clip_model_path: str = settings.default_llm_clip_model_path
    llm_api_model: str = settings.default_llm_api_model
    llm_n_ctx: int = settings.default_llm_n_ctx
    llm_n_gpu_layers: int = settings.default_llm_n_gpu_layers
    llm_threads: int = settings.default_llm_threads
    llm_temperature: float = settings.default_llm_temperature
    llm_top_p: float = settings.default_llm_top_p
    llm_top_k: int = settings.default_llm_top_k
    llm_min_p: float = settings.default_llm_min_p
    llm_presence_penalty: float = settings.default_llm_presence_penalty
    llm_repeat_penalty: float = settings.default_llm_repeat_penalty
    llm_max_tokens: int = settings.default_llm_max_tokens
    tts_model_path: str = settings.default_tts_model_path
    voxcpm_tts_model_path: str = settings.default_voxcpm_tts_model_path
    tts_device: str = settings.default_tts_device
    asr_model_path: str = settings.default_asr_model_path
    asr_device: str = settings.default_asr_device
    pyannote_model_id: str = settings.default_pyannote_model_id
    pyannote_auth_token: str = settings.default_pyannote_auth_token
    pyannote_device: str = settings.default_pyannote_device


@dataclass(slots=True)
class GpuInfo:
    device_name: str = "unknown"
    name: str = "unknown"
    total_vram_mb: int = 0
    used_vram_mb: int = 0
    free_vram_mb: int = 0


Listener = Callable[[dict], Awaitable[None]]


class ModelOrchestrator:
    def __init__(self, llm_engine, tts_engine) -> None:
        self._llm = llm_engine
        self._tts = tts_engine
        self._state = ModelState.IDLE
        self._lock = asyncio.Lock()
        self._listeners: list[Listener] = []
        self._config = OrchestratorConfig()

    @property
    def state(self) -> ModelState:
        return self._state

    @property
    def config(self) -> OrchestratorConfig:
        return self._config

    def set_config(self, config: OrchestratorConfig) -> None:
        self._config = config
        if hasattr(self._llm, "enable_llama_cpp_think_mode"):
            self._llm.enable_llama_cpp_think_mode = config.enable_llama_cpp_think_mode

    def add_listener(self, callback: Listener) -> None:
        self._listeners.append(callback)

    async def _emit(self, payload: dict) -> None:
        for listener in self._listeners:
            await listener(payload)

    async def _set_state(self, state: ModelState, engine: str | None = None) -> None:
        self._state = state
        await self._emit({"type": "model_state_changed", "engine": engine, "state": state.value, "vram": self.get_gpu_info()})

    async def update_config(self, payload: OrchestratorConfig) -> dict:
        self._config = payload
        if hasattr(self._llm, "enable_llama_cpp_think_mode"):
            self._llm.enable_llama_cpp_think_mode = payload.enable_llama_cpp_think_mode
        return asdict(self._config)

    def get_gpu_info(self) -> dict:
        try:
            import torch

            if torch.cuda.is_available():
                dev = torch.cuda.current_device()
                total = int(torch.cuda.get_device_properties(dev).total_memory)
                used = int(torch.cuda.memory_allocated(dev))
                free = max(0, total - used)
                name = torch.cuda.get_device_name(dev)
                return asdict(
                    GpuInfo(
                        device_name=name,
                        name=name,
                        total_vram_mb=int(total / 1024 / 1024),
                        used_vram_mb=int(used / 1024 / 1024),
                        free_vram_mb=int(free / 1024 / 1024),
                    )
                )
        except Exception:
            pass
        return asdict(GpuInfo())

    async def ensure_llm_ready(self) -> None:
        async with self._lock:
            if self._tts.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
                await self._tts.unload_model()
            need_reload = False
            if getattr(self._llm, "is_loaded", False) and hasattr(self._llm, "needs_reload"):
                need_reload = self._llm.needs_reload(
                    model_path=self._config.llm_model_path,
                    clip_model_path=self._config.llm_clip_model_path,
                    n_ctx=self._config.llm_n_ctx,
                    n_gpu_layers=self._config.llm_n_gpu_layers,
                    backend=self._config.llm_backend,
                    n_threads=self._config.llm_threads,
                )
            if need_reload:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
            if not self._llm.is_loaded:
                await self._set_state(ModelState.LOADING_LLM, "llm")
                await self._llm.load_model(
                    model_path=self._config.llm_model_path,
                    clip_model_path=self._config.llm_clip_model_path,
                    n_ctx=self._config.llm_n_ctx,
                    n_gpu_layers=self._config.llm_n_gpu_layers,
                    backend=self._config.llm_backend,
                    n_threads=self._config.llm_threads,
                )
            await self._set_state(ModelState.LLM_READY, "llm")

    async def ensure_tts_ready(self, *, tts_backend: str = "omnivoice") -> None:
        async with self._lock:
            if self._llm.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
            backend = (tts_backend or "omnivoice").strip().lower()
            if backend not in {"omnivoice", "voxcpm2", "mock"}:
                backend = "omnivoice"
            model_path = self._config.tts_model_path
            if backend == "voxcpm2":
                model_path = self._config.voxcpm_tts_model_path

            need_reload = False
            if getattr(self._tts, "is_loaded", False) and hasattr(self._tts, "needs_reload"):
                need_reload = bool(
                    self._tts.needs_reload(
                        backend=backend,
                        model_path=model_path,
                        device=self._config.tts_device,
                    )
                )
            if need_reload:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
                await self._tts.unload_model()

            if not self._tts.is_loaded:
                await self._set_state(ModelState.LOADING_TTS, "tts")
                await self._tts.load_model(model_path, self._config.tts_device, backend=backend)
            await self._set_state(ModelState.TTS_READY, "tts")

    async def unload_llm(self) -> None:
        async with self._lock:
            if self._llm.is_loaded:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
            await self._set_state(ModelState.IDLE, "llm")

    async def unload_tts(self) -> None:
        async with self._lock:
            if self._tts.is_loaded:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
            await self._tts.unload_model()
            await self._set_state(ModelState.IDLE, "tts")

    async def get_status(self) -> dict:
        llm_loaded = bool(self._llm.is_loaded)
        tts_loaded = bool(self._tts.is_loaded)
        llm_error = getattr(self._llm, "last_error", "")
        tts_error = getattr(self._tts, "last_error", "")
        llm_backend = getattr(self._llm, "backend_name", "unknown")
        tts_backend = getattr(self._tts, "backend_name", "unknown")
        llm_status = "ready" if llm_loaded else ("error" if llm_error else "idle")
        tts_status = "ready" if tts_loaded else ("error" if tts_error else "idle")
        llm_fallback_active = bool(
            llm_loaded
            and llm_backend == "mock"
            and self._config.llm_backend != "mock"
            and llm_error
        )
        llm_think_mode_effective = bool(getattr(self._llm, "think_mode_effective", False))
        llm_think_mode_support = str(getattr(self._llm, "think_mode_support", "unknown"))
        llm_load_mode = str(getattr(self._llm, "last_load_mode", ""))
        llm_handler_fallback_reason = str(getattr(self._llm, "handler_fallback_reason", ""))
        return {
            "state": self._state.value,
            "auto_serial": self._config.auto_serial,
            "llm_loaded": llm_loaded,
            "tts_loaded": tts_loaded,
            "llm_status": llm_status,
            "tts_status": tts_status,
            "llm_backend": llm_backend,
            "tts_backend": tts_backend,
            "llm_error": llm_error,
            "tts_error": tts_error,
            "llm_fallback_active": llm_fallback_active,
            "llm_think_mode_effective": llm_think_mode_effective,
            "llm_think_mode_support": llm_think_mode_support,
            "llm_load_mode": llm_load_mode,
            "llm_handler_fallback_reason": llm_handler_fallback_reason,
            "gpu": self.get_gpu_info(),
            "config": asdict(self._config),
        }
