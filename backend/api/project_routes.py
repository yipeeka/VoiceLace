from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import tempfile
from uuid import uuid4
import zipfile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from backend.models import (
    Character,
    CreateProjectRequest,
    Project,
    ProjectSummary,
    ReorderSegmentsRequest,
    Script,
    Segment,
    SegmentAsset,
    VoiceAssignmentsPayload,
    VoicePreset,
)
from backend.persistence import load_project, project_event_log_path, project_path, read_project_events, save_project
from backend.state import get_app_state

router = APIRouter()


def _sync_script_metadata(script: Script) -> Script:
    speakers = [segment.speaker for segment in script.segments if segment.speaker]
    counts = Counter(speakers)
    script.characters = [
        Character(name=name, appearance_count=count, description=f"{name} 的角色档案")
        for name, count in counts.items()
    ]
    script.segments = [
        segment.model_copy(update={"index": index})
        for index, segment in enumerate(script.segments)
    ]
    return script


def _segment_content_payload(segment: Segment) -> dict:
    return {
        "speaker": segment.speaker or "",
        "text": segment.text or "",
        "type": segment.type or "",
        "emotion": segment.emotion or "",
        "non_verbal": segment.non_verbal or [],
        "tts_overrides": segment.tts_overrides or {},
    }


def _to_output_relpath(state, path: Path) -> str:
    return path.resolve().relative_to(state.settings.output_dir.resolve()).as_posix()


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


@router.get("")
async def list_projects(state=Depends(get_app_state)):
    projects = []
    for file in sorted(state.settings.projects_dir.glob("*.json")):
        project = load_project(state.settings.projects_dir, file.stem)
        projects.append(ProjectSummary.from_project(project))
    return projects


@router.post("")
async def create_project(payload: CreateProjectRequest, state=Depends(get_app_state)):
    project = Project(name=payload.name)
    return save_project(state.settings.projects_dir, project)


