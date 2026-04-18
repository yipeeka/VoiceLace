from __future__ import annotations

from collections import Counter
from typing import Any

from backend.models import Character, Script, Segment


def sync_script_metadata(script: Script) -> Script:
    speakers = [segment.speaker for segment in script.segments if segment.speaker]
    counts = Counter(speakers)
    script.characters = [
        Character(name=name, appearance_count=count, description=f"{name} 的角色档案")
        for name, count in counts.items()
    ]
    script.segments = [
        segment.model_copy(update={"index": index})
        for index, segment in enumerate(script.segments)
    ]
    return script


def segment_content_payload(segment: Segment) -> dict[str, Any]:
    return {
        "speaker": segment.speaker or "",
        "text": segment.text or "",
        "type": segment.type or "",
        "emotion": segment.emotion or "",
        "non_verbal": segment.non_verbal or [],
        "tts_overrides": segment.tts_overrides or {},
    }
