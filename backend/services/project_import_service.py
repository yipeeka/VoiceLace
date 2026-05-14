from __future__ import annotations

from pathlib import Path

from backend.models import Project
from backend.persistence import load_project


def reset_imported_audio_assets(project: Project) -> None:
    project.audio_assets = project.audio_assets.model_copy(
        update={
            "latest_task_id": None,
            "full_wav_relpath": None,
            "full_mp3_relpath": None,
            "source_audio_mp3_relpath": None,
            "source_audio_name": None,
            "source_audio_start_ms": None,
            "source_audio_end_ms": None,
            "source_audio_duration_ms": None,
            "subtitle_srt_relpath": None,
            "subtitle_lrc_relpath": None,
            "segments": {},
            "full_peaks_relpath": None,
            "full_peaks_version": 1,
            "full_peaks_levels": [],
            "archive_schema_version": 3,
        }
    )


def find_project_file_match(
    projects_dir: Path,
    *,
    fingerprint: str,
    source_project_id: str | None,
) -> tuple[Project | None, str]:
    id_match: Project | None = None
    fingerprint_match: Project | None = None
    source_match: Project | None = None
    for file in sorted(projects_dir.glob("*.json")):
        project = load_project(projects_dir, file.stem)
        if source_project_id and project.id == source_project_id:
            id_match = project
            break
        if project.project_origin.kind != "project_file":
            continue
        if project.project_origin.project_file_fingerprint == fingerprint:
            fingerprint_match = project
            break
        if source_project_id and project.project_origin.source_project_id == source_project_id and source_match is None:
            source_match = project
    if id_match is not None:
        return id_match, "source_project_id"
    if fingerprint_match is not None:
        return fingerprint_match, "fingerprint"
    if source_match is not None:
        return source_match, "source_project_id"
    return None, "none"
