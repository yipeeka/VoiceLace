from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _from_output_relpath(output_dir: Path, relpath: str | None) -> Path | None:
    if not relpath:
        return None
    return output_dir / relpath


def _find_latest_tts_task_id(events: list[dict[str, Any]]) -> str | None:
    for item in reversed(events):
        if item.get("source") != "tts":
            continue
        event = item.get("event") or {}
        if event.get("type") == "complete" and item.get("task_id"):
            return str(item["task_id"])
    return None


def build_archive_manifest(
    *,
    project,
    latest_tts_task_id: str | None,
    audio_candidates: list[Path],
    subtitle_candidates: list[Path],
    full_peaks_path: Path | None,
    segment_count: int,
    used_presets: list,
) -> dict[str, Any]:
    return {
        "schema_version": 3,
        "project_id": project.id,
        "project_name": project.name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "latest_tts_task_id": latest_tts_task_id,
        "audio_files": [p.name for p in audio_candidates if p.exists()],
        "subtitle_files": [p.name for p in subtitle_candidates if p.exists()],
        "segment_count": segment_count,
        "waveform_files": [p.name for p in [full_peaks_path] if p and p.exists()],
        "preset_count": len(used_presets),
        "has_reference_audio": any(bool(p.ref_audio_path) for p in used_presets),
    }


def write_project_archive(
    *,
    output_dir: Path,
    project,
    events: list[dict[str, Any]],
    presets: list,
    project_json_path: Path,
    archive_path: Path,
) -> dict[str, Any]:
    latest_task_id = _find_latest_tts_task_id(events)
    full_wav = _from_output_relpath(output_dir, project.audio_assets.full_wav_relpath)
    full_mp3 = _from_output_relpath(output_dir, project.audio_assets.full_mp3_relpath)
    subtitle_srt = _from_output_relpath(output_dir, project.audio_assets.subtitle_srt_relpath)
    subtitle_lrc = _from_output_relpath(output_dir, project.audio_assets.subtitle_lrc_relpath)
    full_peaks = _from_output_relpath(output_dir, project.audio_assets.full_peaks_relpath)
    segment_assets = list(project.audio_assets.segments.values())

    audio_candidates = [path for path in [full_wav, full_mp3] if path and path.exists()]
    subtitle_candidates = [path for path in [subtitle_srt, subtitle_lrc] if path and path.exists()]

    used_preset_ids = {preset_id for preset_id in project.voice_assignments.values() if preset_id}
    used_presets = [preset for preset in presets if preset.id in used_preset_ids]

    manifest = build_archive_manifest(
        project=project,
        latest_tts_task_id=latest_task_id,
        audio_candidates=audio_candidates,
        subtitle_candidates=subtitle_candidates,
        full_peaks_path=full_peaks,
        segment_count=len(segment_assets),
        used_presets=used_presets,
    )

    with zipfile.ZipFile(archive_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in audio_candidates:
            if path.exists():
                zf.write(path, arcname=f"audio/full/{path.name}")
        for path in subtitle_candidates:
            if path.exists():
                zf.write(path, arcname=f"subtitles/{path.name}")
        if full_peaks and full_peaks.exists():
            zf.write(full_peaks, arcname="waveforms/full.peaks.json")

        for asset in segment_assets:
            segment_path = _from_output_relpath(output_dir, asset.audio_relpath)
            if segment_path and segment_path.exists():
                zf.write(segment_path, arcname=f"audio/segments/{segment_path.name}")
            segment_peaks_path = _from_output_relpath(output_dir, asset.peaks_relpath)
            if segment_peaks_path and segment_peaks_path.exists():
                zf.write(segment_peaks_path, arcname=f"waveforms/segments/{asset.segment_id}.peaks.json")

        if project_json_path.exists():
            zf.write(project_json_path, arcname="project/project.json")

        zf.writestr(
            "voices/presets.json",
            json.dumps([preset.model_dump(mode="json") for preset in used_presets], ensure_ascii=False, indent=2),
        )

        for preset in used_presets:
            if not preset.ref_audio_path:
                continue
            ref_path = Path(preset.ref_audio_path)
            if ref_path.exists() and ref_path.is_file():
                zf.write(ref_path, arcname=f"voices/ref/{ref_path.name}")

        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest
