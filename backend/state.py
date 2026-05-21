from __future__ import annotations

from dataclasses import dataclass, field
import asyncio
from typing import Any

from starlette.requests import HTTPConnection

from backend.config import settings as app_settings
from backend.engine import ASREngine, LLMEngine, ModelOrchestrator, MusicEngine, TTSEngine, VoiceManager
from backend.realtime import RealtimeHub
from backend.runtime_config import load_runtime_config


@dataclass(slots=True)
class AppState:
    settings: Any = field(default_factory=lambda: app_settings)
    llm_engine: LLMEngine = field(default_factory=LLMEngine)
    translation_llm_engine: LLMEngine = field(default_factory=LLMEngine)
    music_assist_llm_engine: LLMEngine = field(default_factory=LLMEngine)
    tts_engine: TTSEngine = field(default_factory=TTSEngine)
    music_engine: MusicEngine = field(default_factory=MusicEngine)
    asr_engine: ASREngine = field(default_factory=ASREngine)
    llm_tasks: dict = field(default_factory=dict)
    tts_tasks: dict = field(default_factory=dict)
    asr_tasks: dict = field(default_factory=dict)
    music_tasks: dict = field(default_factory=dict)
    llm_task_handles: dict[str, Any] = field(default_factory=dict)
    tts_task_handles: dict[str, Any] = field(default_factory=dict)
    asr_task_handles: dict[str, Any] = field(default_factory=dict)
    music_task_handles: dict[str, Any] = field(default_factory=dict)
    tts_queue: list[str] = field(default_factory=list)
    tts_queue_worker: Any = None
    tts_queue_running_task_id: str | None = None
    tts_queue_lock: Any = field(init=False)
    music_task_lock: Any = field(init=False)
    music_assist_lock: Any = field(init=False)
    orchestrator: ModelOrchestrator = field(init=False)
    voice_manager: VoiceManager = field(init=False)
    realtime: RealtimeHub = field(init=False)
    translation_engine_source: str = ""
    translation_engine_error: str = ""
    music_assist_engine_source: str = ""
    music_assist_engine_error: str = ""
    asr_vocal_separation_error: str = ""

    def __post_init__(self) -> None:
        self.settings.ensure_directories()
        self.realtime = RealtimeHub()
        self.orchestrator = ModelOrchestrator(self.llm_engine, self.tts_engine, self.music_engine, self.asr_engine)
        loaded_config = load_runtime_config(self.settings.runtime_config_path)
        # Runtime config file has higher priority than .env defaults.
        self.orchestrator.set_config(loaded_config)
        self.asr_engine.model_path = loaded_config.asr_model_path
        self.asr_engine.device = loaded_config.asr_device
        self.asr_engine.default_backend = loaded_config.asr_backend
        self.asr_engine.crispasr_exe = loaded_config.qwen3_asr_crispasr_exe
        self.asr_engine.qwen3_model_path = loaded_config.qwen3_asr_model_path
        self.asr_engine.qwen3_forced_aligner_model_path = loaded_config.qwen3_asr_forced_aligner_model_path
        self.asr_engine.qwen3_threads = int(loaded_config.qwen3_asr_threads)
        self.asr_engine.qwen3_language = loaded_config.qwen3_asr_language
        self.asr_engine.qwen3_enable_timestamps = bool(loaded_config.qwen3_asr_enable_timestamps)
        self.asr_engine.qwen3_preview_max_line_length = int(loaded_config.qwen3_asr_preview_max_line_length)
        self.asr_engine.pyannote_model_id = loaded_config.pyannote_model_id
        self.asr_engine.pyannote_auth_token = loaded_config.pyannote_auth_token
        self.asr_engine.pyannote_device = loaded_config.pyannote_device
        self.voice_manager = VoiceManager(self.settings.voices_dir, project_root=self.settings.base_dir.parent)
        self.tts_queue_lock = asyncio.Lock()
        self.music_task_lock = asyncio.Lock()
        self.music_assist_lock = asyncio.Lock()

        async def _broadcast_system_event(event: dict) -> None:
            await self.realtime.publish("system", "events", event)

        self.orchestrator.add_listener(_broadcast_system_event)


def create_app_state() -> AppState:
    return AppState()


def get_app_state(connection: HTTPConnection) -> AppState:
    state = getattr(connection.app.state, "app_state", None)
    if state is None:
        state = create_app_state()
        connection.app.state.app_state = state
    return state


def get_app_state_from_app(app: Any) -> AppState:
    state = getattr(app.state, "app_state", None)
    if state is None:
        state = create_app_state()
        app.state.app_state = state
    return state