@router.post("/import/archive")
async def import_project_archive(file: UploadFile = File(...), state=Depends(get_app_state)):
    warnings: list[str] = []
    with tempfile.TemporaryDirectory(prefix="bvt_import_") as tmp_dir:
        tmp_root = Path(tmp_dir)
        archive_path = tmp_root / "archive.zip"
        archive_path.write_bytes(await file.read())
        extract_dir = tmp_root / "extract"
        extract_dir.mkdir(parents=True, exist_ok=True)

        try:
            with zipfile.ZipFile(archive_path, "r") as zf:
                zf.extractall(extract_dir)
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail=f"Invalid archive: {exc}") from exc

        schema_version, _manifest = _load_archive_manifest(extract_dir)
        project_json = _first_existing_path(
            [
                extract_dir / "project" / "project.json",
                extract_dir / "project.json",
            ]
        )
        if project_json is None or not project_json.exists():
            raise HTTPException(status_code=400, detail="Archive missing project metadata (project/project.json or project.json)")
        if schema_version < 2:
            warnings.append("Detected legacy archive layout (v1), import with compatibility mode.")

        try:
            raw_project = json.loads(project_json.read_text(encoding="utf-8"))
            imported_project = Project.model_validate(raw_project)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid project payload: {exc}") from exc

        old_project_id = imported_project.id
        imported_project.id = str(uuid4())
        imported_project.name = f"{imported_project.name} (Imported)"
        imported_project.created_at = datetime.now(timezone.utc)
        imported_project.updated_at = datetime.now(timezone.utc)
        imported_project.script = _sync_script_metadata(imported_project.script)

        existing_presets = state.voice_manager.list_presets()
        existing_preset_ids = {preset.id for preset in existing_presets}
        existing_preset_names = {preset.name for preset in existing_presets}
        preset_id_map: dict[str, str] = {}
        imported_presets: list[VoicePreset] = []

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
                old_id = preset.id
                new_id = old_id
                if new_id in existing_preset_ids or new_id in preset_id_map.values():
                    new_id = str(uuid4())

                new_name = preset.name
                if new_name in existing_preset_names:
                    suffix = uuid4().hex[:6]
                    new_name = f"{new_name} (Imported-{suffix})"

                ref_audio_path = None
                if preset.ref_audio_path:
                    candidate = ref_dir / Path(preset.ref_audio_path).name
                    if candidate.exists() and candidate.is_file():
                        target_name = f"import_{uuid4().hex[:8]}_{candidate.name}"
                        target_path = state.settings.voices_dir / target_name
                        shutil.copyfile(candidate, target_path)
                        ref_audio_path = str(target_path)
                    else:
                        warnings.append(f"Reference audio not found for preset {preset.name}")

                imported = preset.model_copy(
                    update={
                        "id": new_id,
                        "name": new_name,
                        "ref_audio_path": ref_audio_path,
                    }
                )
                preset_id_map[old_id] = new_id
                imported_presets.append(imported)
                existing_preset_ids.add(new_id)
                existing_preset_names.add(new_name)
        else:
            warnings.append("Archive has no voices/presets.json, skipped preset snapshot import.")

        if imported_presets:
            state.voice_manager.save_presets(existing_presets + imported_presets)

        imported_project.voice_assignments = {
            character: preset_id_map.get(preset_id, preset_id)
            for character, preset_id in imported_project.voice_assignments.items()
        }

        project_root = state.settings.output_dir / "projects" / imported_project.id
        full_dir = project_root / "full"
        seg_dir = project_root / "segments"
        sub_dir = project_root / "subtitles"
        full_dir.mkdir(parents=True, exist_ok=True)
        seg_dir.mkdir(parents=True, exist_ok=True)
        sub_dir.mkdir(parents=True, exist_ok=True)

        imported_project.audio_assets.latest_task_id = None
        imported_project.audio_assets.segments = {}
        imported_project.audio_assets.full_wav_relpath = None
        imported_project.audio_assets.full_mp3_relpath = None
        imported_project.audio_assets.subtitle_srt_relpath = None
        imported_project.audio_assets.subtitle_lrc_relpath = None
        imported_project.audio_assets.archive_schema_version = 2

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
                imported_project.audio_assets.full_wav_relpath = _to_output_relpath(state, dst)

            full_mp3_src = _first_existing_path(
                [
                    arc_full_dir / "mix.mp3",
                    arc_full_dir / f"{old_project_id}.mp3",
                ]
            )
            if full_mp3_src:
                dst = full_dir / "mix.mp3"
                shutil.copyfile(full_mp3_src, dst)
                imported_project.audio_assets.full_mp3_relpath = _to_output_relpath(state, dst)

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
                setattr(imported_project.audio_assets, attr, _to_output_relpath(state, dst))

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

        for segment in imported_project.script.segments:
            seg_file = seg_dir / f"{segment.id}.wav"
            if not seg_file.exists():
                continue
            imported_project.audio_assets.segments[segment.id] = SegmentAsset(
                segment_id=segment.id,
                audio_relpath=_to_output_relpath(state, seg_file),
                duration_ms=0,
                fingerprint="",
                source_task_id=None,
                created_at=datetime.now(timezone.utc).isoformat(),
                status="ready",
            )

        saved = save_project(state.settings.projects_dir, imported_project)
        return {
            "project_id": saved.id,
            "project_name": saved.name,
            "from_project_id": old_project_id,
            "imported_presets": len(imported_presets),
            "imported_segments": len(saved.audio_assets.segments),
            "has_full_audio": bool(saved.audio_assets.full_wav_relpath or saved.audio_assets.full_mp3_relpath),
            "warnings": warnings,
        }


@router.get("/{project_id}")
async def get_project(project_id: str, state=Depends(get_app_state)):
    return load_project(state.settings.projects_dir, project_id)


@router.put("/{project_id}")
async def update_project(project_id: str, payload: Project, state=Depends(get_app_state)):
    project = payload.model_copy(update={"id": project_id})
    return save_project(state.settings.projects_dir, project)


