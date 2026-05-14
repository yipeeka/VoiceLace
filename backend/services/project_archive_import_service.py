from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
from typing import Any
from uuid import uuid4
import zipfile

from backend.models import Project, ProjectOrigin, SegmentAsset, VoicePreset
from backend.persistence import save_project
from .project_script_service import sync_script_metadata
from .tts_path_service import to_output_relpath


def _first_existing_path(candidates: list[Path]) -> Path | None:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def _load_archive_manifest(extract_dir: Path) -> tuple[int, dict]:
    manifest_path = extract_dir / "manifest.json"
    if not manifest_path.exists():
        return 1, {}
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return 1, {}
        schema_version = int(payload.get("schema_version") or 1)
        return schema_version, payload
    except Exception:
        return 1, {}


def _compute_file_hash(path: Path) -> str | None:
    try:
        hasher = hashlib.sha256()
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                hasher.update(chunk)
        return hasher.hexdigest()
    except Exception:
        return None


def _normalize_match_text(value: str | None) -> str:
    return (value or "").strip()


def _resolve_archive_ref_audio_path(ref_dir: Path, preset: VoicePreset) -> Path | None:
    if not preset.ref_audio_path:
        return None
    candidate = ref_dir / Path(preset.ref_audio_path).name
    if candidate.exists() and candidate.is_file():
        return candidate
    return None


def _normalize_preset_for_match(preset: VoicePreset, ref_audio_hash: str | None) -> dict[str, Any]:
    return {
        "voice_mode": preset.voice_mode,
        "gender": _normalize_match_text(preset.gender),
        "age": _normalize_match_text(preset.age),
        "pitch": _normalize_match_text(preset.pitch),
        "style": _normalize_match_text(preset.style),
        "accent": _normalize_match_text(preset.accent),
        "dialect": _normalize_match_text(preset.dialect),
        "custom_instruct": _normalize_match_text(preset.custom_instruct),
        "description": _normalize_match_text(preset.description),
        "speed": float(preset.speed),
        "ref_text": _normalize_match_text(preset.ref_text),
        "ref_audio_hash": ref_audio_hash or "",
    }


def _build_preset_fingerprint(preset: VoicePreset, ref_audio_hash: str | None) -> str:
    normalized = _normalize_preset_for_match(preset, ref_audio_hash)
    payload = json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _build_weak_keys(preset: VoicePreset, ref_audio_hash: str | None) -> tuple[tuple[str, str, str, str], tuple[str, str]]:
    name = _normalize_match_text(preset.name).lower()
    mode = _normalize_match_text(preset.voice_mode).lower()
    gender = _normalize_match_text(preset.gender).lower()
    return (
        (name, mode, gender, ref_audio_hash or ""),
        (name, mode),
    )


def _make_unique_preset_name(base_name: str, used_names: set[str]) -> str:
    name = base_name
    if name not in used_names:
        return name
    while True:
        suffix = uuid4().hex[:6]
        candidate = f"{base_name} (Imported-{suffix})"
        if candidate not in used_names:
            return candidate


