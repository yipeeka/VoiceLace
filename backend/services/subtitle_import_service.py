from __future__ import annotations

import html
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from backend.models import Character, Project, Segment
from backend.persistence import append_project_event, save_project
from backend.services.dubbing_translation_service import (
    DEFAULT_MAX_SPEED,
    DEFAULT_MIN_SPEED,
    resolve_target_duration_sec,
    safe_duration_from_ms,
    translate_dubbing_segments_for_state,
)

SubtitleFormat = Literal["srt", "ass"]
SubtitleLinePolicy = Literal["auto", "first_line", "second_line", "all"]
SubtitleDubbingMode = Literal["original", "translated"]

_SRT_TIME_RE = re.compile(
    r"^\s*(?P<start>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*"
    r"(?P<end>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})"
)
_ASS_OVERRIDE_RE = re.compile(r"\{[^}]*\}")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_SRT_SPEAKER_PREFIX_RE = re.compile(r"^\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_\-\s]{0,20})\s*[：:]\s*(.+)$", re.S)


@dataclass(slots=True)
class SubtitleCue:
    id: str
    index: int
    speaker: str
    text: str
    start_ms: int
    end_ms: int
    duration_ms: int
    raw_text: str

    def as_preview(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "index": self.index,
            "speaker": self.speaker,
            "text": self.text,
            "start_ms": self.start_ms,
            "end_ms": self.end_ms,
            "duration_ms": self.duration_ms,
            "raw_text": self.raw_text,
        }


def _decode_subtitle_bytes(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "utf-16"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def detect_subtitle_format(filename: str | None, text: str) -> SubtitleFormat:
    suffix = Path(filename or "").suffix.lower()
    if suffix == ".ass":
        return "ass"
    if suffix == ".srt":
        return "srt"
    if "[events]" in text.lower() and "dialogue:" in text.lower():
        return "ass"
    return "srt"


def _normalize_line_policy(value: str | None) -> SubtitleLinePolicy:
    normalized = str(value or "auto").strip().lower()
    if normalized in {"first", "first_line"}:
        return "first_line"
    if normalized in {"second", "second_line"}:
        return "second_line"
    if normalized == "all":
        return "all"
    return "auto"


def _normalize_mode(value: str | None) -> SubtitleDubbingMode:
    return "translated" if str(value or "").strip().lower() == "translated" else "original"


def _clean_subtitle_text(value: str) -> str:
    text = str(value or "")
    text = text.replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
    text = _ASS_OVERRIDE_RE.sub("", text)
    text = _HTML_TAG_RE.sub("", text)
    text = html.unescape(text)
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line).strip()


def _select_text_lines(lines: list[str], *, line_policy: SubtitleLinePolicy, mode: SubtitleDubbingMode) -> str:
    cleaned = [_clean_subtitle_text(line) for line in lines]
    cleaned = [line for line in cleaned if line]
    if not cleaned:
        return ""
    if line_policy == "first_line":
        return cleaned[0]
    if line_policy == "second_line":
        return cleaned[1] if len(cleaned) > 1 else cleaned[0]
    if line_policy == "all":
        return "\n".join(cleaned)
    if mode == "translated" and len(cleaned) >= 2:
        return cleaned[0]
    return "\n".join(cleaned)


def _parse_srt_timestamp(value: str) -> int:
    raw = str(value or "").strip().replace(",", ".")
    head, millis = raw.split(".", 1)
    hh, mm, ss = [int(part) for part in head.split(":")]
    ms = int((millis + "000")[:3])
    return ((hh * 60 + mm) * 60 + ss) * 1000 + ms


def _parse_ass_timestamp(value: str) -> int:
    raw = str(value or "").strip()
    if "." in raw:
        head, fraction = raw.split(".", 1)
    else:
        head, fraction = raw, "0"
    hh, mm, ss = [int(part) for part in head.split(":")]
    ms = int((fraction + "000")[:3]) if len(fraction) >= 3 else int((fraction + "00")[:2]) * 10
    return ((hh * 60 + mm) * 60 + ss) * 1000 + ms


def _split_srt_speaker(text: str) -> tuple[str, str]:
    raw = str(text or "").strip()
    match = _SRT_SPEAKER_PREFIX_RE.match(raw)
    if not match:
        return "narrator", raw
    speaker = re.sub(r"\s+", "", match.group(1)).strip()
    body = match.group(2).strip()
    if not speaker or not body:
        return "narrator", raw
    return speaker, body


def _make_cue(
    *,
    index: int,
    speaker: str,
    text: str,
    start_ms: int,
    end_ms: int,
    raw_text: str,
    warnings: list[str],
) -> SubtitleCue | None:
    body = str(text or "").strip()
    if not body:
        warnings.append(f"第 {index + 1} 条字幕为空，已跳过。")
        return None
    if end_ms < start_ms:
        warnings.append(f"第 {index + 1} 条字幕结束时间早于开始时间，已修正为零时长。")
        end_ms = start_ms
    duration_ms = max(0, int(end_ms - start_ms))
    if duration_ms == 0:
        warnings.append(f"第 {index + 1} 条字幕时长为 0，合成时可能需要手动调整。")
    return SubtitleCue(
        id=f"sub-{index + 1:04d}",
        index=index,
        speaker=str(speaker or "").strip() or "narrator",
        text=body,
        start_ms=int(start_ms),
        end_ms=int(end_ms),
        duration_ms=duration_ms,
        raw_text=str(raw_text or "").strip(),
    )


def _parse_srt(text: str, *, line_policy: SubtitleLinePolicy, mode: SubtitleDubbingMode) -> tuple[list[SubtitleCue], list[str]]:
    warnings: list[str] = []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    cues: list[SubtitleCue] = []
    cursor = 0
    while cursor < len(lines):
        while cursor < len(lines) and not lines[cursor].strip():
            cursor += 1
        if cursor >= len(lines):
            break

        if not _SRT_TIME_RE.match(lines[cursor]) and cursor + 1 < len(lines) and _SRT_TIME_RE.match(lines[cursor + 1]):
            cursor += 1
        match = _SRT_TIME_RE.match(lines[cursor]) if cursor < len(lines) else None
        if not match:
            warnings.append(f"跳过无法识别的 SRT 行：{lines[cursor].strip()[:40]}")
            cursor += 1
            continue

        start_ms = _parse_srt_timestamp(match.group("start"))
        end_ms = _parse_srt_timestamp(match.group("end"))
        cursor += 1
        body_lines: list[str] = []
        while cursor < len(lines) and lines[cursor].strip():
            body_lines.append(lines[cursor])
            cursor += 1

        selected = _select_text_lines(body_lines, line_policy=line_policy, mode=mode)
        speaker, body = _split_srt_speaker(selected)
        cue = _make_cue(
            index=len(cues),
            speaker=speaker,
            text=body,
            start_ms=start_ms,
            end_ms=end_ms,
            raw_text="\n".join(body_lines),
            warnings=warnings,
        )
        if cue:
            cues.append(cue)

    return cues, warnings


