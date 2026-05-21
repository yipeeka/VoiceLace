from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .project import Project, SynthesisConfig
from .script import Script
from .voice import VoicePreset


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class ProjectSummary(BaseModel):
    id: str
    name: str
    status: str
    updated_at: str
    origin_kind: str = "local"
    source_project_id: str | None = None
    project_file_name: str | None = None

    @classmethod
    def from_project(cls, project: Project) -> "ProjectSummary":
        return cls(
            id=project.id,
            name=project.name,
            status=project.status,
            updated_at=project.updated_at.isoformat(),
            origin_kind=project.project_origin.kind,
            source_project_id=project.project_origin.source_project_id,
            project_file_name=project.project_origin.project_file_name,
        )


class LlmParseRequest(BaseModel):
    parse_mode: Literal[
        "legacy_single_pass",
        "two_step_pipeline",
        "read_aloud_single_voice",
        "verified_two_step_pipeline",
        "verified_five_step_pipeline",
    ] = "verified_five_step_pipeline"
    text: str
    system_prompt: str | None = None
    project_id: str | None = None


class OrchestratorConfigPayload(BaseModel):
    auto_serial: bool = True
    auto_unload_llm_after_parse: bool = True
    auto_load_tts_before_synth: bool = True
    debug_stale_report: bool = False
    mcp_enabled: bool = False
    mcp_mount_path: str = "/mcp"
    enable_llama_cpp_think_mode: bool = True
    llm_backend: str = "llama_cpp"
    llm_model_path: str = ""
    llm_clip_model_path: str = ""
    llm_api_model: str = ""
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = ""
    openai_compatible_api_key: str = ""
    openai_compatible_base_url: str = ""
    openai_compatible_model: str = ""
    gemini_api_key: str = ""
    gemini_base_url: str = ""
    gemini_model: str = ""
    llm_n_ctx: int = 8192
    llm_n_gpu_layers: int = -1
    llm_threads: int = 0
    llm_temperature: float = 0.2
    llm_top_p: float = 0.9
    llm_top_k: int = 40
    llm_min_p: float = 0.0
    llm_presence_penalty: float = 0.0
    llm_repeat_penalty: float = 1.0
    llm_max_tokens: int = 2048
    secondary_llm_model_path: str = ""
    secondary_llm_clip_model_path: str = ""
    secondary_llm_n_ctx: int = 4096
    secondary_llm_n_gpu_layers: int = -1
    secondary_llm_threads: int = 0
    secondary_llm_temperature: float = 0.2
    secondary_llm_top_p: float = 0.9
    secondary_llm_top_k: int = 40
    secondary_llm_min_p: float = 0.0
    secondary_llm_presence_penalty: float = 0.0
    secondary_llm_repeat_penalty: float = 1.0
    secondary_llm_max_tokens: int = 1024
    secondary_enable_llama_cpp_think_mode: bool = False
    tts_model_path: str = "k2-fsa/OmniVoice"
    voxcpm_tts_model_path: str = "openbmb/VoxCPM2"
    tts_device: str = "cuda:0"
    music_enabled: bool = False
    music_turbo_model_dir: str = ""
    music_base_model_dir: str = ""
    music_model_variant: Literal["turbo", "base"] = "turbo"
    music_model_dir: str = ""
    music_device_mode: Literal["cpu_offload", "cuda", "cpu"] = "cpu_offload"
    asr_backend: Literal["whisper", "qwen3_crispasr", "firered_crispasr"] = "whisper"
    asr_model_path: str = "base"
    asr_device: str = "cuda:0"
    asr_vocal_separation_enabled: bool = False
    asr_vocal_separation_model: Literal["htdemucs", "htdemucs_ft"] = "htdemucs"
    asr_vocal_separation_repo_dir: str = ""
    asr_vocal_separation_device: str = "cuda:0"
    qwen3_asr_crispasr_exe: str = ""
    qwen3_asr_model_path: str = ""
    qwen3_asr_forced_aligner_model_path: str = ""
    qwen3_asr_threads: int = 0
    qwen3_asr_language: str = "auto"
    qwen3_asr_enable_timestamps: bool = False
    qwen3_asr_preview_max_line_length: int = Field(default=20, ge=2, le=50)
    firered_asr_model_path: str = ""
    firered_asr_threads: int = 0
    firered_asr_language: str = "auto"
    firered_asr_enable_timestamps: bool = True
    firered_asr_enable_punctuation: bool = False
    firered_asr_punc_model_path: str = ""
    pyannote_model_id: str = "pyannote/speaker-diarization-community-1"
    pyannote_auth_token: str = ""
    pyannote_device: str = "cuda:0"
    default_system_prompt: str = ""


