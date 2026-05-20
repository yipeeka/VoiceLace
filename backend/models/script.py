from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Segment(BaseModel):
    id: str
    index: int
    type: Literal["narration", "dialogue", "direction"] = "narration"
    speaker: str = "narrator"
    text: str
    emotion: str = "neutral"
    non_verbal: list[str] = Field(default_factory=list)
    tts_overrides: dict[str, str | int | float | bool] = Field(default_factory=dict)
    source_text: str = ""
    source_start_ms: int | None = None
    source_end_ms: int | None = None
    source_duration_ms: int | None = None
    timing_check: dict[str, Any] = Field(default_factory=dict)


class Character(BaseModel):
    name: str
    description: str = ""
    appearance_count: int = 0
    voice_preset_id: str | None = None


class Script(BaseModel):
    title: str = ""
    source_text: str = ""
    segments: list[Segment] = Field(default_factory=list)
    characters: list[Character] = Field(default_factory=list)
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)


class StructuredSegmentDraft(BaseModel):
    id: str
    index: int
    type: Literal["narration", "dialogue", "direction"] = "narration"
    speaker: str = "narrator"
    text: str


class StructuredCharacterDraft(BaseModel):
    name: str
    description: str = ""
    appearance_count: int = 0


class StructuredScriptDraft(BaseModel):
    title: str = ""
    source_text: str = ""
    segments: list[StructuredSegmentDraft] = Field(default_factory=list)
    characters: list[StructuredCharacterDraft] = Field(default_factory=list)
    metadata: dict[str, str | int | float | bool] = Field(default_factory=dict)
