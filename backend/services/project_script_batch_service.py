from __future__ import annotations

import re
from typing import Iterable
from uuid import uuid4

from fastapi import HTTPException

from backend.models import (
    BatchUpdateSegmentsRequest,
    MergeCharacterRequest,
    MergeSegmentsRequest,
    RenameCharacterRequest,
    SearchReplaceSegmentsRequest,
    Segment,
    SplitSegmentRequest,
)
from backend.persistence import append_project_event, load_project, save_project

from .project_script_service import sync_script_metadata
from .project_snapshot_service import create_project_snapshot

SPLIT_TIMELINE_GAP_MS = 200
_MIN_SPLIT_TIMELINE_DURATION_MS = 100
_CJK_RE = re.compile(r"[\u4e00-\u9fff]")
_LATIN_TOKEN_RE = re.compile(r"[A-Za-z]+(?:[-'][A-Za-z]+)*|\d+(?:[.,]\d+)*")
_PAUSE_WEIGHT_BY_PUNCTUATION = {
    ",": 0.35,
    "，": 0.35,
    ";": 0.5,
    "；": 0.5,
    ":": 0.45,
    "：": 0.45,
    ".": 0.7,
    "。": 0.7,
    "!": 0.75,
    "！": 0.75,
    "?": 0.75,
    "？": 0.75,
    "…": 0.9,
}
_ENDING_PAUSE_BONUS = 0.35


def _normalize_speaker_name(name: str) -> str:
    normalized = (name or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="角色名不能为空")
    return normalized


def _selected_ids(all_segments: list[Segment], requested_ids: Iterable[str]) -> set[str]:
    raw = {str(item).strip() for item in requested_ids if str(item).strip()}
    if not raw:
        return {segment.id for segment in all_segments}
    return raw


def _refresh_project_status(project) -> None:
    if not project.script.segments:
        project.status = "draft"
        return
    project.status = "voices_configured" if project.voice_assignments else "parsed"


def _weighted_text_duration_units(text: str) -> float:
    raw = str(text or "")
    if not raw.strip():
        return 0.0

    total = 0.0
    latin_spans: list[tuple[int, int, str]] = []
    for match in _LATIN_TOKEN_RE.finditer(raw):
        token = match.group(0)
        latin_spans.append((match.start(), match.end(), token))
        if re.search(r"\d", token):
            total += 1.35
        elif token.isupper() and len(token) > 1:
            total += 1.25
        else:
            total += 1.0

    def inside_latin_token(index: int) -> bool:
        return any(start <= index < end for start, end, _token in latin_spans)

    for index, char in enumerate(raw):
        if char.isspace() or inside_latin_token(index):
            continue
        if _CJK_RE.match(char):
            total += 1.0
        elif char in _PAUSE_WEIGHT_BY_PUNCTUATION:
            total += _PAUSE_WEIGHT_BY_PUNCTUATION[char]
        elif char.isdigit():
            total += 1.35
        elif char.isalpha():
            total += 1.0
        else:
            total += 0.2

    stripped = raw.rstrip()
    if stripped and stripped[-1] in _PAUSE_WEIGHT_BY_PUNCTUATION:
        total += _ENDING_PAUSE_BONUS
    return max(0.1, total)


def _split_tts_overrides_duration(overrides: dict, duration_ms: int | None) -> dict:
    next_overrides = dict(overrides or {})
    if duration_ms is not None and duration_ms > 0:
        next_overrides["duration"] = round(duration_ms / 1000.0, 3)
    return next_overrides