def _parse_ass(text: str, *, line_policy: SubtitleLinePolicy, mode: SubtitleDubbingMode) -> tuple[list[SubtitleCue], list[str]]:
    warnings: list[str] = []
    fields: list[str] = []
    in_events = False
    cues: list[SubtitleCue] = []

    for line_no, raw_line in enumerate(text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), start=1):
        line = raw_line.strip()
        if not line:
            continue
        lower = line.lower()
        if lower == "[events]":
            in_events = True
            continue
        if line.startswith("[") and lower != "[events]":
            in_events = False
            continue
        if not in_events:
            continue
        if lower.startswith("format:"):
            fields = [part.strip() for part in line.split(":", 1)[1].split(",")]
            continue
        if not lower.startswith("dialogue:"):
            continue
        if not fields:
            fields = ["Layer", "Start", "End", "Style", "Name", "MarginL", "MarginR", "MarginV", "Effect", "Text"]
        payload = line.split(":", 1)[1].strip()
        parts = payload.split(",", max(0, len(fields) - 1))
        if len(parts) < len(fields):
            warnings.append(f"第 {line_no} 行 ASS Dialogue 字段不足，已跳过。")
            continue
        row = {field.strip().lower(): parts[idx].strip() for idx, field in enumerate(fields)}
        try:
            start_ms = _parse_ass_timestamp(row.get("start", "0:00:00.00"))
            end_ms = _parse_ass_timestamp(row.get("end", "0:00:00.00"))
        except Exception:
            warnings.append(f"第 {line_no} 行 ASS 时间轴无效，已跳过。")
            continue

        text_field = row.get("text", "")
        text_lines = text_field.replace("\\N", "\n").replace("\\n", "\n").splitlines()
        selected = _select_text_lines(text_lines, line_policy=line_policy, mode=mode)
        speaker = row.get("name", "").strip() or "narrator"
        cue = _make_cue(
            index=len(cues),
            speaker=speaker,
            text=selected,
            start_ms=start_ms,
            end_ms=end_ms,
            raw_text=text_field,
            warnings=warnings,
        )
        if cue:
            cues.append(cue)

    if not cues:
        warnings.append("未解析到 ASS Dialogue 字幕。")
    return cues, warnings


def parse_subtitle_bytes(
    data: bytes,
    *,
    filename: str | None = None,
    line_policy: str | None = None,
    mode: str | None = None,
) -> dict[str, Any]:
    text = _decode_subtitle_bytes(data)
    subtitle_format = detect_subtitle_format(filename, text)
    normalized_policy = _normalize_line_policy(line_policy)
    normalized_mode = _normalize_mode(mode)
    if subtitle_format == "ass":
        cues, warnings = _parse_ass(text, line_policy=normalized_policy, mode=normalized_mode)
    else:
        cues, warnings = _parse_srt(text, line_policy=normalized_policy, mode=normalized_mode)
    speakers = []
    for cue in cues:
        if cue.speaker and cue.speaker not in speakers:
            speakers.append(cue.speaker)
    return {
        "format": subtitle_format,
        "line_policy": normalized_policy,
        "mode": normalized_mode,
        "cues": [cue.as_preview() for cue in cues],
        "speakers": speakers,
        "warnings": warnings,
        "segment_count": len(cues),
    }


def _fallback_project_name(project_name: str | None, filename: str | None, mode: SubtitleDubbingMode) -> str:
    trimmed = str(project_name or "").strip()
    if trimmed:
        return trimmed
    stem = Path(filename or "").stem.strip()
    suffix = "翻译配音" if mode == "translated" else "字幕配音"
    return f"{stem}-{suffix}" if stem else suffix


def _characters_from_segments(segments: list[Segment]) -> list[Character]:
    names: list[str] = []
    for segment in segments:
        speaker = str(segment.speaker or "").strip() or "narrator"
        if speaker not in names:
            names.append(speaker)
    return [Character(name=name, appearance_count=sum(1 for seg in segments if seg.speaker == name)) for name in names]


def _cue_to_translation_input(cue: SubtitleCue) -> dict[str, Any]:
    return {
        "id": cue.id,
        "speaker": cue.speaker,
        "text": cue.text,
        "start_ms": cue.start_ms,
        "end_ms": cue.end_ms,
    }


