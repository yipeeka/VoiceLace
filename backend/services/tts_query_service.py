from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _from_output_relpath(output_dir: Path, relpath: str | None) -> Path | None:
    if not relpath:
        return None
    return output_dir / relpath


def resolve_export_audio_path(*, output_dir: Path, project, req_format: str) -> tuple[Path, str]:
    normalized = (req_format or "wav").lower()
    output = None
    if normalized == "mp3":
        output = _from_output_relpath(output_dir, project.audio_assets.full_mp3_relpath)
    if output is None:
        output = _from_output_relpath(output_dir, project.audio_assets.full_wav_relpath)
    if output is None:
        output = output_dir / f"{project.id}.{normalized}"
    media_type = "audio/mpeg" if normalized == "mp3" else "audio/wav"
    return output, media_type


def resolve_subtitle_path(*, output_dir: Path, project_id: str, project, fmt: str) -> Path:
    normalized = (fmt or "srt").lower()
    relpath = project.audio_assets.subtitle_srt_relpath if normalized == "srt" else project.audio_assets.subtitle_lrc_relpath
    path = _from_output_relpath(output_dir, relpath)
    if path is None:
        path = output_dir / f"{project_id}.{normalized}"
    return path


def build_project_waveform_response(*, output_dir: Path, project_id: str, project, level: int | None) -> dict[str, Any]:
    peaks_path = _from_output_relpath(output_dir, project.audio_assets.full_peaks_relpath)
    if peaks_path is None or not peaks_path.exists():
        raise FileNotFoundError("Project full waveform peaks not found")

    payload = json.loads(peaks_path.read_text(encoding="utf-8"))
    levels = payload.get("levels", {}) or {}

    requested_level = int(level) if level else int(payload.get("bins", 0) or 0)
    if requested_level <= 0:
        requested_level = int(next(iter(levels.keys()), "0") or 0)
    data = levels.get(str(requested_level))
    if data is None and levels:
        first_key = next(iter(levels.keys()))
        requested_level = int(first_key)
        data = levels[first_key]

    return {
        "project_id": project_id,
        "version": int(payload.get("version", 1)),
        "format": str(payload.get("format", "minmax_i16")),
        "duration_ms": int(payload.get("duration_ms", 0)),
        "sample_rate": int(payload.get("sample_rate", 0)),
        "channels": int(payload.get("channels", 1)),
        "level": requested_level,
        "data": data or [],
        "levels": sorted(int(k) for k in levels.keys()),
    }
