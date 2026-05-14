from __future__ import annotations

from pathlib import Path


def project_output_root(*, output_dir: Path, project_id: str) -> Path:
    return output_dir / "projects" / project_id


def project_segments_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "segments"


def project_full_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "full"


def project_subtitles_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "subtitles"


def project_waveforms_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "waveforms"


def project_processed_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "processed"


def project_processed_chapters_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_processed_dir(output_dir=output_dir, project_id=project_id) / "chapters"


def project_postprocess_assets_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "postprocess_assets"


def project_source_audio_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_output_root(output_dir=output_dir, project_id=project_id) / "source_audio"


def project_segment_waveforms_dir(*, output_dir: Path, project_id: str) -> Path:
    return project_waveforms_dir(output_dir=output_dir, project_id=project_id) / "segments"


def to_output_relpath(*, output_dir: Path, path: Path) -> str:
    return path.resolve().relative_to(output_dir.resolve()).as_posix()
