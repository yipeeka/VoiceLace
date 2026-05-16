from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .tts_extended_export_service import build_all_extended_export_files


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
        "has_processed_audio": bool(project.audio_assets.processed.full_wav_relpath or project.audio_assets.processed.full_mp3_relpath),
        "processed_chapter_count": len(project.audio_assets.processed.chapters or []),
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
    processed_wav = _from_output_relpath(output_dir, project.audio_assets.processed.full_wav_relpath)
    processed_mp3 = _from_output_relpath(output_dir, project.audio_assets.processed.full_mp3_relpath)
    processed_manifest = _from_output_relpath(output_dir, project.audio_assets.processed.manifest_relpath)
    processed_peaks = _from_output_relpath(output_dir, project.audio_assets.processed.full_peaks_relpath)
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
    default_variant = "processed" if (
        project.audio_assets.processed.full_wav_relpath or project.audio_assets.processed.full_mp3_relpath
    ) else "raw"
    extended_exports = build_all_extended_export_files(output_dir=output_dir, project=project, variant=default_variant)
    archive_exports = [path for path in extended_exports if path.exists()]
    manifest["extended_export_files"] = [path.name for path in archive_exports]
    manifest["extended_export_variant"] = default_variant

    with zipfile.ZipFile(archive_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in audio_candidates:
            if path.exists():
                zf.write(path, arcname=f"audio/full/{path.name}")
        for path in subtitle_candidates:
            if path.exists():
                zf.write(path, arcname=f"subtitles/{path.name}")
        if full_peaks and full_peaks.exists():
            zf.write(full_peaks, arcname="waveforms/full.peaks.json")
        for path, arcname in [
            (processed_wav, "audio/processed/processed.wav"),
            (processed_mp3, "audio/processed/processed.mp3"),
            (processed_manifest, "audio/processed/processed.manifest.json"),
            (processed_peaks, "waveforms/processed.peaks.json"),
        ]:
            if path and path.exists():
                zf.write(path, arcname=arcname)

        processed_chapters = project.audio_assets.processed.chapters or []
        for chapter in processed_chapters:
            if isinstance(chapter, dict):
                chapter_id = chapter.get("id", "")
                wav_relpath = chapter.get("wav_relpath")
                mp3_relpath = chapter.get("mp3_relpath")
            else:
                chapter_id = getattr(chapter, "id", "")
                wav_relpath = getattr(chapter, "wav_relpath", None)
                mp3_relpath = getattr(chapter, "mp3_relpath", None)
            wav_path = _from_output_relpath(output_dir, wav_relpath)
            mp3_path = _from_output_relpath(output_dir, mp3_relpath)
            if wav_path and wav_path.exists():
                zf.write(wav_path, arcname=f"audio/processed/chapters/{chapter_id}.wav")
            if mp3_path and mp3_path.exists():
                zf.write(mp3_path, arcname=f"audio/processed/chapters/{chapter_id}.mp3")

        for asset in segment_assets:
            segment_path = _from_output_relpath(output_dir, asset.audio_relpath)
            if segment_path and segment_path.exists():
                zf.write(segment_path, arcname=f"audio/segments/{segment_path.name}")
            segment_peaks_path = _from_output_relpath(output_dir, asset.peaks_relpath)
            if segment_peaks_path and segment_peaks_path.exists():
                zf.write(segment_peaks_path, arcname=f"waveforms/segments/{asset.segment_id}.peaks.json")

        for export_file in archive_exports:
            zf.write(export_file, arcname=f"exports/{export_file.name}")

        if project_json_path.exists():
            zf.write(project_json_path, arcname="project/project.json")

        zf.writestr(
            "voices/presets.json",
            json.dumps([preset.model_dump(mode="json") for preset in used_presets], ensure_ascii=False, indent=2),
        )

        written_voice_audio: set[str] = set()
        for preset in used_presets:
            for audio_path_value in (preset.ref_audio_path, preset.sample_audio_path):
                if not audio_path_value:
                    continue
                audio_path = Path(audio_path_value)
                if not audio_path.exists() or not audio_path.is_file():
                    continue
                archive_name = f"voices/ref/{audio_path.name}"
                if archive_name in written_voice_audio:
                    continue
                zf.write(audio_path, arcname=archive_name)
                written_voice_audio.add(archive_name)

        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
    return manifest
