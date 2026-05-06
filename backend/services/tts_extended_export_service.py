from __future__ import annotations

import csv
import json
from io import StringIO
from pathlib import Path
from typing import Any


def _normalized_variant(variant: str | None) -> str:
    value = (variant or "raw").strip().lower()
    return "processed" if value == "processed" else "raw"


def _to_output_path(output_dir: Path, relpath: str | None) -> Path | None:
    if not relpath:
        return None
    return output_dir / relpath


def _project_exports_dir(*, output_dir: Path, project_id: str, variant: str) -> Path:
    return output_dir / "projects" / project_id / "exports" / _normalized_variant(variant)


def _segments_in_order(project) -> list:
    segments = list(project.script.segments or [])
    return sorted(segments, key=lambda item: int(getattr(item, "index", 0) or 0))


def _chapter_ranges_from_markers(project, markers: list[dict[str, str]]) -> list[dict[str, Any]]:
    ordered_segments = _segments_in_order(project)
    if not ordered_segments:
        return []
    index_by_segment = {segment.id: idx for idx, segment in enumerate(ordered_segments)}
    starts: list[tuple[int, dict[str, str]]] = []
    for marker in markers:
        marker_id = str(marker.get("id") or "").strip()
        start_segment_id = str(marker.get("start_segment_id") or "").strip()
        if not marker_id or start_segment_id not in index_by_segment:
            continue
        starts.append((index_by_segment[start_segment_id], marker))
    starts.sort(key=lambda item: item[0])
    if not starts:
        first = ordered_segments[0]
        starts = [(0, {"id": "chapter-1", "title": "章节 1", "start_segment_id": first.id})]

    ranges: list[dict[str, Any]] = []
    for idx, (start_idx, marker) in enumerate(starts):
        next_start = starts[idx + 1][0] if idx + 1 < len(starts) else len(ordered_segments)
        end_idx = max(start_idx, next_start - 1)
        ranges.append(
            {
                "id": str(marker.get("id") or f"chapter-{idx + 1}"),
                "title": str(marker.get("title") or f"章节 {idx + 1}"),
                "start_segment_id": ordered_segments[start_idx].id,
                "end_segment_id": ordered_segments[end_idx].id,
            }
        )
    return ranges


def _build_chapter_ranges(project) -> list[dict[str, Any]]:
    processed_chapters = project.audio_assets.processed.chapters or []
    ranges: list[dict[str, Any]] = []
    for item in processed_chapters:
        if isinstance(item, dict):
            entry = {
                "id": str(item.get("id") or ""),
                "title": str(item.get("title") or ""),
                "start_segment_id": str(item.get("start_segment_id") or ""),
                "end_segment_id": str(item.get("end_segment_id") or ""),
                "start_ms": int(item.get("start_ms") or 0),
                "end_ms": int(item.get("end_ms") or 0),
                "duration_ms": int(item.get("duration_ms") or 0),
                "wav_relpath": item.get("wav_relpath"),
                "mp3_relpath": item.get("mp3_relpath"),
            }
        else:
            entry = {
                "id": str(getattr(item, "id", "") or ""),
                "title": str(getattr(item, "title", "") or ""),
                "start_segment_id": str(getattr(item, "start_segment_id", "") or ""),
                "end_segment_id": str(getattr(item, "end_segment_id", "") or ""),
                "start_ms": int(getattr(item, "start_ms", 0) or 0),
                "end_ms": int(getattr(item, "end_ms", 0) or 0),
                "duration_ms": int(getattr(item, "duration_ms", 0) or 0),
                "wav_relpath": getattr(item, "wav_relpath", None),
                "mp3_relpath": getattr(item, "mp3_relpath", None),
            }
        if entry["id"] and entry["start_segment_id"]:
            ranges.append(entry)

    if ranges:
        return ranges

    config_markers = []
    for marker in project.synthesis_config.chapter_markers or []:
        config_markers.append(
            {
                "id": str(getattr(marker, "id", "") or ""),
                "title": str(getattr(marker, "title", "") or ""),
                "start_segment_id": str(getattr(marker, "start_segment_id", "") or ""),
            }
        )
    return _chapter_ranges_from_markers(project, config_markers)


