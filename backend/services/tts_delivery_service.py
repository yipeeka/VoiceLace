from __future__ import annotations

import json
from pathlib import Path
import wave

from backend.persistence import load_project, project_path, read_project_events


def should_log_stale_report(state) -> bool:
    config = getattr(state, "orchestrator", None)
    config = getattr(config, "config", None)
    return bool(getattr(config, "debug_stale_report", False))


def write_silence_wav(path: Path, duration_ms: int = 1000, sample_rate: int = 24000) -> None:
    frames = max(1, int(sample_rate * (duration_ms / 1000)))
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x00\x00" * frames)


def resolve_project_segment_audio_path(*, output_dir, projects_dir, project_id: str, segment_id: str, resolve_segment_asset_path):
    project = load_project(projects_dir, project_id)
    return resolve_segment_asset_path(output_dir=output_dir, project=project, segment_id=segment_id)


def load_project_segment_peaks_payload(
    *,
    output_dir,
    projects_dir,
    project_id: str,
    segment_id: str,
    resolve_segment_peaks_path,
):
    project = load_project(projects_dir, project_id)
    peaks_path = resolve_segment_peaks_path(output_dir=output_dir, project=project, segment_id=segment_id)
    if peaks_path is None or not peaks_path.exists():
        return None
    payload = json.loads(peaks_path.read_text(encoding="utf-8"))
    return {
        "project_id": project_id,
        "segment_id": segment_id,
        **payload,
    }


def load_project_waveform_payload(*, output_dir, projects_dir, project_id: str, level: int | None, build_project_waveform_response):
    project = load_project(projects_dir, project_id)
    return build_project_waveform_response(
        output_dir=output_dir,
        project_id=project_id,
        project=project,
        level=level,
    )


def resolve_export_audio_response_path(
    *,
    output_dir,
    projects_dir,
    project_id: str,
    req_format: str,
    resolve_export_audio_path,
):
    project = load_project(projects_dir, project_id)
    output, media_type = resolve_export_audio_path(
        output_dir=output_dir,
        project=project,
        req_format=req_format,
    )
    if output.exists():
        return output, media_type

    wav_fallback = output_dir / f"{project_id}.wav"
    if not wav_fallback.exists():
        write_silence_wav(wav_fallback, duration_ms=1000)
    return wav_fallback, "audio/wav"


def resolve_subtitle_response_path(*, output_dir, projects_dir, project_id: str, fmt: str, resolve_subtitle_path):
    project = load_project(projects_dir, project_id)
    return resolve_subtitle_path(
        output_dir=output_dir,
        project_id=project_id,
        project=project,
        fmt=fmt,
    )


def export_project_archive(
    *,
    output_dir,
    projects_dir,
    project_id: str,
    list_presets,
    write_project_archive,
):
    project = load_project(projects_dir, project_id)
    events = read_project_events(projects_dir, project_id, limit=0)
    archive_path = output_dir / f"{project_id}.archive.zip"
    project_json = project_path(projects_dir, project_id)
    manifest = write_project_archive(
        output_dir=output_dir,
        project=project,
        events=events,
        presets=list_presets(),
        project_json_path=project_json,
        archive_path=archive_path,
    )
    return archive_path, manifest, project
