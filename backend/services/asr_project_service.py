from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Awaitable, Callable

from backend.models import LlmParseRequest, Project
from backend.persistence import append_project_event, save_project

CHUNK_DURATION_MS = 10 * 60 * 1000
CHUNK_OVERLAP_MS = 2 * 1000
_AUTO_SPEAKER_PREFIX = re.compile(r"^\s*[\[(（【]?\s*(?:说话人|speaker|spk|s)\s*[-_#]?\s*\d+\s*[\])）】]?\s*[：:]\s*", re.IGNORECASE)
_LEADING_LABEL = re.compile(r"^\s*([\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9_\-\s]{0,20})\s*[：:]\s*")
_AUTO_SPEAKER_LABEL = re.compile(r"^(?:说话人|speaker|spk|s)\s*[-_#]?\s*\d+$", re.IGNORECASE)


def _normalize_label_token(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "").strip().lower())


def _strip_embedded_speaker_prefix(text: str, speaker: str = "") -> str:
    cleaned = str(text or "").strip()
    if not cleaned:
        return ""

    for _ in range(4):
        next_text = _AUTO_SPEAKER_PREFIX.sub("", cleaned).strip()
        if next_text == cleaned:
            break
        cleaned = next_text
    if not cleaned:
        return ""

    # Handle chained prefixes like: "旁白：说话人1：这病..."
    cursor = cleaned
    labels: list[str] = []
    for _ in range(4):
        match = _LEADING_LABEL.match(cursor)
        if not match:
            break
        labels.append(match.group(1))
        cursor = cursor[match.end() :].strip()
        if not cursor:
            return ""
    if not labels:
        return cleaned

    normalized_labels = [_normalize_label_token(item) for item in labels]
    normalized_speaker = _normalize_label_token(speaker)
    has_auto_label = any(_AUTO_SPEAKER_LABEL.match(item) for item in normalized_labels)
    first_is_same_speaker = bool(normalized_speaker) and normalized_labels[0] == normalized_speaker
    if has_auto_label or first_is_same_speaker:
        return cursor
    return cleaned


def _fallback_project_name(project_name: str | None, audio_name: str | None) -> str:
    trimmed = (project_name or "").strip()
    if trimmed:
        return trimmed
    stem = Path(audio_name or "音频转项目").stem.strip()
    return stem or "音频转项目"


def _probe_audio_duration_ms(audio_path: Path) -> int:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(audio_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, check=True)
    except FileNotFoundError:
        return 0
    except subprocess.CalledProcessError:
        return 0
    raw = (proc.stdout or b"").decode("utf-8", errors="ignore").strip()
    try:
        return max(0, int(round(float(raw) * 1000)))
    except Exception:
        return 0


def _build_chunk_windows(duration_ms: int) -> list[tuple[int, int]]:
    if duration_ms <= 0:
        return [(0, 0)]
    windows: list[tuple[int, int]] = []
    cursor = 0
    while cursor < duration_ms:
        end_ms = min(duration_ms, cursor + CHUNK_DURATION_MS)
        windows.append((cursor, end_ms))
        if end_ms >= duration_ms:
            break
        cursor = max(0, end_ms - CHUNK_OVERLAP_MS)
    return windows or [(0, duration_ms)]


def _extract_chunk(input_path: Path, output_path: Path, start_ms: int, end_ms: int) -> None:
    duration_ms = max(1, end_ms - start_ms)
    start_s = f"{start_ms / 1000:.3f}"
    duration_s = f"{duration_ms / 1000:.3f}"
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(input_path),
        "-ss",
        start_s,
        "-t",
        duration_s,
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    subprocess.run(cmd, capture_output=True, check=True)


def _normalize_segment(seg: dict[str, Any], *, fallback_id: str, offset_ms: int) -> dict[str, Any]:
    speaker = str(seg.get("speaker") or "").strip()
    text = _strip_embedded_speaker_prefix(str(seg.get("text", "")), speaker)
    if not text:
        return {}
    start_ms = int(seg.get("start_ms") or 0) + int(offset_ms)
    end_ms = int(seg.get("end_ms") or 0) + int(offset_ms)
    if end_ms < start_ms:
        end_ms = start_ms
    return {
        "id": str(seg.get("id") or fallback_id),
        "start_ms": start_ms,
        "end_ms": end_ms,
        "text": text,
        "speaker": speaker,
    }


