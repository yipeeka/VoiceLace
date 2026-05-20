from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field


class OmniVoicePresetProfile(BaseModel):
    voice_mode: Literal["clone", "design", "auto"] = "auto"
    ref_audio_path: str | None = None
    ref_text: str | None = None
    gender: str | None = None
    age: str | None = None
    pitch: str | None = None
    style: str | None = None
    accent: str | None = None
    dialect: str | None = None
    custom_instruct: str | None = None
    speed: float = 1.0
    clone_denoise: bool | None = None
    clone_num_step: int | None = None
    clone_guidance_scale: float | None = None


class VoxCpm2PresetProfile(BaseModel):
    voice_mode: Literal["clone", "design", "auto"] = "auto"
    design_instruction: str = ""
    control_instruction: str = ""
    ref_audio_path: str | None = None
    ref_text: str | None = None
    use_hifi_clone: bool = False
    cfg_value: float | None = None
    inference_timesteps: int | None = None
    denoise: bool | None = None


class VoiceBackendProfiles(BaseModel):
    omnivoice: OmniVoicePresetProfile | None = None
    voxcpm2: VoxCpm2PresetProfile | None = None


class VoiceQualityIssue(BaseModel):
    code: str
    severity: Literal["warning", "fail"] = "warning"
    message: str


class VoiceQualityReport(BaseModel):
    status: Literal["pass", "warning", "fail"] = "pass"
    score: int = 100
    duration_sec: float = 0.0
    sample_rate: int = 0
    channels: int = 0
    sample_width: int = 0
    loudness_dbfs: float | None = None
    peak_dbfs: float | None = None
    silence_ratio: float = 0.0
    clipping_ratio: float = 0.0
    checked_at: str = ""
    issues: list[VoiceQualityIssue] = Field(default_factory=list)


class VoicePreset(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    voice_mode: Literal["clone", "design", "auto"] = "auto"
    ref_audio_path: str | None = None
    ref_text: str | None = None
    gender: str | None = None
    age: str | None = None
    pitch: str | None = None
    style: str | None = None
    accent: str | None = None
    dialect: str | None = None
    custom_instruct: str | None = None
    speed: float = 1.0
    clone_denoise: bool | None = None
    clone_num_step: int | None = None
    clone_guidance_scale: float | None = None
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    favorite: bool = False
    sample_audio_path: str | None = None
    suitable_role_description: str = ""
    quality_reports: dict[str, VoiceQualityReport] = Field(default_factory=dict)
    backend_profiles: VoiceBackendProfiles = Field(default_factory=VoiceBackendProfiles)

    def to_instruct_string(self) -> str:
        parts = [
            value
            for value in (
                self.gender,
                self.age,
                self.pitch,
                self.style,
                self.accent,
                self.dialect,
                self.custom_instruct,
            )
            if value
        ]
        return ", ".join(parts)

    def resolved_omnivoice_profile(self) -> OmniVoicePresetProfile:
        if self.backend_profiles and self.backend_profiles.omnivoice is not None:
            return self.backend_profiles.omnivoice
        return OmniVoicePresetProfile(
            voice_mode=self.voice_mode,
            ref_audio_path=self.ref_audio_path,
            ref_text=self.ref_text,
            gender=self.gender,
            age=self.age,
            pitch=self.pitch,
            style=self.style,
            accent=self.accent,
            dialect=self.dialect,
            custom_instruct=self.custom_instruct,
            speed=self.speed,
            clone_denoise=self.clone_denoise,
            clone_num_step=self.clone_num_step,
            clone_guidance_scale=self.clone_guidance_scale,
        )

    def resolved_voxcpm2_profile(self) -> VoxCpm2PresetProfile:
        if self.backend_profiles and self.backend_profiles.voxcpm2 is not None:
            return self.backend_profiles.voxcpm2
        return VoxCpm2PresetProfile(
            voice_mode=self.voice_mode,
            ref_audio_path=self.ref_audio_path,
            ref_text=self.ref_text,
            design_instruction=self.to_instruct_string(),
            control_instruction=self.to_instruct_string(),
        )
