from __future__ import annotations

from importlib import import_module
from typing import Any


_SYMBOL_TO_MODULE = {
    "ASREngine": "backend.engine.asr_engine",
    "CONFIG_SECRET_MASK": "backend.engine.model_orchestrator",
    "GpuInfo": "backend.engine.model_orchestrator",
    "LLMEngine": "backend.engine.llm_engine",
    "MusicEngine": "backend.engine.music_engine",
    "ModelOrchestrator": "backend.engine.model_orchestrator",
    "ModelState": "backend.engine.model_orchestrator",
    "OrchestratorConfig": "backend.engine.model_orchestrator",
    "SECRET_CONFIG_FIELDS": "backend.engine.model_orchestrator",
    "TTSEngine": "backend.engine.tts_engine",
    "VoiceManager": "backend.engine.voice_manager",
    "public_orchestrator_config": "backend.engine.model_orchestrator",
}


def __getattr__(name: str) -> Any:
    module_name = _SYMBOL_TO_MODULE.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module = import_module(module_name)
    value = getattr(module, name)
    globals()[name] = value
    return value


__all__ = list(_SYMBOL_TO_MODULE.keys())
