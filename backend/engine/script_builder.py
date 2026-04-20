from __future__ import annotations

from collections import Counter
import json
from typing import Any
from uuid import uuid4

from backend.models import Character, Script, Segment


def build_mock_script(text: str, prompt: str | None = None, parser_name: str = "demo-llm") -> Script:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    segments: list[Segment] = []
    speakers: list[str] = []

    for index, line in enumerate(lines):
        speaker = "narrator"
        segment_type = "narration"
        content = line
        if "：" in line:
            maybe_speaker, maybe_text = line.split("：", 1)
            if maybe_speaker and maybe_text:
                speaker = maybe_speaker.strip()
                content = maybe_text.strip()
                segment_type = "dialogue"
        elif ":" in line:
            maybe_speaker, maybe_text = line.split(":", 1)
            if maybe_speaker and maybe_text:
                speaker = maybe_speaker.strip()
                content = maybe_text.strip()
                segment_type = "dialogue"

        if speaker:
            speakers.append(speaker)

        segments.append(
            Segment(
                id=str(uuid4()),
                index=index,
                type=segment_type,
                speaker=speaker or "narrator",
                text=content,
                emotion="neutral",
            )
        )

    counter = Counter(speakers)
    characters = [
        Character(name=name, appearance_count=count, description=f"{name} 的初始角色档案")
        for name, count in counter.items()
    ]

    return Script(
        title="未命名剧本",
        source_text=text,
        segments=segments,
        characters=characters,
        metadata={"parser": parser_name, "prompt_used": prompt or ""},
    )


def build_script_from_model_payload(text: str, payload: dict[str, Any], parser_name: str) -> Script:
    raw_segments = payload.get("segments") or []
    if not raw_segments:
        return build_mock_script(text, parser_name=parser_name)

    # Detect placeholder/template output where the LLM echoed the schema instead of parsing
    PLACEHOLDER_TEXTS = {
        "segment text", "片段文本", "string", "字符串",
        "这里填入实际的旁白文本内容", "这里填入该角色实际说的话",
    }
    real_count = sum(
        1 for seg in raw_segments
        if str(seg.get("text") or "").strip().lower() not in PLACEHOLDER_TEXTS
        and len(str(seg.get("text") or "").strip()) > 2
    )
    if real_count == 0:
        return build_mock_script(text, parser_name=f"{parser_name}-placeholder-fallback")

    segments: list[Segment] = []
    speaker_counter: Counter[str] = Counter()

    for index, raw in enumerate(raw_segments):
        speaker = str(raw.get("speaker") or "narrator").strip()
        segment_type = str(raw.get("type") or "narration")
        if segment_type not in {"narration", "dialogue", "direction"}:
            segment_type = "narration"
        segment = Segment(
            id=str(uuid4()),
            index=index,
            type=segment_type,
            speaker=speaker,
            text=str(raw.get("text") or "").strip(),
            emotion=str(raw.get("emotion") or "neutral").strip() or "neutral",
            non_verbal=[str(item) for item in (raw.get("non_verbal") or [])],
            tts_overrides=raw.get("tts_overrides") or {},
        )
        segments.append(segment)
        if speaker:
            speaker_counter[speaker] += 1

    characters = [
        Character(
            name=name,
            appearance_count=count,
            description=str((payload.get("character_descriptions") or {}).get(name) or f"{name} 的角色档案"),
        )
        for name, count in speaker_counter.items()
    ]

    metadata = _sanitize_script_metadata(payload.get("metadata"))
    metadata["parser"] = parser_name

    return Script(
        title=str(payload.get("title") or "未命名剧本"),
        source_text=text,
        segments=segments,
        characters=characters,
        metadata=metadata,
    )


def _sanitize_script_metadata(raw_metadata: Any) -> dict[str, str | int | float | bool]:
    if not isinstance(raw_metadata, dict):
        return {}
    sanitized: dict[str, str | int | float | bool] = {}
    for key, value in raw_metadata.items():
        key_str = str(key)
        if isinstance(value, (str, int, float, bool)):
            sanitized[key_str] = value
            continue
        if value is None:
            continue
        try:
            sanitized[key_str] = json.dumps(value, ensure_ascii=False)
        except Exception:
            sanitized[key_str] = str(value)
    return sanitized
