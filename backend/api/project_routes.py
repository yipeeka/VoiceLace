from __future__ import annotations

from collections import Counter
import shutil

from fastapi import APIRouter, Depends, HTTPException

from backend.models import Character, CreateProjectRequest, Project, ProjectSummary, ReorderSegmentsRequest, Script, Segment, VoiceAssignmentsPayload
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
    project.script = _sync_script_metadata(payload)
    project.status = "parsed" if payload.segments else "draft"
    return save_project(state.settings.projects_dir, project).script


@router.put("/{project_id}/script/segments/{segment_id}")
async def update_segment(project_id: str, segment_id: str, payload: Segment, state=Depends(get_app_state)):
    project = load_project(state.settings.projects_dir, project_id)
    updated_segments = [payload if segment.id == segment_id else segment for segment in project.script.segments]
    project.script.segments = updated_segments
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