def _segment_from_row(row: dict[str, Any], *, index: int) -> Segment:
    start_ms = int(row["start_ms"]) if row.get("start_ms") is not None else None
    end_ms = int(row["end_ms"]) if row.get("end_ms") is not None else None
    duration_ms = row.get("duration_ms")
    if duration_ms is None and start_ms is not None and end_ms is not None and end_ms >= start_ms:
        duration_ms = end_ms - start_ms
    target_duration = resolve_target_duration_sec(start_ms, end_ms)
    if target_duration is None:
        target_duration = safe_duration_from_ms(start_ms, end_ms)
    overrides = dict(row.get("tts_overrides") or {})
    if target_duration is not None:
        overrides.setdefault("duration", round(float(target_duration), 3))
    speed = overrides.get("speed")
    if speed is None:
        overrides["speed"] = 1.0
    else:
        try:
            numeric_speed = float(speed)
        except (TypeError, ValueError):
            numeric_speed = 1.0
        overrides["speed"] = max(DEFAULT_MIN_SPEED, min(DEFAULT_MAX_SPEED, numeric_speed))
    return Segment(
        id=str(row.get("id") or f"sub-{index + 1:04d}"),
        index=index,
        type="dialogue" if str(row.get("speaker") or "narrator") != "narrator" else "narration",
        speaker=str(row.get("speaker") or "narrator"),
        text=str(row.get("text") or "").strip(),
        emotion="neutral",
        non_verbal=[],
        tts_overrides=overrides,
        source_text=str(row.get("source_text") or row.get("text") or "").strip(),
        source_start_ms=start_ms,
        source_end_ms=end_ms,
        source_duration_ms=int(duration_ms) if duration_ms is not None else None,
    )


async def create_dubbing_project_from_subtitle(
    *,
    state,
    data: bytes,
    filename: str | None,
    project_name: str | None,
    mode: str | None,
    target_language: str,
    translation_source: str,
    line_policy: str | None,
    translated_segments_json: str | None = None,
) -> dict[str, Any]:
    normalized_mode = _normalize_mode(mode)
    parsed = parse_subtitle_bytes(data, filename=filename, line_policy=line_policy, mode=normalized_mode)
    cues = [
        SubtitleCue(
            id=str(item["id"]),
            index=int(item["index"]),
            speaker=str(item["speaker"] or "narrator"),
            text=str(item["text"] or ""),
            start_ms=int(item["start_ms"]),
            end_ms=int(item["end_ms"]),
            duration_ms=int(item["duration_ms"]),
            raw_text=str(item.get("raw_text") or ""),
        )
        for item in parsed["cues"]
    ]
    if not cues:
        raise ValueError("未解析到可用字幕分段。")

    translated_payload = None
    if translated_segments_json:
        try:
            translated_payload = json.loads(translated_segments_json)
        except json.JSONDecodeError as exc:
            raise ValueError("translated_segments 不是合法 JSON") from exc
        if not isinstance(translated_payload, list):
            raise ValueError("translated_segments 必须是数组")

    if normalized_mode == "translated" and translated_payload is not None:
        rows = []
        row_by_id = {str(item.get("id") or ""): item for item in translated_payload if isinstance(item, dict)}
        for cue in cues:
            row = row_by_id.get(cue.id)
            if not row:
                raise ValueError(f"缺少字幕分段 {cue.id} 的翻译结果")
            rows.append(
                {
                    **row,
                    "id": cue.id,
                    "index": cue.index,
                    "speaker": cue.speaker,
                    "source_text": cue.text,
                    "start_ms": cue.start_ms,
                    "end_ms": cue.end_ms,
                    "duration_ms": cue.duration_ms,
                }
            )
        source_text = "\n".join(f"{row.get('speaker') or 'narrator'}：{row.get('text') or ''}".strip() for row in rows)
    elif normalized_mode == "translated":
        translated = await translate_dubbing_segments_for_state(
            state=state,
            source=translation_source,
            target_language=target_language,
            segments=[_cue_to_translation_input(cue) for cue in cues],
        )
        rows = translated["segments"]
        source_text = str(translated.get("translated_text") or "").strip()
    else:
        rows = [
            {
                "id": cue.id,
                "index": cue.index,
                "speaker": cue.speaker,
                "source_text": cue.text,
                "text": cue.text,
                "start_ms": cue.start_ms,
                "end_ms": cue.end_ms,
                "duration_ms": cue.duration_ms,
                "tts_overrides": {
                    "duration": round(
                        float(
                            resolve_target_duration_sec(cue.start_ms, cue.end_ms)
                            or max(0.3, cue.duration_ms / 1000.0)
                        ),
                        3,
                    ),
                    "speed": 1.0,
                },
            }
            for cue in cues
        ]
        source_text = "\n".join(f"{cue.speaker}：{cue.text}" if cue.speaker else cue.text for cue in cues)

    project = Project(name=_fallback_project_name(project_name, filename, normalized_mode))
    project.status = "parsed"
    project.synthesis_config.timeline_lock_enabled = True
    project.script.title = project.name
    project.script.source_text = source_text
    project.script.metadata = {
        "subtitle_source": True,
        "dubbing_source": True,
        "subtitle_format": parsed["format"],
        "dubbing_mode": normalized_mode,
        "dubbing_target_language": str(target_language or ""),
        "dubbing_source_backend": str(translation_source or ""),
        "subtitle_line_policy": parsed["line_policy"],
        "subtitle_segment_count": len(rows),
    }
    segments = [_segment_from_row(row, index=idx) for idx, row in enumerate(rows)]
    project.script.segments = segments
    project.script.characters = _characters_from_segments(segments)

    saved = save_project(state.settings.projects_dir, project)
    append_project_event(
        state.settings.projects_dir,
        saved.id,
        {
            "source": "project",
            "status": saved.status,
            "event": {
                "type": "subtitle_dubbing_project_created",
                "message": f"已从字幕创建配音项目，共 {len(segments)} 段",
                "subtitle_format": parsed["format"],
                "dubbing_mode": normalized_mode,
                "segment_count": len(segments),
            },
        },
    )
    return {
        "project_id": saved.id,
        "project": saved,
        "status": "created",
        "format": parsed["format"],
        "mode": normalized_mode,
        "segment_count": len(segments),
        "speakers": parsed["speakers"],
        "warnings": parsed["warnings"],
    }


