from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _normalized_variant(variant: str | None) -> str:
    value = (variant or "raw").strip().lower()
    return "processed" if value == "processed" else "raw"


def _from_output_relpath(output_dir: Path, relpath: str | None) -> Path | None:
    if not relpath:
        return None
    return output_dir / relpath


def _wizard_export_dir(*, output_dir: Path, project_id: str, variant: str) -> Path:
    normalized_variant = _normalized_variant(variant)
    return output_dir / "projects" / project_id / "exports" / normalized_variant / "wizard"


def _resolve_full_audio_paths(*, output_dir: Path, project, variant: str) -> dict[str, Path | None]:
    normalized_variant = _normalized_variant(variant)
    if normalized_variant == "processed":
        wav = _from_output_relpath(output_dir, project.audio_assets.processed.full_wav_relpath)
        mp3 = _from_output_relpath(output_dir, project.audio_assets.processed.full_mp3_relpath)
    else:
        wav = _from_output_relpath(output_dir, project.audio_assets.full_wav_relpath)
        mp3 = _from_output_relpath(output_dir, project.audio_assets.full_mp3_relpath)
    return {"wav": wav, "mp3": mp3}


def _append_if_exists(
    *,
    zf: zipfile.ZipFile,
    source: Path | None,
    arcname: str,
    label: str,
    included: list[dict[str, str]],
    missing: list[dict[str, str]],
) -> None:
    if source and source.exists():
        zf.write(source, arcname=arcname)
        included.append({"label": label, "path": arcname})
        return
    missing.append({"label": label, "reason": "missing"})