@router.delete("/{project_id}")
async def delete_project(project_id: str, state=Depends(get_app_state)):
    _ = load_project(state.settings.projects_dir, project_id)
    events = read_project_events(state.settings.projects_dir, project_id, limit=0)
    task_ids = {event.get("task_id") for event in events if event.get("task_id")}

    path = project_path(state.settings.projects_dir, project_id)
    if path.exists():
        path.unlink()
    log_path = project_event_log_path(state.settings.projects_dir, project_id)
    if log_path.exists():
        log_path.unlink()

    for ext in ("wav", "mp3", "srt", "lrc"):
        export_file = state.settings.output_dir / f"{project_id}.{ext}"
        if export_file.exists():
            export_file.unlink()
    archive_file = state.settings.output_dir / f"{project_id}.archive.zip"
    if archive_file.exists():
        archive_file.unlink()
    project_output_dir = state.settings.output_dir / "projects" / project_id
    if project_output_dir.exists() and project_output_dir.is_dir():
        shutil.rmtree(project_output_dir, ignore_errors=True)

    for task_id in task_ids:
        task_dir = state.settings.output_dir / str(task_id)
        if task_dir.exists() and task_dir.is_dir():
            shutil.rmtree(task_dir, ignore_errors=True)
    return {"status": "deleted"}


@router.get("/{project_id}/script")
async def get_script(project_id: str, state=Depends(get_app_state)):
    return load_project(state.settings.projects_dir, project_id).script


@router.put("/{project_id}/script")
async def update_script(project_id: str, payload: Script, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    previous_segments = {segment.id: segment for segment in project.script.segments}
    next_script = _sync_script_metadata(payload)
    next_segment_ids = {segment.id for segment in next_script.segments}

    # Remove assets for deleted segments.
    for removed_id in list(project.audio_assets.segments.keys()):
        if removed_id not in next_segment_ids:
            project.audio_assets.segments.pop(removed_id, None)

    # Invalidate assets for content-changed segments so stale-report can mark them reliably,
    # including legacy assets imported without source snapshot metadata.
    for segment in next_script.segments:
        previous = previous_segments.get(segment.id)
        if previous is None:
            continue
        if _segment_content_payload(previous) != _segment_content_payload(segment):
            project.audio_assets.segments.pop(segment.id, None)

    project.script = next_script
    project.status = "parsed" if payload.segments else "draft"
    return save_project(state.settings.projects_dir, project).script


@router.put("/{project_id}/script/segments/{segment_id}")
async def update_segment(project_id: str, segment_id: str, payload: Segment, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    updated_segments: list[Segment] = []
    changed = False
    for segment in project.script.segments:
        if segment.id != segment_id:
            updated_segments.append(segment)
            continue
        changed = _segment_content_payload(segment) != _segment_content_payload(payload)
        updated_segments.append(payload)
    project.script.segments = updated_segments
    if changed:
        project.audio_assets.segments.pop(segment_id, None)
    project.script = _sync_script_metadata(project.script)
    save_project(state.settings.projects_dir, project)
    return payload


@router.post("/{project_id}/script/segments")
async def add_segment(project_id: str, payload: Segment, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    project.script.segments.append(payload)
    project.script = _sync_script_metadata(project.script)
    save_project(state.settings.projects_dir, project)
    return payload


@router.delete("/{project_id}/script/segments/{segment_id}")
async def delete_segment(project_id: str, segment_id: str, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    project.script.segments = [segment for segment in project.script.segments if segment.id != segment_id]
    project.audio_assets.segments.pop(segment_id, None)
    project.script = _sync_script_metadata(project.script)
    save_project(state.settings.projects_dir, project)
    return {"status": "deleted"}


@router.post("/{project_id}/script/reorder")
async def reorder_script(project_id: str, payload: ReorderSegmentsRequest, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    by_id = {segment.id: segment for segment in project.script.segments}
    project.script.segments = [
        by_id[segment_id].model_copy(update={"index": idx})
        for idx, segment_id in enumerate(payload.segment_ids)
        if segment_id in by_id
    ]
    project.script = _sync_script_metadata(project.script)
    save_project(state.settings.projects_dir, project)
    return project.script


@router.put("/{project_id}/voice-assignments")
async def update_voice_assignments(project_id: str, payload: VoiceAssignmentsPayload, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    project.voice_assignments = payload.assignments
    if payload.assignments:
        project.status = "voices_configured"
    elif project.script.segments:
        project.status = "parsed"
    save_project(state.settings.projects_dir, project)
    return {"assignments": project.voice_assignments, "status": project.status}


@router.get("/{project_id}/events")
async def get_project_events(project_id: str, limit: int = 500, state=Depends(get_app_state)):
    _ = load_project(state.settings.projects_dir, project_id)
    return read_project_events(state.settings.projects_dir, project_id, limit=limit)
