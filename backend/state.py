from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.config import settings
from backend.engine import ASREngine, LLMEngine, ModelOrchestrator, TTSEngine, VoiceManager
from backend.realtime import RealtimeHub
from backend.runtime_config import load_runtime_config


@dataclass(slots=True)
class AppState:
    settings = settings
    llm_engine: LLMEngine = field(default_factory=LLMEngine)
    tts_engine: TTSEngine = field(default_factory=TTSEngine)
    asr_engine: ASREngine = field(default_factory=ASREngine)
    llm_tasks: dict = field(default_factory=dict)
    tts_tasks: dict = field(default_factory=dict)
    llm_task_handles: dict[str, Any] = field(default_factory=dict)
    tts_task_handles: dict[str, Any] = field(default_factory=dict)
    orchestrator: ModelOrchestrator = field(init=False)
    voice_manager: VoiceManager = field(init=False)
    realtime: RealtimeHub = field(init=False)

    def __post_init__(self) -> None:
        self.settings.ensure_directories()
        self.realtime = RealtimeHub()
        self.orchestrator = ModelOrchestrator(self.llm_engine, self.tts_engine)
        loaded_config = load_runtime_config(self.settings.runtime_config_path)
        # Runtime config file has higher priority than .env defaults.
        self.orchestrator.set_config(loaded_config)
        self.asr_engine.model_path = loaded_config.asr_model_path
        self.asr_engine.device = loaded_config.asr_device
        self.voice_manager = VoiceManager(self.settings.voices_dir)

        async def _broadcast_system_event(event: dict) -> None:
            await self.realtime.publish("system", "events", event)

        self.orchestrator.add_listener(_broadcast_system_event)


app_state = AppState()


def get_app_state():
    return app_state
