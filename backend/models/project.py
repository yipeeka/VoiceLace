from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from .script import Script


class ProjectOrigin(BaseModel):
    kind: Literal["local", "project_file", "archive_import"] = "local"
    source_project_id: str | None = None
    project_file_name: str | None = None
    project_file_fingerprint: str | None = None


class OmniVoiceSynthesisParams(BaseModel):
    num_step: int = 32
    guidance_scale: float = 2.0
    denoise: bool = True


class VoxCpm2SynthesisParams(BaseModel):
    inference_timesteps: int = 10
    cfg_value: float = 2.0
    denoise: bool = False
    normalize: bool = True


class ChapterMarker(BaseModel):
    id: str
    title: str
    start_segment_id: str


class PostprocessTrackConfig(BaseModel):
    relpath: str = ""
    gain_db: float = 0.0
    loop: bool = True
    ducking_enabled: bool = False
    ducking_db: float = 8.0
    offset_ms: int = 0


class SynthesisConfig(BaseModel):
    tts_backend: Literal["omnivoice", "voxcpm2"] = "omnivoice"
    # Legacy top-level OmniVoice fields are kept for backward compatibility.
    num_step: int = 32
    guidance_scale: float = 2.0
    denoise: bool = True
    omnivoice: OmniVoiceSynthesisParams = Field(default_factory=OmniVoiceSynthesisParams)
    voxcpm2: VoxCpm2SynthesisParams = Field(default_factory=VoxCpm2SynthesisParams)
    gap_duration_ms: int = 300
    output_format: Literal["wav", "mp3"] = "wav"
    postprocess_enabled: bool = False
    loudness_normalize: bool = True
    target_lufs: float = -16.0
    trim_silence_enabled: bool = False
    trim_threshold_db: int = -45
    trim_min_silence_ms: int = 120
    fade_in_ms: int = 40
    fade_out_ms: int = 80
    mp3_bitrate_kbps: Literal[96, 128, 192, 256, 320] = 192
    chapter_markers: list[ChapterMarker] = Field(default_factory=list)
    bgm_track: PostprocessTrackConfig = Field(default_factory=PostprocessTrackConfig)
    ambience_track: PostprocessTrackConfig = Field(default_factory=PostprocessTrackConfig)
    tts_auto_retry: bool = True
    tts_retry_attempts: int = 2
    tts_segment_concurrency: int = 1
    timeline_lock_enabled: bool = False

    @model_validator(mode="after")
    def _hydrate_legacy_and_nested_fields(self) -> "SynthesisConfig":
        # Keep both legacy top-level fields and nested OmniVoice params in sync.
        # If old payload only sets top-level fields, hydrate nested params from it.
        # If nested params are provided, treat them as source of truth.
        fields_set = getattr(self, "model_fields_set", set())
        legacy_fields_set = any(name in fields_set for name in ("num_step", "guidance_scale", "denoise"))
        omnivoice_set = "omnivoice" in fields_set

        if not omnivoice_set and legacy_fields_set:
            self.omnivoice = OmniVoiceSynthesisParams(
                num_step=int(self.num_step),
                guidance_scale=float(self.guidance_scale),
                denoise=bool(self.denoise),
            )

        if self.omnivoice is None:
            self.omnivoice = OmniVoiceSynthesisParams()

        self.num_step = int(self.omnivoice.num_step)
        self.guidance_scale = float(self.omnivoice.guidance_scale)
        self.denoise = bool(self.omnivoice.denoise)
        if self.voxcpm2 is None:
            self.voxcpm2 = VoxCpm2SynthesisParams()
        return self

    def get_tts_backend(self) -> str:
        backend = (self.tts_backend or "omnivoice").strip().lower()
        if backend not in {"omnivoice", "voxcpm2"}:
            return "omnivoice"
        return backend


class SegmentAsset(BaseModel):
    segment_id: str
    audio_relpath: str
    duration_ms: int = 0
    fingerprint: str = ""
    source_text: str = ""
    source_speaker: str = ""
    source_type: str = ""
    source_emotion: str = ""
    source_tts_overrides: dict = Field(default_factory=dict)
    source_voice_preset_id: str | None = None
    source_preset_hash: str = ""
    source_config_hash: str = ""
    source_tts_backend: str = ""
    source_tts_model_path: str = ""
    source_task_id: str | None = None
    created_at: str = ""
    status: Literal["ready", "missing", "stale"] = "ready"
    peaks_relpath: str | None = None
    peaks_version: int = 1
    peaks_bins: int = 0
    peaks_format: Literal["minmax_i16"] = "minmax_i16"
    audio_sha256: str = ""


class FailedSegmentAsset(BaseModel):
    segment_id: str
    error: str = ""
    attempts: int = 0
    task_id: str | None = None
    failed_at: str = ""
    fingerprint: str = ""


class ProcessedChapterAsset(BaseModel):
    id: str
    title: str
    start_segment_id: str
    end_segment_id: str | None = None
    start_ms: int = 0
    end_ms: int = 0
    duration_ms: int = 0
    wav_relpath: str | None = None
    mp3_relpath: str | None = None


class ProcessedAudioAssets(BaseModel):
    full_wav_relpath: str | None = None
    full_mp3_relpath: str | None = None
    full_peaks_relpath: str | None = None
    manifest_relpath: str | None = None
    chapters: list[ProcessedChapterAsset] = Field(default_factory=list)


class ProjectAudioAssets(BaseModel):
    latest_task_id: str | None = None
    full_wav_relpath: str | None = None
    full_mp3_relpath: str | None = None
    full_rebuild_required: bool = False
    source_audio_wav_relpath: str | None = None
    source_audio_mp3_relpath: str | None = None
    source_audio_name: str | None = None
    source_audio_start_ms: int | None = None
    source_audio_end_ms: int | None = None
    source_audio_duration_ms: int | None = None
    subtitle_srt_relpath: str | None = None
    subtitle_lrc_relpath: str | None = None
    segments: dict[str, SegmentAsset] = Field(default_factory=dict)
    full_peaks_relpath: str | None = None
    full_peaks_version: int = 1
    full_peaks_levels: list[int] = Field(default_factory=list)
    archive_schema_version: int = 3
    processed: ProcessedAudioAssets = Field(default_factory=ProcessedAudioAssets)
    failed_segments: list[FailedSegmentAsset] = Field(default_factory=list)


class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    script: Script = Field(default_factory=Script)
    voice_assignments: dict[str, str] = Field(default_factory=dict)
    synthesis_config: SynthesisConfig = Field(default_factory=SynthesisConfig)
    audio_assets: ProjectAudioAssets = Field(default_factory=ProjectAudioAssets)
    project_origin: ProjectOrigin = Field(default_factory=ProjectOrigin)
    status: Literal["draft", "parsed", "voices_configured", "synthesizing", "done"] = "draft"