def _build_chapter_lookup(project) -> dict[str, dict[str, str]]:
    ordered_segments = _segments_in_order(project)
    if not ordered_segments:
        return {}
    index_by_segment = {segment.id: idx for idx, segment in enumerate(ordered_segments)}
    lookup: dict[str, dict[str, str]] = {}
    ranges = _build_chapter_ranges(project)
    for idx, chapter in enumerate(ranges):
        start_segment_id = str(chapter.get("start_segment_id") or "")
        end_segment_id = str(chapter.get("end_segment_id") or "")
        if start_segment_id not in index_by_segment:
            continue
        start_idx = index_by_segment[start_segment_id]
        if end_segment_id and end_segment_id in index_by_segment:
            end_idx = index_by_segment[end_segment_id]
        else:
            next_starts = []
            for later in ranges[idx + 1:]:
                later_start = str(later.get("start_segment_id") or "")
                if later_start in index_by_segment:
                    next_starts.append(index_by_segment[later_start])
            end_idx = (min(next_starts) - 1) if next_starts else (len(ordered_segments) - 1)
        end_idx = max(start_idx, end_idx)
        chapter_id = str(chapter.get("id") or f"chapter-{idx + 1}")
        chapter_title = str(chapter.get("title") or f"章节 {idx + 1}")
        for seg_idx in range(start_idx, end_idx + 1):
            segment_id = ordered_segments[seg_idx].id
            lookup[segment_id] = {"chapter_id": chapter_id, "chapter_title": chapter_title}
    return lookup


def _build_timeline_rows(project) -> list[dict[str, Any]]:
    ordered_segments = _segments_in_order(project)
    failed_ids = {
        str(item.segment_id)
        for item in (project.audio_assets.failed_segments or [])
        if getattr(item, "segment_id", None)
    }
    chapter_lookup = _build_chapter_lookup(project)
    gap_ms = max(0, int(getattr(project.synthesis_config, "gap_duration_ms", 300) or 300))
    cursor = 0
    rows: list[dict[str, Any]] = []
    for idx, segment in enumerate(ordered_segments):
        asset = project.audio_assets.segments.get(segment.id)
        duration_ms = int(getattr(asset, "duration_ms", 0) or 0) if asset else 0
        start_ms = cursor
        end_ms = start_ms + max(0, duration_ms)
        chapter = chapter_lookup.get(segment.id, {})
        status = "missing"
        if segment.id in failed_ids:
            status = "failed"
        elif asset:
            raw_status = str(getattr(asset, "status", "") or "").strip().lower()
            if raw_status in {"stale", "missing"}:
                status = raw_status
            else:
                status = "done"
        rows.append(
            {
                "index": int(getattr(segment, "index", idx) or idx),
                "segment_id": segment.id,
                "chapter_id": str(chapter.get("chapter_id") or ""),
                "chapter_title": str(chapter.get("chapter_title") or ""),
                "speaker": str(getattr(segment, "speaker", "narrator") or "narrator"),
                "type": str(getattr(segment, "type", "narration") or "narration"),
                "emotion": str(getattr(segment, "emotion", "neutral") or "neutral"),
                "text": str(getattr(segment, "text", "") or ""),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": max(0, duration_ms),
                "audio_relpath": str(getattr(asset, "audio_relpath", "") or "") if asset else "",
                "status": status,
            }
        )
        cursor = end_ms
        if idx < len(ordered_segments) - 1:
            cursor += gap_ms
    return rows


def _format_hhmmss_mmm(ms: int) -> str:
    total_ms = max(0, int(ms))
    hh = total_ms // 3_600_000
    mm = (total_ms % 3_600_000) // 60_000
    ss = (total_ms % 60_000) // 1_000
    mmm = total_ms % 1_000
    return f"{hh:02d}:{mm:02d}:{ss:02d}.{mmm:03d}"


def _build_script_rows(project) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for idx, segment in enumerate(_segments_in_order(project)):
        rows.append(
            {
                "index": int(getattr(segment, "index", idx) or idx),
                "segment_id": segment.id,
                "speaker": str(getattr(segment, "speaker", "narrator") or "narrator"),
                "type": str(getattr(segment, "type", "narration") or "narration"),
                "emotion": str(getattr(segment, "emotion", "neutral") or "neutral"),
                "text": str(getattr(segment, "text", "") or ""),
            }
        )
    return rows


def _build_chapter_rows(project) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for idx, chapter in enumerate(_build_chapter_ranges(project)):
        start_ms = int(chapter.get("start_ms") or 0)
        end_ms = int(chapter.get("end_ms") or 0)
        duration_ms = int(chapter.get("duration_ms") or max(0, end_ms - start_ms))
        rows.append(
            {
                "index": idx,
                "chapter_id": str(chapter.get("id") or f"chapter-{idx + 1}"),
                "title": str(chapter.get("title") or f"章节 {idx + 1}"),
                "start_segment_id": str(chapter.get("start_segment_id") or ""),
                "end_segment_id": str(chapter.get("end_segment_id") or ""),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_ms": duration_ms,
                "wav_relpath": str(chapter.get("wav_relpath") or ""),
                "mp3_relpath": str(chapter.get("mp3_relpath") or ""),
            }
        )
    return rows