def import_project_archive_bytes(raw_bytes: bytes, *, settings, voice_manager) -> dict[str, Any]:
    warnings: list[str] = []
    with tempfile.TemporaryDirectory(prefix="bvt_import_") as tmp_dir:
        tmp_root = Path(tmp_dir)
        archive_path = tmp_root / "archive.zip"
        archive_path.write_bytes(raw_bytes)
        extract_dir = tmp_root / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)

        try:
            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(extract_dir)
        except zipfile.BadZipFile as exc:
            raise ValueError(f"Invalid archive: {exc}") from exc

        schema_version, _manifest = _load_archive_manifest(extract_dir)
        project_json = _first_existing_path(
            [
                extract_dir / "project" / "project.json",
                extract_dir / "project.json",
            ]
        )
        if project_json is None or not project_json.exists():
            raise ValueError("Archive missing project metadata (project/project.json or project.json)")
        if schema_version < 2:
            warnings.append("Detected legacy archive layout (v1), import with compatibility mode.")

        try:
            raw_project = json.loads(project_json.read_text(encoding="utf-8"))
            imported_project = Project.model_validate(raw_project)
        except Exception as exc:
            raise ValueError(f"Invalid project payload: {exc}") from exc

        old_project_id = imported_project.id
        imported_project.id = str(uuid4())
        imported_project.created_at = datetime.now(timezone.utc)
        imported_project.updated_at = datetime.now(timezone.utc)
        imported_project.project_origin = ProjectOrigin(
            kind="archive_import",
            source_project_id=old_project_id,
        )
        imported_project.script = sync_script_metadata(imported_project.script)

        existing_presets = voice_manager.list_presets()
        existing_preset_ids = {preset.id for preset in existing_presets}
        existing_preset_names = {preset.name for preset in existing_presets}
        local_preset_by_id = {preset.id: preset for preset in existing_presets}

        local_ref_audio_hash: dict[str, str] = {}
        ref_audio_index: dict[str, str] = {}
        local_preset_fingerprints: dict[str, list[str]] = {}
        local_weak_full: dict[tuple[str, str, str, str], list[str]] = {}
        local_weak_simple: dict[tuple[str, str], list[str]] = {}

        for preset in existing_presets:
            ref_hash = None
            if preset.ref_audio_path:
                ref_path = Path(preset.ref_audio_path)
                if ref_path.exists() and ref_path.is_file():
                    ref_hash = _compute_file_hash(ref_path)
                    if ref_hash:
                        local_ref_audio_hash[preset.id] = ref_hash
                        ref_audio_index.setdefault(ref_hash, str(ref_path))
            fingerprint = _build_preset_fingerprint(preset, ref_hash)
            local_preset_fingerprints.setdefault(fingerprint, []).append(preset.id)
            weak_full, weak_simple = _build_weak_keys(preset, ref_hash)
            local_weak_full.setdefault(weak_full, []).append(preset.id)
            local_weak_simple.setdefault(weak_simple, []).append(preset.id)

        preset_id_map: dict[str, str] = {}
        new_presets: list[VoicePreset] = []
        reused_presets = 0
        created_presets = 0
        reused_ref_audios = 0
        copied_ref_audios = 0
        processed_presets = 0

        presets_json = extract_dir / "voices" / "presets.json"
        if presets_json.exists():
            try:
                preset_items = json.loads(presets_json.read_text(encoding="utf-8"))
                if not isinstance(preset_items, list):
                    raise ValueError("presets.json should be a list")
            except Exception as exc:
                warnings.append(f"Skip presets.json due to parse error: {exc}")
                preset_items = []

            used_preset_ids = set(imported_project.voice_assignments.values())
            ref_dir = extract_dir / "voices" / "ref"
            for item in preset_items:
                try:
                    preset = VoicePreset.model_validate(item)
                except Exception as exc:
                    warnings.append(f"Skip invalid preset entry: {exc}")
                    continue
                if preset.id not in used_preset_ids:
                    continue
                processed_presets += 1

                archive_ref = _resolve_archive_ref_audio_path(ref_dir, preset)
                archive_ref_hash = _compute_file_hash(archive_ref) if archive_ref else None
                pending_copy_ref = archive_ref
                ref_audio_path = None
                if archive_ref:
                    if archive_ref_hash and archive_ref_hash in ref_audio_index:
                        ref_audio_path = ref_audio_index[archive_ref_hash]
                        pending_copy_ref = None
                        reused_ref_audios += 1
                elif preset.ref_audio_path:
                    warnings.append(f"Reference audio not found for preset {preset.name}")

                if archive_ref_hash:
                    resolved_ref_hash = archive_ref_hash
                elif ref_audio_path:
                    resolved_ref_hash = _compute_file_hash(Path(ref_audio_path))
                else:
                    resolved_ref_hash = None

                local_id: str | None = None
                same_id = local_preset_by_id.get(preset.id)
                if same_id:
                    same_id_hash = local_ref_audio_hash.get(same_id.id)
                    if _normalize_preset_for_match(same_id, same_id_hash) == _normalize_preset_for_match(preset, resolved_ref_hash):
                        local_id = same_id.id

                if local_id is None:
                    fingerprint = _build_preset_fingerprint(preset, resolved_ref_hash)
                    matched_ids = local_preset_fingerprints.get(fingerprint, [])
                    if matched_ids:
                        local_id = matched_ids[0]

                if local_id is None:
                    weak_full, weak_simple = _build_weak_keys(preset, resolved_ref_hash)
                    matched_ids = local_weak_full.get(weak_full, [])
                    if not matched_ids:
                        matched_ids = local_weak_simple.get(weak_simple, [])
                    if matched_ids:
                        local_id = matched_ids[0]
                        warnings.append(f"已复用本地近似匹配预设：{preset.name}（同名/同模式）")

                if local_id is None:
                    if ref_audio_path is None and pending_copy_ref is not None:
                        target_name = f"import_{uuid4().hex[:8]}_{pending_copy_ref.name}"
                        target_path = settings.voices_dir / target_name
                        shutil.copyfile(pending_copy_ref, target_path)
                        ref_audio_path = str(target_path)
                        copied_ref_audios += 1
                        if resolved_ref_hash:
                            ref_audio_index.setdefault(resolved_ref_hash, ref_audio_path)
                    new_id = preset.id if preset.id not in existing_preset_ids else str(uuid4())
                    new_name = _make_unique_preset_name(preset.name, existing_preset_names)
                    created = preset.model_copy(
                        update={
                            "id": new_id,
                            "name": new_name,
                            "ref_audio_path": ref_audio_path,
                        }
                    )
                    existing_presets.append(created)
                    new_presets.append(created)
                    local_preset_by_id[new_id] = created
                    existing_preset_ids.add(new_id)
                    existing_preset_names.add(new_name)
                    if resolved_ref_hash:
                        local_ref_audio_hash[new_id] = resolved_ref_hash
                        if ref_audio_path:
                            ref_audio_index.setdefault(resolved_ref_hash, ref_audio_path)
                    fingerprint = _build_preset_fingerprint(created, resolved_ref_hash)
                    local_preset_fingerprints.setdefault(fingerprint, []).append(new_id)
                    weak_full, weak_simple = _build_weak_keys(created, resolved_ref_hash)
                    local_weak_full.setdefault(weak_full, []).append(new_id)
                    local_weak_simple.setdefault(weak_simple, []).append(new_id)
                    local_id = new_id
                    created_presets += 1
                else:
                    reused_presets += 1

                preset_id_map[preset.id] = local_id
        else:
            warnings.append("Archive has no voices/presets.json, skipped preset snapshot import.")

        if new_presets:
            voice_manager.save_presets(existing_presets)

        imported_project.voice_assignments = {
            character: preset_id_map.get(preset_id, preset_id)
            for character, preset_id in imported_project.voice_assignments.items()
        }

        project_root = settings.output_dir / "projects" / imported_project.id
        full_dir = project_root / "full"
        seg_dir = project_root / "segments"
        sub_dir = project_root / "subtitles"
        waveform_dir = project_root / "waveforms"
        waveform_seg_dir = waveform_dir / "segments"
        full_dir.mkdir(parents=True, exist_ok=True)
        seg_dir.mkdir(parents=True, exist_ok=True)
        sub_dir.mkdir(parents=True, exist_ok=True)
        waveform_dir.mkdir(parents=True, exist_ok=True)
        waveform_seg_dir.mkdir(parents=True, exist_ok=True)

        imported_project.audio_assets.latest_task_id = None
        imported_project.audio_assets.segments = {}
        imported_project.audio_assets.full_wav_relpath = None
        imported_project.audio_assets.full_mp3_relpath = None
        imported_project.audio_assets.source_audio_mp3_relpath = None
        imported_project.audio_assets.source_audio_name = None
        imported_project.audio_assets.source_audio_start_ms = None
        imported_project.audio_assets.source_audio_end_ms = None
        imported_project.audio_assets.source_audio_duration_ms = None
        imported_project.audio_assets.subtitle_srt_relpath = None
        imported_project.audio_assets.subtitle_lrc_relpath = None
        imported_project.audio_assets.full_peaks_relpath = None
        imported_project.audio_assets.full_peaks_version = 1
        imported_project.audio_assets.full_peaks_levels = []
        imported_project.audio_assets.archive_schema_version = 3

        arc_full_dir = _first_existing_path(
            [
                extract_dir / "audio" / "full",
                extract_dir / "audio",
            ]
        )
        if arc_full_dir:
            full_wav_src = _first_existing_path(
                [
                    arc_full_dir / "mix.wav",
                    arc_full_dir / f"{old_project_id}.wav",
                ]
            )
            if full_wav_src:
                dst = full_dir / "mix.wav"
                shutil.copyfile(full_wav_src, dst)
                imported_project.audio_assets.full_wav_relpath = to_output_relpath(output_dir=settings.output_dir, path=dst)

            full_mp3_src = _first_existing_path(
                [
                    arc_full_dir / "mix.mp3",
                    arc_full_dir / f"{old_project_id}.mp3",
                ]
            )
            if full_mp3_src:
                dst = full_dir / "mix.mp3"
                shutil.copyfile(full_mp3_src, dst)
                imported_project.audio_assets.full_mp3_relpath = to_output_relpath(output_dir=settings.output_dir, path=dst)

        arc_sub_dir = _first_existing_path(
            [
                extract_dir / "subtitles",
                extract_dir,
            ]
        )
        for src_name, attr in (("book.srt", "subtitle_srt_relpath"), ("book.lrc", "subtitle_lrc_relpath")):
            src = _first_existing_path(
                [
                    arc_sub_dir / src_name,
                    arc_sub_dir / f"{old_project_id}.{src_name.split('.')[-1]}",
                ]
            ) if arc_sub_dir else None
            if src is not None and src.exists():
                dst = sub_dir / src_name
                shutil.copyfile(src, dst)
                setattr(imported_project.audio_assets, attr, to_output_relpath(output_dir=settings.output_dir, path=dst))

        arc_waveform_dir = _first_existing_path(
            [
                extract_dir / "waveforms",
            ]
        )
        if arc_waveform_dir:
            full_peaks_src = arc_waveform_dir / "full.peaks.json"
            if full_peaks_src.exists() and full_peaks_src.is_file():
                dst = waveform_dir / "full.peaks.json"
                shutil.copyfile(full_peaks_src, dst)
                imported_project.audio_assets.full_peaks_relpath = to_output_relpath(output_dir=settings.output_dir, path=dst)
                try:
                    payload = json.loads(dst.read_text(encoding="utf-8"))
                    levels = payload.get("levels", {}) or {}
                    imported_project.audio_assets.full_peaks_version = int(payload.get("version", 1))
                    imported_project.audio_assets.full_peaks_levels = sorted(int(key) for key in levels.keys())
                except Exception:
                    imported_project.audio_assets.full_peaks_version = 1
                    imported_project.audio_assets.full_peaks_levels = []

        arc_seg_dir = _first_existing_path(
            [
                extract_dir / "audio" / "segments",
                extract_dir / "segments",
            ]
        )
        if arc_seg_dir:
            for src in sorted(arc_seg_dir.glob("*.wav")):
                dst = seg_dir / src.name
                shutil.copyfile(src, dst)
        else:
            warnings.append("Archive has no segment audio folder, related segments may require regeneration.")

        arc_waveform_seg_dir = _first_existing_path(
            [
                extract_dir / "waveforms" / "segments",
            ]
        )
        if arc_waveform_seg_dir:
            for src in sorted(arc_waveform_seg_dir.glob("*.peaks.json")):
                dst = waveform_seg_dir / src.name
                shutil.copyfile(src, dst)

        for segment in imported_project.script.segments:
            seg_file = seg_dir / f"{segment.id}.wav"
            if not seg_file.exists():
                continue
            seg_peaks = waveform_seg_dir / f"{segment.id}.peaks.json"
            peaks_relpath = None
            peaks_bins = 0
            peaks_version = 1
            peaks_format = "minmax_i16"
            if seg_peaks.exists():
                peaks_relpath = to_output_relpath(output_dir=settings.output_dir, path=seg_peaks)
                try:
                    peaks_payload = json.loads(seg_peaks.read_text(encoding="utf-8"))
                    peaks_bins = int(peaks_payload.get("bins", 0))
                    peaks_version = int(peaks_payload.get("version", 1))
                    peaks_format = str(peaks_payload.get("format", "minmax_i16"))
                except Exception:
                    peaks_bins = 0
                    peaks_version = 1
                    peaks_format = "minmax_i16"
            imported_project.audio_assets.segments[segment.id] = SegmentAsset(
                segment_id=segment.id,
                audio_relpath=to_output_relpath(output_dir=settings.output_dir, path=seg_file),
                duration_ms=0,
                fingerprint="",
                source_task_id=None,
                created_at=datetime.now(timezone.utc).isoformat(),
                status="ready",
                peaks_relpath=peaks_relpath,
                peaks_version=peaks_version,
                peaks_bins=peaks_bins,
                peaks_format=peaks_format,
                audio_sha256=_compute_file_hash(seg_file) or "",
            )

        saved = save_project(settings.projects_dir, imported_project)
        return {
            "project_id": saved.id,
            "project_name": saved.name,
            "from_project_id": old_project_id,
            "import_source": "archive_import",
            "imported_presets": len(new_presets),
            "processed_presets": processed_presets,
            "reused_presets": reused_presets,
            "created_presets": created_presets,
            "reused_ref_audios": reused_ref_audios,
            "copied_ref_audios": copied_ref_audios,
            "imported_segments": len(saved.audio_assets.segments),
            "has_full_audio": bool(saved.audio_assets.full_wav_relpath or saved.audio_assets.full_mp3_relpath),
            "warnings": warnings,
        }