class LoadLlmRequest(BaseModel):
    llm_backend: str | None = Field(default=None, alias="backend")
    llm_model_path: str | None = Field(default=None, alias="model_path")
    llm_clip_model_path: str | None = Field(default=None, alias="clip_model_path")
    llm_api_model: str | None = Field(default=None, alias="api_model")
    llm_n_ctx: int | None = Field(default=None, alias="n_ctx")
    llm_n_gpu_layers: int | None = Field(default=None, alias="n_gpu_layers")
    llm_threads: int | None = Field(default=None, alias="threads")

    model_config = {
        "populate_by_name": True,
        "extra": "forbid",
    }


class LoadTtsRequest(BaseModel):
    tts_backend: str | None = Field(default=None, alias="backend")
    tts_model_path: str | None = Field(default=None, alias="model_path")
    tts_device: str | None = Field(default=None, alias="device")

    model_config = {
        "populate_by_name": True,
        "extra": "forbid",
    }


class LoadMusicRequest(BaseModel):
    music_model_variant: Literal["turbo", "base"] | None = Field(default=None, alias="model_variant")
    music_turbo_model_dir: str | None = Field(default=None, alias="turbo_model_dir")
    music_base_model_dir: str | None = Field(default=None, alias="base_model_dir")
    music_model_dir: str | None = Field(default=None, alias="model_dir")
    music_device_mode: Literal["cpu_offload", "cuda", "cpu"] | None = Field(default=None, alias="device_mode")

    model_config = {
        "populate_by_name": True,
        "extra": "forbid",
    }


class FileBrowseRequest(BaseModel):
    path: str = "."
    filter: str | None = None


class ReorderSegmentsRequest(BaseModel):
    segment_ids: list[str]


class RenameCharacterRequest(BaseModel):
    from_name: str = Field(min_length=1)
    to_name: str = Field(min_length=1)


class MergeCharacterRequest(BaseModel):
    source_name: str = Field(min_length=1)
    target_name: str = Field(min_length=1)


class BatchUpdateSegmentsRequest(BaseModel):
    segment_ids: list[str] = Field(default_factory=list)
    emotion: str | None = None
    type: Literal["narration", "dialogue", "direction"] | None = None


class SearchReplaceSegmentsRequest(BaseModel):
    find: str = Field(min_length=1)
    replace: str = ""
    case_sensitive: bool = False
    segment_ids: list[str] = Field(default_factory=list)


class SplitSegmentRequest(BaseModel):
    segment_id: str = Field(min_length=1)
    cursor: int = Field(ge=0)


class MergeSegmentsRequest(BaseModel):
    first_segment_id: str = Field(min_length=1)
    second_segment_id: str = Field(min_length=1)


class ReorderVoicePresetsRequest(BaseModel):
    preset_ids: list[str]


class VoicePreviewRequest(BaseModel):
    preset: VoicePreset
    text: str
    tts_backend: str | None = Field(default=None, alias="backend")

    model_config = {
        "populate_by_name": True,
        "extra": "forbid",
    }


class TranscribeRequest(BaseModel):
    audio_path: str


class VoiceQualityCheckRequest(BaseModel):
    backend: Literal["omnivoice", "voxcpm2"] | None = None


class VoiceRecommendRequest(BaseModel):
    project_id: str
    backend: Literal["omnivoice", "voxcpm2"] = "omnivoice"
    limit: int = Field(default=3, ge=1, le=10)
    source: Literal["secondary_local", "primary_local", "openai", "openai_compatible", "gemini", "rule"] = "secondary_local"


class TranslationEngineLoadRequest(BaseModel):
    source: Literal["primary_local", "secondary_local", "openai", "openai_compatible", "gemini"]


class TranslatePolishRequest(BaseModel):
    text: str
    mode: Literal["passthrough", "polish_only", "translate_polish"] = "polish_only"
    target_language: str = "中文"
    source: Literal["primary_local", "secondary_local", "openai", "openai_compatible", "gemini"]


class DubbingSegmentInput(BaseModel):
    id: str = ""
    speaker: str = "narrator"
    text: str = ""
    start_ms: int | None = None
    end_ms: int | None = None


class TranslateDubbingSegmentsRequest(BaseModel):
    source: Literal["primary_local", "secondary_local", "openai", "openai_compatible", "gemini"]
    mode: Literal["passthrough", "polish_only", "translate_polish"] = "translate_polish"
    target_language: str = "中文"
    segments: list[DubbingSegmentInput] = Field(default_factory=list)
    min_speed: float = Field(default=0.8, ge=0.5, le=2.0)
    max_speed: float = Field(default=1.2, ge=0.5, le=2.0)
    max_concurrency: int = Field(default=1, ge=1, le=8)


class MusicAssistMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class MusicAssistLoadRequest(BaseModel):
    source: Literal["primary_local", "secondary_local", "openai", "openai_compatible", "gemini"]


class MusicAssistChatRequest(BaseModel):
    source: Literal["primary_local", "secondary_local", "openai", "openai_compatible", "gemini"]
    messages: list[MusicAssistMessage] = Field(default_factory=list)
    project_id: str | None = None
    prompt: str = ""
    lyrics: str = ""
    audio_duration: float | None = Field(default=None, ge=1.0, le=120.0)
    vocal_language: str | None = None
    bpm: int | None = Field(default=None, ge=10, le=300)
    keyscale: str | None = None
    timesignature: str | None = None
    context_text: str = ""


class MusicAssistFinalizeRequest(BaseModel):
    source: Literal["primary_local", "secondary_local", "openai", "openai_compatible", "gemini"]
    messages: list[MusicAssistMessage] = Field(default_factory=list)
    project_id: str | None = None
    prompt: str = ""
    lyrics: str = ""
    audio_duration: float | None = Field(default=None, ge=1.0, le=120.0)
    vocal_language: str | None = None
    bpm: int | None = Field(default=None, ge=10, le=300)
    keyscale: str | None = None
    timesignature: str | None = None
    context_text: str = ""


class MusicModelSelectRequest(BaseModel):
    model_variant: Literal["turbo", "base"]


class SynthesizeRequest(BaseModel):
    project_id: str
    config: SynthesisConfig | None = None
    segment_ids: list[str] | None = None
    rebuild_full: bool = True


class MusicGenerateRequest(BaseModel):
    task_type: Literal["text2music", "cover", "repaint", "lego", "extract", "complete"] = "text2music"
    prompt: str = Field(min_length=1)
    project_id: str | None = None
    lyrics: str = ""
    audio_duration: float = Field(default=10.0, ge=1.0, le=120.0)
    vocal_language: str = "en"
    num_inference_steps: int = Field(default=50, ge=1, le=100)
    seed: int | None = None
    source_asset_name: str | None = None
    reference_asset_name: str | None = None
    bpm: int | None = Field(default=None, ge=10, le=300)
    keyscale: str | None = None
    timesignature: str | None = None
    track_name: str | None = None
    complete_track_classes: list[str] = Field(default_factory=list)
    repainting_start: float | None = Field(default=None, ge=0.0, le=120.0)
    repainting_end: float | None = Field(default=None, ge=0.0, le=120.0)
    audio_cover_strength: float = Field(default=1.0, ge=0.0, le=1.0)
    guidance_scale: float = Field(default=7.0, ge=0.0, le=30.0)
    shift: float = Field(default=3.0, ge=1.0, le=5.0)


class AttachMusicAssetRequest(BaseModel):
    project_id: str
    asset_name: str = Field(min_length=1)
    target: Literal["bgm", "ambience"] = "bgm"


class RenameMusicAssetRequest(BaseModel):
    new_name: str = Field(min_length=1)


class MusicAssetCategoryCreateRequest(BaseModel):
    name: str = Field(min_length=1)


class MusicAssetCategoryRenameRequest(BaseModel):
    name: str = Field(min_length=1)


class MusicAssetCategoryAssignRequest(BaseModel):
    category_id: str | None = None


class ExportRequest(BaseModel):
    project_id: str
    format: str = "wav"
    variant: Literal["raw", "processed"] = "raw"


class PostprocessRequest(BaseModel):
    project_id: str
    config: SynthesisConfig | None = None


class VoiceAssignmentsPayload(BaseModel):
    assignments: dict[str, str]


ProjectStatus = Literal["draft", "parsed", "voices_configured", "synthesizing", "done"]


class ProjectFileProjectMeta(BaseModel):
    name: str
    status: ProjectStatus = "draft"


class ProjectFilePayload(BaseModel):
    file_type: Literal["beautyvoice_project"] = "beautyvoice_project"
    schema_version: int = 1
    exported_at: datetime | None = None
    source_project_id: str | None = None
    project: ProjectFileProjectMeta
    script: Script
    voice_assignments: dict[str, str] = Field(default_factory=dict)
    synthesis_config: SynthesisConfig = Field(default_factory=SynthesisConfig)
    metadata: dict = Field(default_factory=dict)