def _trim_overlap_duplicates(merged: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not merged or not incoming:
        return incoming
    tail_text = str(merged[-1].get("text", "")).strip()
    while incoming and str(incoming[0].get("text", "")).strip() == tail_text:
        incoming.pop(0)
    return incoming


def _apply_speaker_map(segments: list[dict[str, Any]], speaker_map: dict[str, str]) -> list[dict[str, Any]]:
    if not speaker_map:
        return [dict(seg) for seg in segments]
    remapped: list[dict[str, Any]] = []
    for seg in segments:
        current = str(seg.get("speaker") or "").strip()
        mapped = str(speaker_map.get(current, current)).strip() or current
        remapped.append({**seg, "speaker": mapped})
    return remapped


def _build_labeled_text(segments: list[dict[str, Any]], fallback_text: str) -> str:
    lines: list[str] = []
    for seg in segments:
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        speaker = str(seg.get("speaker", "")).strip()
        if speaker:
            lines.append(f"{speaker}：{text}")
        else:
            lines.append(text)
    if lines:
        return "\n".join(lines)
    return fallback_text.strip()


def _build_plain_text(segments: list[dict[str, Any]], fallback_text: str) -> str:
    parts = [str(seg.get("text", "")).strip() for seg in segments if str(seg.get("text", "")).strip()]
    if parts:
        return "\n".join(parts)
    return fallback_text.strip()


def _to_speaker_identity_map(segments: list[dict[str, Any]]) -> dict[str, str]:
    speakers: list[str] = []
    for seg in segments:
        speaker = str(seg.get("speaker") or "").strip()
        if speaker and speaker not in speakers:
            speakers.append(speaker)
    return {speaker: speaker for speaker in speakers}


def _update_asr_metadata(project: Project, *, segment_count: int, failed_chunk_count: int, warnings_count: int, speaker_labels: bool) -> None:
    metadata = dict(project.script.metadata or {})
    metadata["asr_source"] = True
    metadata["asr_segment_count"] = int(segment_count)
    metadata["asr_failed_chunk_count"] = int(failed_chunk_count)
    metadata["asr_warnings_count"] = int(warnings_count)
    metadata["asr_speaker_labels_enabled"] = bool(speaker_labels)
    project.script.metadata = metadata


async def create_project_from_audio(
    *,
    state,
    audio_path: Path,
    audio_name: str | None,
    project_name: str | None,
    speaker_labels: bool,
    asr_backend: str = "whisper",
    language: str = "auto",
    enable_timestamps: bool = False,
    parse_mode: str,
    auto_parse: bool,
    speaker_map: dict[str, str] | None = None,
    enqueue_parse_task=None,
    on_progress: Callable[[dict[str, Any]], Awaitable[None]] | None = None,
) -> dict[str, Any]:
    duration_ms = _probe_audio_duration_ms(audio_path)
    windows = _build_chunk_windows(duration_ms)
    warnings: list[str] = []
    failed_chunks: list[dict[str, Any]] = []
    merged_segments: list[dict[str, Any]] = []
    completed_chunks = 0
    total_chunks = len(windows)

    async def emit(event: dict[str, Any]) -> None:
        if on_progress is None:
            return
        await on_progress(event)

    async def transcribe_with_language(target_path: Path) -> dict[str, Any]:
        try:
            return await state.asr_engine.transcribe(
                str(target_path),
                backend=asr_backend,
                language=language,
                speaker_labels=speaker_labels,
                enable_timestamps=enable_timestamps,
            )
        except TypeError as exc:
            if "language" not in str(exc) or "unexpected keyword" not in str(exc):
                raise
            return await state.asr_engine.transcribe(
                str(target_path),
                backend=asr_backend,
                speaker_labels=speaker_labels,
                enable_timestamps=enable_timestamps,
            )

    await emit({"type": "chunk_total", "total": total_chunks})
    orchestrator = getattr(state, "orchestrator", None)
    if orchestrator is not None and hasattr(orchestrator, "ensure_asr_ready"):
        await orchestrator.ensure_asr_ready(backend=asr_backend)

    work_dir = Path(tempfile.mkdtemp(prefix="asr_project_", dir=state.settings.output_dir))
    try:
        work_path = Path(work_dir)
        for chunk_index, (start_ms, end_ms) in enumerate(windows):
            chunk_path = work_path / f"chunk_{chunk_index:04d}.wav"
            try:
                await emit(
                    {
                        "type": "chunk_start",
                        "chunk": chunk_index + 1,
                        "total_chunks": total_chunks,
                        "start_ms": start_ms,
                        "end_ms": end_ms,
                    }
                )
                if duration_ms > 0:
                    await asyncio.to_thread(_extract_chunk, audio_path, chunk_path, start_ms, end_ms)
                    target_path = chunk_path
                else:
                    target_path = audio_path
                result = await transcribe_with_language(target_path)
                raw_alignments = result.get("alignments") if isinstance(result, dict) else []
                normalized: list[dict[str, Any]] = []
                if isinstance(raw_alignments, list):
                    for seg_index, seg in enumerate(raw_alignments):
                        if not isinstance(seg, dict):
                            continue
                        normalized_seg = _normalize_segment(
                            seg,
                            fallback_id=f"chunk-{chunk_index}-seg-{seg_index}",
                            offset_ms=start_ms,
                        )
                        if normalized_seg:
                            normalized.append(normalized_seg)
                normalized = _trim_overlap_duplicates(merged_segments, normalized)
                merged_segments.extend(normalized)
                completed_chunks += 1
                await emit(
                    {
                        "type": "chunk_progress",
                        "completed": completed_chunks,
                        "total_chunks": total_chunks,
                        "chunk": chunk_index + 1,
                        "status": "ok",
                    }
                )
                chunk_warnings = result.get("warnings") if isinstance(result, dict) else []
                if isinstance(chunk_warnings, list):
                    for item in chunk_warnings:
                        warning = str(item).strip()
                        if not warning:
                            continue
                        warnings.append(warning)
                        await emit({"type": "warning", "message": warning})
            except Exception as exc:
                failed = {
                    "index": chunk_index,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "error": str(exc),
                }
                failed_chunks.append(failed)
                warnings.append(f"分块 {chunk_index + 1} 转写失败，已跳过：{exc}")
                await emit(
                    {
                        "type": "chunk_failed",
                        "chunk": failed,
                        "completed": completed_chunks,
                        "total_chunks": total_chunks,
                    }
                )
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

    if not merged_segments:
        raise RuntimeError("全部分块转写失败，未创建项目。")

    effective_segments = _apply_speaker_map(merged_segments, speaker_map or {})
    text = _build_plain_text(effective_segments, "")
    labeled_text = _build_labeled_text(effective_segments, text)
    source_text = labeled_text if speaker_labels else text

    project = Project(name=_fallback_project_name(project_name, audio_name))
    project.script.source_text = source_text
    _update_asr_metadata(
        project,
        segment_count=len(effective_segments),
        failed_chunk_count=len(failed_chunks),
        warnings_count=len(warnings),
        speaker_labels=speaker_labels,
    )
    saved = save_project(state.settings.projects_dir, project)

    append_project_event(
        state.settings.projects_dir,
        saved.id,
        {
            "source": "project",
            "status": saved.status,
            "event": {
                "type": "asr_project_created",
                "message": f"已从音频创建项目，共 {len(effective_segments)} 段",
                "segment_count": len(effective_segments),
                "failed_chunk_count": len(failed_chunks),
            },
        },
    )
    await emit({"type": "project_created", "project_id": saved.id})
    for failed in failed_chunks:
        append_project_event(
            state.settings.projects_dir,
            saved.id,
            {
                "source": "project",
                "status": saved.status,
                "event": {
                    "type": "asr_chunk_failed",
                    "message": f"分块 {failed['index'] + 1} 失败",
                    "chunk": failed,
                },
            },
        )

    parse_task_id: str | None = None
    if auto_parse and callable(enqueue_parse_task):
        try:
            orchestrator = getattr(state, "orchestrator", None)
            if orchestrator is not None and hasattr(orchestrator, "unload_asr"):
                await orchestrator.unload_asr()
            else:
                await state.asr_engine.unload_model()
            await emit({"type": "asr_unloaded_before_parse", "message": "已在自动解析前卸载 ASR 模型"})
        except Exception as exc:
            warning = f"自动解析前卸载 ASR 失败：{exc}"
            warnings.append(warning)
            await emit({"type": "warning", "message": warning})
        parse_payload = LlmParseRequest(
            parse_mode=parse_mode,
            text=source_text,
            project_id=saved.id,
        )
        parse_task_id = enqueue_parse_task(state, parse_payload)
        append_project_event(
            state.settings.projects_dir,
            saved.id,
            {
                "source": "project",
                "status": saved.status,
                "task_id": parse_task_id,
                "event": {
                    "type": "asr_parse_queued",
                    "message": "ASR 转项目后已自动排队解析",
                },
            },
        )
        await emit({"type": "parse_queued", "parse_task_id": parse_task_id})

    status = "asr_done"
    if failed_chunks:
        status = "partial_failed"
    elif parse_task_id:
        status = "parse_queued"

    return {
        "project_id": saved.id,
        "status": status,
        "text": text,
        "labeled_text": labeled_text,
        "segments": effective_segments,
        "speaker_map": _to_speaker_identity_map(effective_segments),
        "warnings": warnings,
        "failed_chunks": failed_chunks,
        "parse_task_id": parse_task_id,
        "chunk_progress": {
            "completed": completed_chunks,
            "total": len(windows),
        },
    }


def parse_speaker_map_form(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("speaker_map 不是合法 JSON") from exc
    if not isinstance(parsed, dict):
        raise ValueError("speaker_map 必须是对象")
    normalized: dict[str, str] = {}
    for key, value in parsed.items():
        source = str(key or "").strip()
        if not source:
            continue
        target = str(value or "").strip() or source
        normalized[source] = target
    return normalized
