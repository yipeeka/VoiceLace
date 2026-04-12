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
    llm_backend: str = settings.default_llm_backend
    llm_model_path: str = settings.default_llm_model_path
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
    tts_device: str = settings.default_tts_device
    asr_model_path: str = settings.default_asr_model_path
    asr_device: str = settings.default_asr_device


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
                    self._config.llm_model_path,
                    self._config.llm_n_ctx,
                    self._config.llm_n_gpu_layers,
                    backend=self._config.llm_backend,
                    n_threads=self._config.llm_threads,
                )
            await self._set_state(ModelState.LLM_READY, "llm")

    async def ensure_tts_ready(self) -> None:
        async with self._lock:
            if self._llm.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
            if not self._tts.is_loaded:
                await self._set_state(ModelState.LOADING_TTS, "tts")
                await self._tts.load_model(self._config.tts_model_path, self._config.tts_device)
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
        return {
            "state": self._state.value,
            "auto_serial": self._config.auto_serial,
            "llm_loaded": self._llm.is_loaded,
            "tts_loaded": self._tts.is_loaded,
            "llm_backend": getattr(self._llm, "backend_name", "unknown"),
            "tts_backend": getattr(self._tts, "backend_name", "unknown"),
            "llm_error": getattr(self._llm, "last_error", ""),
            "tts_error": getattr(self._tts, "last_error", ""),
            "gpu": self.get_gpu_info(),
            "config": asdict(self._config),
        }
