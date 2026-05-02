from __future__ import annotations

import re
from typing import Any


_NON_VERBAL_TAG_RE = re.compile(r"\[([^\[\]]+)\]")
_PINYIN_INLINE_RE = re.compile(r"([\u4e00-\u9fff])([A-Z]{1,12}[1-5])")
_PHONEME_BRACE_RE = re.compile(r"\{[^{}]+\}")

VOXCPM2_SUPPORTED_TAGS: dict[str, str] = {
    "laughing": "[laughing]",
    "sigh": "[sigh]",
    "uhm": "[Uhm]",
    "shh": "[Shh]",
    "question-ah": "[Question-ah]",
    "question-ei": "[Question-ei]",
    "question-en": "[Question-en]",
    "question-oh": "[Question-oh]",
    "surprise-wa": "[Surprise-wa]",
    "surprise-yo": "[Surprise-yo]",
    "dissatisfaction-hnn": "[Dissatisfaction-hnn]",
}

VOXCPM2_TAG_ALIASES: dict[str, str] = {
    "laugh": "laughing",
    "laughter": "laughing",
    "laughing": "laughing",
    "sigh": "sigh",
    "uhm": "uhm",
    "shh": "shh",
    "confirmation-en": "question-en",
    "question-ah": "question-ah",
    "question-ei": "question-ei",
    "question-en": "question-en",
    "question-oh": "question-oh",
    "surprise-wa": "surprise-wa",
    "surprise-yo": "surprise-yo",
    "dissatisfaction-hnn": "dissatisfaction-hnn",
}

_EMOTION_TO_STYLE = {
    "neutral": "",
    "cheerful": "cheerful tone",
    "sad": "sad tone",
    "angry": "angry tone",
    "fearful": "tense tone",
    "surprise": "surprised tone",
    "melancholy": "low and sad tone",
    "tender": "soft and tender tone",
    "serious": "serious tone",
    "playful": "playful tone",
    "concern": "concerned tone",
    "excited": "excited tone",
}


def _normalize_tag(raw: str) -> str | None:
    key = (raw or "").strip().strip("[]").lower()
    if not key:
        return None
    mapped = VOXCPM2_TAG_ALIASES.get(key)
    if not mapped:
        return None
    return VOXCPM2_SUPPORTED_TAGS.get(mapped)


def _collect_supported_tags(text: str, non_verbal: list[str] | None) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for source_tag in _NON_VERBAL_TAG_RE.findall(text or ""):
        normalized = _normalize_tag(source_tag)
        if normalized and normalized not in seen:
            tags.append(normalized)
            seen.add(normalized)
    for source_tag in non_verbal or []:
        normalized = _normalize_tag(str(source_tag))
        if normalized and normalized not in seen:
            tags.append(normalized)
            seen.add(normalized)
    return tags


def _strip_all_non_verbal_tags(text: str) -> str:
    return _NON_VERBAL_TAG_RE.sub("", text or "")


def _convert_inline_pinyin_to_phoneme(text: str) -> tuple[str, bool]:
    converted = _PINYIN_INLINE_RE.sub(lambda m: "{" + m.group(2).lower() + "}", text or "")
    has_phoneme = bool(_PHONEME_BRACE_RE.search(converted))
    return converted, has_phoneme


def build_voxcpm2_text_payload(
    *,
    text: str,
    non_verbal: list[str] | None,
    emotion: str | None,
    speed: float | None,
) -> dict[str, Any]:
    supported_tags = _collect_supported_tags(text, non_verbal)
    base = _strip_all_non_verbal_tags(text).strip()
    converted, has_phoneme = _convert_inline_pinyin_to_phoneme(base)
    rendered_text = converted.strip()
    if supported_tags:
        rendered_text = f"{' '.join(supported_tags)} {rendered_text}".strip()

    style_parts: list[str] = []
    emotion_key = (emotion or "neutral").strip().lower()
    emotion_style = _EMOTION_TO_STYLE.get(emotion_key, "")
    if emotion_style:
        style_parts.append(emotion_style)
    if isinstance(speed, (int, float)):
        speed_value = float(speed)
        if speed_value >= 1.1:
            style_parts.append("slightly faster")
        elif speed_value <= 0.9:
            style_parts.append("slower")

    style_instruction = ", ".join(style_parts).strip()
    return {
        "text": rendered_text,
        "style_instruction": style_instruction,
        "has_phoneme": has_phoneme,
        "tags": supported_tags,
    }