def _rows_to_csv_bytes(rows: list[dict[str, Any]], fieldnames: list[str]) -> bytes:
    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return buffer.getvalue().encode("utf-8-sig")


def _json_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def _format_ffmetadata_value(value: str) -> str:
    return (
        str(value or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace("#", "\\#")
        .replace("=", "\\=")
        .replace("\n", "\\n")
    )


def _build_metadata_payload(project, profile: str, variant: str, timeline_rows: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_profile = (profile or "podcast").strip().lower()
    ordered = _segments_in_order(project)
    speakers = sorted({str(getattr(item, "speaker", "") or "").strip() for item in ordered if getattr(item, "speaker", None)})
    total_duration_ms = 0
    if timeline_rows:
        total_duration_ms = int(timeline_rows[-1].get("end_ms") or 0)
    chapters = _build_chapter_rows(project)
    base = {
        "profile": "audible" if normalized_profile == "audible" else "podcast",
        "project_id": project.id,
        "project_name": project.name,
        "title": project.script.title or project.name,
        "variant": _normalized_variant(variant),
        "segment_count": len(ordered),
        "duration_ms": total_duration_ms,
        "duration_hhmmss_mmm": _format_hhmmss_mmm(total_duration_ms),
        "narrators": speakers,
        "chapters": chapters,
    }
    script_meta = getattr(project.script, "metadata", {}) or {}
    for key in ["author", "album", "series", "genre", "language", "copyright", "publisher", "description"]:
        value = script_meta.get(key)
        if value not in {None, ""}:
            base[key] = value
    return base


def _build_ffmetadata_text(project, variant: str, timeline_rows: list[dict[str, Any]]) -> str:
    payload = _build_metadata_payload(project, "podcast", variant, timeline_rows)
    lines = [
        ";FFMETADATA1",
        f"title={_format_ffmetadata_value(str(payload.get('title') or project.name))}",
    ]
    if payload.get("author"):
        lines.append(f"artist={_format_ffmetadata_value(str(payload['author']))}")
    if payload.get("album"):
        lines.append(f"album={_format_ffmetadata_value(str(payload['album']))}")
    comment_value = f"project_id={project.id};variant={payload.get('variant')}"
    lines.append(f"comment={_format_ffmetadata_value(comment_value)}")
    for chapter in payload.get("chapters", []):
        start_ms = int(chapter.get("start_ms") or 0)
        end_ms = int(chapter.get("end_ms") or start_ms)
        if end_ms <= start_ms:
            end_ms = start_ms + 1
        lines.extend(
            [
                "[CHAPTER]",
                "TIMEBASE=1/1000",
                f"START={start_ms}",
                f"END={end_ms}",
                f"title={_format_ffmetadata_value(str(chapter.get('title') or chapter.get('chapter_id') or 'Chapter'))}",
            ]
        )
    return "\n".join(lines) + "\n"


def _build_capcut_rows(timeline_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in timeline_rows:
        rows.append(
            {
                "index": row["index"],
                "segment_id": row["segment_id"],
                "start_ms": row["start_ms"],
                "end_ms": row["end_ms"],
                "start_time": _format_hhmmss_mmm(int(row["start_ms"])),
                "end_time": _format_hhmmss_mmm(int(row["end_ms"])),
                "speaker": row["speaker"],
                "type": row["type"],
                "emotion": row["emotion"],
                "text": row["text"],
                "status": row["status"],
            }
        )
    return rows


def _build_premiere_marker_rows(timeline_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in timeline_rows:
        name = f"#{int(row['index']) + 1} {row['speaker']}".strip()
        desc = row["text"]
        rows.append(
            {
                "Marker Name": name,
                "Description": desc,
                "In": _format_hhmmss_mmm(int(row["start_ms"])),
                "Out": _format_hhmmss_mmm(int(row["end_ms"])),
                "Duration": _format_hhmmss_mmm(int(row["duration_ms"])),
                "Marker Type": "Comment",
                "Speaker": row["speaker"],
                "Segment ID": row["segment_id"],
            }
        )
    return rows


def build_extended_export_bytes(
    *,
    project,
    kind: str,
    fmt: str,
    variant: str = "raw",
    profile: str = "podcast",
) -> tuple[bytes, str, str]:
    normalized_kind = (kind or "").strip().lower()
    normalized_fmt = (fmt or "").strip().lower() or "json"
    normalized_variant = _normalized_variant(variant)
    timeline_rows = _build_timeline_rows(project)

    if normalized_kind == "script":
        payload = {"project_id": project.id, "project_name": project.name, "items": _build_script_rows(project)}
        if normalized_fmt == "csv":
            rows = payload["items"]
            fieldnames = ["index", "segment_id", "speaker", "type", "emotion", "text"]
            return _rows_to_csv_bytes(rows, fieldnames), "text/csv; charset=utf-8", "script.csv"
        return _json_bytes(payload), "application/json; charset=utf-8", "script.json"

    if normalized_kind in {"timestamps", "timestamp_manifest"}:
        payload = {
            "project_id": project.id,
            "project_name": project.name,
            "variant": normalized_variant,
            "items": timeline_rows,
        }
        if normalized_fmt == "csv":
            fieldnames = [
                "index",
                "segment_id",
                "chapter_id",
                "chapter_title",
                "speaker",
                "type",
                "emotion",
                "text",
                "start_ms",
                "end_ms",
                "duration_ms",
                "audio_relpath",
                "status",
            ]
            return _rows_to_csv_bytes(payload["items"], fieldnames), "text/csv; charset=utf-8", "timestamp_manifest.csv"
        return _json_bytes(payload), "application/json; charset=utf-8", "timestamp_manifest.json"

    if normalized_kind == "chapters":
        rows = _build_chapter_rows(project)
        payload = {
            "project_id": project.id,
            "project_name": project.name,
            "variant": normalized_variant,
            "items": rows,
        }
        if normalized_fmt == "csv":
            fieldnames = [
                "index",
                "chapter_id",
                "title",
                "start_segment_id",
                "end_segment_id",
                "start_ms",
                "end_ms",
                "duration_ms",
                "wav_relpath",
                "mp3_relpath",
            ]
            return _rows_to_csv_bytes(rows, fieldnames), "text/csv; charset=utf-8", "chapters.csv"
        return _json_bytes(payload), "application/json; charset=utf-8", "chapters.json"

    if normalized_kind == "metadata":
        payload = _build_metadata_payload(project, profile, normalized_variant, timeline_rows)
        suffix = "audible_metadata.json" if payload.get("profile") == "audible" else "podcast_metadata.json"
        return _json_bytes(payload), "application/json; charset=utf-8", suffix

    if normalized_kind == "ffmetadata":
        text = _build_ffmetadata_text(project, normalized_variant, timeline_rows)
        return text.encode("utf-8"), "text/plain; charset=utf-8", "metadata.ffmetadata"

    if normalized_kind == "capcut":
        rows = _build_capcut_rows(timeline_rows)
        fieldnames = [
            "index",
            "segment_id",
            "start_ms",
            "end_ms",
            "start_time",
            "end_time",
            "speaker",
            "type",
            "emotion",
            "text",
            "status",
        ]
        return _rows_to_csv_bytes(rows, fieldnames), "text/csv; charset=utf-8", "capcut.csv"

    if normalized_kind in {"premiere", "premiere_markers"}:
        rows = _build_premiere_marker_rows(timeline_rows)
        fieldnames = ["Marker Name", "Description", "In", "Out", "Duration", "Marker Type", "Speaker", "Segment ID"]
        return _rows_to_csv_bytes(rows, fieldnames), "text/csv; charset=utf-8", "premiere_markers.csv"

    raise ValueError(f"Unsupported export kind: {kind}")


def write_extended_export_file(
    *,
    output_dir: Path,
    project,
    kind: str,
    fmt: str,
    variant: str = "raw",
    profile: str = "podcast",
) -> tuple[Path, str]:
    payload, media_type, filename = build_extended_export_bytes(
        project=project,
        kind=kind,
        fmt=fmt,
        variant=variant,
        profile=profile,
    )
    export_dir = _project_exports_dir(output_dir=output_dir, project_id=project.id, variant=variant)
    export_dir.mkdir(parents=True, exist_ok=True)
    output_path = export_dir / filename
    output_path.write_bytes(payload)
    return output_path, media_type


def build_all_extended_export_files(*, output_dir: Path, project, variant: str = "raw") -> list[Path]:
    targets = [
        ("script", "json", "podcast"),
        ("script", "csv", "podcast"),
        ("timestamp_manifest", "json", "podcast"),
        ("timestamp_manifest", "csv", "podcast"),
        ("chapters", "json", "podcast"),
        ("chapters", "csv", "podcast"),
        ("metadata", "json", "podcast"),
        ("metadata", "json", "audible"),
        ("ffmetadata", "txt", "podcast"),
        ("capcut", "csv", "podcast"),
        ("premiere_markers", "csv", "podcast"),
    ]
    output_paths: list[Path] = []
    for kind, fmt, profile in targets:
        path, _ = write_extended_export_file(
            output_dir=output_dir,
            project=project,
            kind=kind,
            fmt=fmt,
            variant=variant,
            profile=profile,
        )
        output_paths.append(path)
    return output_paths