def _coerce_positive_seconds(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return number


def _split_timeline_fields(base: Segment, left_text: str, right_text: str) -> tuple[dict, dict]:
    start_ms = base.source_start_ms
    end_ms = base.source_end_ms
    if start_ms is None or end_ms is None:
        return {}, {}

    try:
        start = int(start_ms)
        end = int(end_ms)
    except (TypeError, ValueError):
        return {}, {}
    if end <= start:
        return {}, {}

    total_ms = end - start
    gap_ms = SPLIT_TIMELINE_GAP_MS if total_ms > (SPLIT_TIMELINE_GAP_MS + _MIN_SPLIT_TIMELINE_DURATION_MS * 2) else 0
    available_ms = max(0, total_ms - gap_ms)
    left_units = _weighted_text_duration_units(left_text)
    right_units = _weighted_text_duration_units(right_text)
    ratio = left_units / max(0.1, left_units + right_units)
    min_duration = min(_MIN_SPLIT_TIMELINE_DURATION_MS, max(1, available_ms // 2))
    left_duration = int(round(available_ms * ratio))
    left_duration = max(min_duration, min(available_ms - min_duration, left_duration))
    right_duration = max(0, available_ms - left_duration)

    left_end = start + left_duration
    right_start = min(end, left_end + gap_ms)
    left_duration = max(0, left_end - start)
    right_duration = max(0, end - right_start)

    return (
        {
            "source_start_ms": start,
            "source_end_ms": left_end,
            "source_duration_ms": left_duration,
            "tts_overrides": _split_tts_overrides_duration(base.tts_overrides, left_duration),
        },
        {
            "source_start_ms": right_start,
            "source_end_ms": end,
            "source_duration_ms": right_duration,
            "tts_overrides": _split_tts_overrides_duration(base.tts_overrides, right_duration),
        },
    )


def _merge_timeline_fields(first: Segment, second: Segment) -> dict:
    first_start = first.source_start_ms
    second_end = second.source_end_ms
    if first_start is not None and second_end is not None:
        try:
            start = int(first_start)
            end = int(second_end)
        except (TypeError, ValueError):
            start = None
            end = None
        if start is not None and end is not None and end > start:
            duration_ms = end - start
            return {
                "source_start_ms": start,
                "source_end_ms": end,
                "source_duration_ms": duration_ms,
                "tts_overrides": _split_tts_overrides_duration(first.tts_overrides, duration_ms),
            }

    first_duration = _coerce_positive_seconds((first.tts_overrides or {}).get("duration"))
    second_duration = _coerce_positive_seconds((second.tts_overrides or {}).get("duration"))
    if first_duration is not None and second_duration is not None:
        next_overrides = dict(first.tts_overrides or {})
        next_overrides["duration"] = round(first_duration + second_duration, 3)
        return {"tts_overrides": next_overrides}
    return {}


def _persist_script_change(
    *,
    project,
    projects_dir,
    changed_segment_ids: set[str],
    removed_segment_ids: set[str],
    event_type: str,
    event_message: str,
    extra_event_fields: dict | None = None,
) -> dict:
    for segment_id in changed_segment_ids | removed_segment_ids:
        project.audio_assets.segments.pop(segment_id, None)
    if changed_segment_ids or removed_segment_ids:
        project.audio_assets.full_rebuild_required = True

    project.script = sync_script_metadata(project.script)
    _refresh_project_status(project)
    saved = save_project(projects_dir, project)

    event_payload = {
        "type": event_type,
        "message": event_message,
    }
    if extra_event_fields:
        event_payload.update(extra_event_fields)
    append_project_event(
        projects_dir,
        project.id,
        {
            "source": "project",
            "status": project.status,
            "event": event_payload,
        },
    )
    return {
        "project_id": saved.id,
        "script": saved.script,
        "status": saved.status,
        "changed_segment_ids": sorted(changed_segment_ids),
        "removed_segment_ids": sorted(removed_segment_ids),
    }


def rename_character(project_id: str, payload: RenameCharacterRequest, *, projects_dir):
    project = load_project(projects_dir, project_id)
    source_name = _normalize_speaker_name(payload.from_name)
    target_name = _normalize_speaker_name(payload.to_name)
    if source_name == target_name:
        raise HTTPException(status_code=400, detail="源角色名和目标角色名不能相同")

    create_project_snapshot(projects_dir, project, reason="before_character_rename")
    changed_segment_ids: set[str] = set()
    renamed_count = 0
    for segment in project.script.segments:
        if (segment.speaker or "").strip() != source_name:
            continue
        segment.speaker = target_name
        changed_segment_ids.add(segment.id)
        renamed_count += 1

    if renamed_count == 0:
        raise HTTPException(status_code=404, detail="未找到要改名的角色")

    source_voice = project.voice_assignments.pop(source_name, None)
    if source_voice and target_name not in project.voice_assignments:
        project.voice_assignments[target_name] = source_voice

    return _persist_script_change(
        project=project,
        projects_dir=projects_dir,
        changed_segment_ids=changed_segment_ids,
        removed_segment_ids=set(),
        event_type="character_renamed",
        event_message=f"角色改名：{source_name} -> {target_name}，影响 {renamed_count} 段",
        extra_event_fields={"from_name": source_name, "to_name": target_name, "affected_count": renamed_count},
    )


def merge_character(project_id: str, payload: MergeCharacterRequest, *, projects_dir):
    project = load_project(projects_dir, project_id)
    source_name = _normalize_speaker_name(payload.source_name)
    target_name = _normalize_speaker_name(payload.target_name)
    if source_name == target_name:
        raise HTTPException(status_code=400, detail="源角色名和目标角色名不能相同")

    create_project_snapshot(projects_dir, project, reason="before_character_merge")
    changed_segment_ids: set[str] = set()
    merged_count = 0
    for segment in project.script.segments:
        if (segment.speaker or "").strip() != source_name:
            continue
        segment.speaker = target_name
        changed_segment_ids.add(segment.id)
        merged_count += 1

    if merged_count == 0:
        raise HTTPException(status_code=404, detail="未找到要合并的源角色")

    source_voice = project.voice_assignments.pop(source_name, None)
    if source_voice and target_name not in project.voice_assignments:
        project.voice_assignments[target_name] = source_voice

    return _persist_script_change(
        project=project,
        projects_dir=projects_dir,
        changed_segment_ids=changed_segment_ids,
        removed_segment_ids=set(),
        event_type="character_merged",
        event_message=f"角色合并：{source_name} -> {target_name}，影响 {merged_count} 段",
        extra_event_fields={"source_name": source_name, "target_name": target_name, "affected_count": merged_count},
    )


def batch_update_segments(project_id: str, payload: BatchUpdateSegmentsRequest, *, projects_dir):
    if payload.emotion is None and payload.type is None:
        raise HTTPException(status_code=400, detail="至少提供一种批量修改字段（emotion/type）")

    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_batch_segment_update")
    targets = _selected_ids(project.script.segments, payload.segment_ids)
    changed_segment_ids: set[str] = set()
    affected_count = 0
    for segment in project.script.segments:
        if segment.id not in targets:
            continue
        changed = False
        if payload.emotion is not None and segment.emotion != payload.emotion:
            segment.emotion = payload.emotion
            changed = True
        if payload.type is not None and segment.type != payload.type:
            segment.type = payload.type
            changed = True
        if changed:
            affected_count += 1
            changed_segment_ids.add(segment.id)

    return _persist_script_change(
        project=project,
        projects_dir=projects_dir,
        changed_segment_ids=changed_segment_ids,
        removed_segment_ids=set(),
        event_type="segments_batch_updated",
        event_message=f"批量修改完成，变更 {affected_count} 段",
        extra_event_fields={
            "affected_count": affected_count,
            "target_count": len(targets),
            "emotion": payload.emotion,
            "type": payload.type,
        },
    )


def search_replace_segments(project_id: str, payload: SearchReplaceSegmentsRequest, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_search_replace")

    flags = 0 if payload.case_sensitive else re.IGNORECASE
    pattern = re.compile(re.escape(payload.find), flags)
    targets = _selected_ids(project.script.segments, payload.segment_ids)
    changed_segment_ids: set[str] = set()
    affected_segments = 0
    replaced_count = 0

    for segment in project.script.segments:
        if segment.id not in targets:
            continue
        next_text, count = pattern.subn(payload.replace, segment.text or "")
        if count <= 0:
            continue
        replaced_count += count
        affected_segments += 1
        segment.text = next_text
        changed_segment_ids.add(segment.id)

    return _persist_script_change(
        project=project,
        projects_dir=projects_dir,
        changed_segment_ids=changed_segment_ids,
        removed_segment_ids=set(),
        event_type="segments_search_replaced",
        event_message=f"搜索替换完成，命中 {replaced_count} 处，影响 {affected_segments} 段",
        extra_event_fields={
            "find": payload.find,
            "replace": payload.replace,
            "case_sensitive": payload.case_sensitive,
            "affected_segments": affected_segments,
            "replaced_count": replaced_count,
            "target_count": len(targets),
        },
    )


def split_segment(project_id: str, payload: SplitSegmentRequest, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_segment_split")

    idx = next((i for i, item in enumerate(project.script.segments) if item.id == payload.segment_id), -1)
    if idx < 0:
        raise HTTPException(status_code=404, detail="要拆分的片段不存在")
    base = project.script.segments[idx]
    text = base.text or ""
    if payload.cursor <= 0 or payload.cursor >= len(text):
        raise HTTPException(status_code=400, detail="拆分位置必须在文本中间")

    left = text[: payload.cursor].strip()
    right = text[payload.cursor :].strip()
    if not left or not right:
        raise HTTPException(status_code=400, detail="拆分后的片段不能为空")

    left_timeline, right_timeline = _split_timeline_fields(base, left, right)
    base.text = left
    for key, value in left_timeline.items():
        setattr(base, key, value)
    new_segment = base.model_copy(
        update={
            "id": str(uuid4()),
            "text": right,
            "index": base.index + 1,
            **right_timeline,
        }
    )
    project.script.segments.insert(idx + 1, new_segment)
    return _persist_script_change(
        project=project,
        projects_dir=projects_dir,
        changed_segment_ids={base.id},
        removed_segment_ids=set(),
        event_type="segment_split",
        event_message=f"片段 {base.id} 已拆分为两段",
        extra_event_fields={"segment_id": base.id, "new_segment_id": new_segment.id, "cursor": payload.cursor},
    )


def merge_adjacent_segments(project_id: str, payload: MergeSegmentsRequest, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_segment_merge")

    first_idx = next((i for i, item in enumerate(project.script.segments) if item.id == payload.first_segment_id), -1)
    second_idx = next((i for i, item in enumerate(project.script.segments) if item.id == payload.second_segment_id), -1)
    if first_idx < 0 or second_idx < 0:
        raise HTTPException(status_code=404, detail="要合并的片段不存在")
    if second_idx != first_idx + 1:
        raise HTTPException(status_code=400, detail="仅支持合并相邻片段（第二段必须紧跟第一段）")

    first_segment = project.script.segments[first_idx]
    second_segment = project.script.segments[second_idx]
    first_text = (first_segment.text or "").strip()
    second_text = (second_segment.text or "").strip()
    if not first_text and not second_text:
        raise HTTPException(status_code=400, detail="两个片段都为空，无法合并")
    if first_text and second_text:
        first_segment.text = f"{first_text} {second_text}".strip()
    else:
        first_segment.text = first_text or second_text
    for key, value in _merge_timeline_fields(first_segment, second_segment).items():
        setattr(first_segment, key, value)
    project.script.segments.pop(second_idx)

    return _persist_script_change(
        project=project,
        projects_dir=projects_dir,
        changed_segment_ids={first_segment.id},
        removed_segment_ids={second_segment.id},
        event_type="segments_merged",
        event_message=f"片段 {first_segment.id} 与 {second_segment.id} 已合并",
        extra_event_fields={"first_segment_id": first_segment.id, "second_segment_id": second_segment.id},
    )