def build_wizard_export_bundle(
    *,
    output_dir: Path,
    project,
    preset: str,
    variant: str,
    write_extended_export_file,
) -> tuple[Path, dict[str, Any]]:
    normalized_preset = (preset or "").strip().lower()
    if normalized_preset not in {"audiobook", "editing", "data"}:
        raise ValueError("Unsupported wizard preset")

    normalized_variant = _normalized_variant(variant)
    export_dir = _wizard_export_dir(output_dir=output_dir, project_id=project.id, variant=normalized_variant)
    export_dir.mkdir(parents=True, exist_ok=True)
    bundle_path = export_dir / f"{project.id}.{normalized_preset}.{normalized_variant}.zip"

    included: list[dict[str, str]] = []
    missing: list[dict[str, str]] = []
    audio = _resolve_full_audio_paths(output_dir=output_dir, project=project, variant=normalized_variant)
    subtitle_srt = _from_output_relpath(output_dir, project.audio_assets.subtitle_srt_relpath)
    subtitle_lrc = _from_output_relpath(output_dir, project.audio_assets.subtitle_lrc_relpath)

    with zipfile.ZipFile(bundle_path, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        if normalized_preset == "audiobook":
            _append_if_exists(
                zf=zf,
                source=audio["mp3"],
                arcname="audio/full.mp3",
                label="完整音频 MP3",
                included=included,
                missing=missing,
            )
            _append_if_exists(
                zf=zf,
                source=audio["wav"],
                arcname="audio/full.wav",
                label="完整音频 WAV",
                included=included,
                missing=missing,
            )
            _append_if_exists(
                zf=zf,
                source=subtitle_srt,
                arcname="subtitles/full.srt",
                label="字幕 SRT",
                included=included,
                missing=missing,
            )
            chapters = project.audio_assets.processed.chapters or []
            for chapter in chapters:
                chapter_id = chapter.get("id") if isinstance(chapter, dict) else getattr(chapter, "id", "")
                wav_relpath = chapter.get("wav_relpath") if isinstance(chapter, dict) else getattr(chapter, "wav_relpath", None)
                mp3_relpath = chapter.get("mp3_relpath") if isinstance(chapter, dict) else getattr(chapter, "mp3_relpath", None)
                chapter_wav = _from_output_relpath(output_dir, wav_relpath)
                chapter_mp3 = _from_output_relpath(output_dir, mp3_relpath)
                _append_if_exists(
                    zf=zf,
                    source=chapter_wav,
                    arcname=f"chapters/{chapter_id}.wav",
                    label=f"章节 {chapter_id} WAV",
                    included=included,
                    missing=missing,
                )
                _append_if_exists(
                    zf=zf,
                    source=chapter_mp3,
                    arcname=f"chapters/{chapter_id}.mp3",
                    label=f"章节 {chapter_id} MP3",
                    included=included,
                    missing=missing,
                )
            for kind, fmt, profile, arcname, label in [
                ("chapters", "json", "podcast", "data/chapters.json", "章节清单 JSON"),
                ("metadata", "json", "podcast", "metadata/podcast_metadata.json", "播客元数据"),
                ("metadata", "json", "audible", "metadata/audible_metadata.json", "Audible 元数据"),
                ("ffmetadata", "txt", "podcast", "metadata/metadata.ffmetadata", "FFMetadata"),
            ]:
                source, _ = write_extended_export_file(
                    output_dir=output_dir,
                    project=project,
                    kind=kind,
                    fmt=fmt,
                    variant=normalized_variant,
                    profile=profile,
                )
                _append_if_exists(zf=zf, source=source, arcname=arcname, label=label, included=included, missing=missing)

        if normalized_preset == "editing":
            _append_if_exists(
                zf=zf,
                source=audio["wav"],
                arcname="audio/full.wav",
                label="完整音频 WAV",
                included=included,
                missing=missing,
            )
            _append_if_exists(
                zf=zf,
                source=subtitle_srt,
                arcname="subtitles/full.srt",
                label="字幕 SRT",
                included=included,
                missing=missing,
            )
            _append_if_exists(
                zf=zf,
                source=subtitle_lrc,
                arcname="subtitles/full.lrc",
                label="字幕 LRC",
                included=included,
                missing=missing,
            )
            for kind, fmt, profile, arcname, label in [
                ("capcut", "csv", "podcast", "editing/capcut.csv", "剪映 CSV"),
                ("premiere_markers", "csv", "podcast", "editing/premiere_markers.csv", "PR 标记 CSV"),
                ("timestamp_manifest", "json", "podcast", "data/timestamp_manifest.json", "时间戳 JSON"),
                ("timestamp_manifest", "csv", "podcast", "data/timestamp_manifest.csv", "时间戳 CSV"),
            ]:
                source, _ = write_extended_export_file(
                    output_dir=output_dir,
                    project=project,
                    kind=kind,
                    fmt=fmt,
                    variant=normalized_variant,
                    profile=profile,
                )
                _append_if_exists(zf=zf, source=source, arcname=arcname, label=label, included=included, missing=missing)

        if normalized_preset == "data":
            for kind, fmt, profile, arcname, label in [
                ("script", "json", "podcast", "data/script.json", "剧本 JSON"),
                ("script", "csv", "podcast", "data/script.csv", "剧本 CSV"),
                ("timestamp_manifest", "json", "podcast", "data/timestamp_manifest.json", "时间戳 JSON"),
                ("timestamp_manifest", "csv", "podcast", "data/timestamp_manifest.csv", "时间戳 CSV"),
                ("chapters", "json", "podcast", "data/chapters.json", "章节清单 JSON"),
                ("chapters", "csv", "podcast", "data/chapters.csv", "章节清单 CSV"),
                ("metadata", "json", "podcast", "metadata/podcast_metadata.json", "播客元数据"),
                ("metadata", "json", "audible", "metadata/audible_metadata.json", "Audible 元数据"),
            ]:
                source, _ = write_extended_export_file(
                    output_dir=output_dir,
                    project=project,
                    kind=kind,
                    fmt=fmt,
                    variant=normalized_variant,
                    profile=profile,
                )
                _append_if_exists(zf=zf, source=source, arcname=arcname, label=label, included=included, missing=missing)

        manifest = {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "project_id": project.id,
            "project_name": project.name,
            "preset": normalized_preset,
            "variant": normalized_variant,
            "included_count": len(included),
            "missing_count": len(missing),
            "included_files": included,
            "missing_files": missing,
        }
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    if not included:
        raise ValueError("当前预设没有可导出的文件")
    return bundle_path, manifest