async def translate_subtitle_preview(
    *,
    state,
    data: bytes,
    filename: str | None,
    target_language: str,
    translation_source: str,
    line_policy: str | None,
    max_concurrency: int = 1,
    progress_callback=None,
    cancel_check=None,
) -> dict[str, Any]:
    parsed = parse_subtitle_bytes(data, filename=filename, line_policy=line_policy, mode="translated")
    cues = [
        SubtitleCue(
            id=str(item["id"]),
            index=int(item["index"]),
            speaker=str(item["speaker"] or "narrator"),
            text=str(item["text"] or ""),
            start_ms=int(item["start_ms"]),
            end_ms=int(item["end_ms"]),
            duration_ms=int(item["duration_ms"]),
            raw_text=str(item.get("raw_text") or ""),
        )
        for item in parsed["cues"]
    ]
    if not cues:
        raise ValueError("未解析到可用字幕分段。")
    translated = await translate_dubbing_segments_for_state(
        state=state,
        source=translation_source,
        target_language=target_language,
        segments=[_cue_to_translation_input(cue) for cue in cues],
        max_concurrency=max_concurrency,
        progress_callback=progress_callback,
        cancel_check=cancel_check,
    )
    rows = translated["segments"]
    row_by_id = {str(row.get("id") or ""): row for row in rows}
    preview_cues = []
    for cue in cues:
        row = row_by_id.get(cue.id, {})
        preview_cues.append(
            {
                **cue.as_preview(),
                "translated_text": str(row.get("text") or ""),
                "tts_overrides": row.get("tts_overrides") or {},
                "target_duration_sec": row.get("target_duration_sec"),
                "estimated_duration_sec": row.get("estimated_duration_sec"),
            }
        )
    return {
        **parsed,
        "mode": "translated",
        "target_language": target_language,
        "translation_source": translation_source,
        "translation_backend": translated.get("backend", ""),
        "max_concurrency": translated.get("max_concurrency", 1),
        "translated_segments": rows,
        "cues": preview_cues,
        "translated_text": translated.get("translated_text", ""),
    }
