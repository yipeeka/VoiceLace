from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv()


@dataclass(slots=True)
class Settings:
    app_name: str = "BeautyVoiceTTS API"
    api_prefix: str = "/api/v1"
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    cors_origin_regex: str = field(
        default_factory=lambda: os.getenv(
            "BV_CORS_ORIGIN_REGEX",
            r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        )
    )
    base_dir: Path = field(default_factory=lambda: Path(__file__).resolve().parent)
    default_llm_model_path: str = field(default_factory=lambda: os.getenv("BV_LLM_MODEL_PATH", ""))
    default_llm_clip_model_path: str = field(default_factory=lambda: os.getenv("BV_LLM_CLIP_MODEL_PATH", ""))
    default_llm_backend: str = field(default_factory=lambda: os.getenv("BV_LLM_BACKEND", "llama_cpp"))
    default_llm_api_model: str = field(
        default_factory=lambda: os.getenv(
            "BV_LLM_API_MODEL",
            os.getenv("BV_OPENAI_MODEL", os.getenv("BV_GEMINI_MODEL", "gpt-4.1-mini")),
        )
    )
    llm_chat_format: str = field(default_factory=lambda: os.getenv("BV_LLM_CHAT_FORMAT", "chatml"))
    default_llm_n_ctx: int = field(default_factory=lambda: int(os.getenv("BV_LLM_N_CTX", "8192")))
    default_llm_n_gpu_layers: int = field(default_factory=lambda: int(os.getenv("BV_LLM_N_GPU_LAYERS", "-1")))
    default_llm_threads: int = field(default_factory=lambda: int(os.getenv("BV_LLM_THREADS", "0")))
    default_llm_temperature: float = field(default_factory=lambda: float(os.getenv("BV_LLM_TEMPERATURE", "0.2")))
    default_llm_top_p: float = field(default_factory=lambda: float(os.getenv("BV_LLM_TOP_P", "0.9")))
    default_llm_top_k: int = field(default_factory=lambda: int(os.getenv("BV_LLM_TOP_K", "40")))
    default_llm_min_p: float = field(default_factory=lambda: float(os.getenv("BV_LLM_MIN_P", "0.0")))
    default_llm_presence_penalty: float = field(default_factory=lambda: float(os.getenv("BV_LLM_PRESENCE_PENALTY", "0.0")))
    default_llm_repeat_penalty: float = field(default_factory=lambda: float(os.getenv("BV_LLM_REPEAT_PENALTY", "1.0")))
    default_llm_max_tokens: int = field(default_factory=lambda: int(os.getenv("BV_LLM_MAX_TOKENS", "2048")))
    default_enable_llama_cpp_think_mode: bool = field(
        default_factory=lambda: os.getenv("BV_ENABLE_LLAMA_CPP_THINK_MODE", "true").lower() == "true"
    )
    openai_api_key: str = field(default_factory=lambda: os.getenv("BV_OPENAI_API_KEY", ""))
    openai_base_url: str = field(default_factory=lambda: os.getenv("BV_OPENAI_BASE_URL", ""))
    openai_model: str = field(default_factory=lambda: os.getenv("BV_OPENAI_MODEL", "gpt-4.1-mini"))
    gemini_api_key: str = field(default_factory=lambda: os.getenv("BV_GEMINI_API_KEY", ""))
    gemini_base_url: str = field(default_factory=lambda: os.getenv("BV_GEMINI_BASE_URL", "https://generativelanguage.googleapis.com"))
    gemini_model: str = field(default_factory=lambda: os.getenv("BV_GEMINI_MODEL", "gemini-2.5-flash"))
    default_tts_model_path: str = field(default_factory=lambda: os.getenv("BV_TTS_MODEL_PATH", "k2-fsa/OmniVoice"))
    default_tts_device: str = field(default_factory=lambda: os.getenv("BV_TTS_DEVICE", "cuda:0"))
    default_asr_model_path: str = field(default_factory=lambda: os.getenv("BV_ASR_MODEL_PATH", "base"))
    default_asr_device: str = field(default_factory=lambda: os.getenv("BV_ASR_DEVICE", os.getenv("BV_TTS_DEVICE", "cuda:0")))
    default_auto_serial: bool = field(default_factory=lambda: os.getenv("BV_AUTO_SERIAL", "true").lower() == "true")
    default_auto_unload_llm_after_parse: bool = field(
        default_factory=lambda: os.getenv("BV_AUTO_UNLOAD_LLM_AFTER_PARSE", "true").lower() == "true"
    )
    default_auto_load_tts_before_synth: bool = field(
        default_factory=lambda: os.getenv("BV_AUTO_LOAD_TTS_BEFORE_SYNTH", "true").lower() == "true"
    )
    default_debug_stale_report: bool = field(
        default_factory=lambda: os.getenv("BV_DEBUG_STALE_REPORT", "false").lower() == "true"
    )
    allow_mock_fallback: bool = field(default_factory=lambda: os.getenv("BV_ALLOW_MOCK_FALLBACK", "true").lower() == "true")
    data_dir: Path = field(init=False)
    runtime_config_path: Path = field(init=False)
    projects_dir: Path = field(init=False)
    voices_dir: Path = field(init=False)
    output_dir: Path = field(init=False)

    def __post_init__(self) -> None:
        self.data_dir = self.base_dir / "data"
        self.runtime_config_path = self.data_dir / "config.json"
        self.projects_dir = self.data_dir / "projects"
        self.voices_dir = self.data_dir / "voices"
        self.output_dir = self.data_dir / "output"

    def ensure_directories(self) -> None:
        for path in (self.data_dir, self.projects_dir, self.voices_dir, self.output_dir):
            path.mkdir(parents=True, exist_ok=True)


settings = Settings()
