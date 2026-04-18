from __future__ import annotations

from backend.models import ReorderSegmentsRequest, Script, Segment, VoiceAssignmentsPayload
from backend.persistence import load_project, save_project

from .project_script_service import segment_content_payload, sync_script_metadata


def get_script(project_id: str, *, projects_dir):
    return load_project(projects_dir, project_id).script


def update_script(project_id: str, payload: Script, *, projects_dir):
    project = load_project(projects_dir, project_id)
    previous_segments = {segment.id: segment for segment in project.script.segments}
    next_script = sync_script_metadata(payload)
    next_segment_ids = {segment.id for segment in next_script.segments}

    for removed_id in list(project.audio_assets.segments.keys()):
        if removed_id not in next_segment_ids:
            project.audio_assets.segments.pop(removed_id, None)

    for segment in next_script.segments:
        previous = previous_segments.get(segment.id)
        if previous is None:
            continue
        if segment_content_payload(previous) != segment_content_payload(segment):
            project.audio_assets.segments.pop(segment.id, None)

    project.script = next_script
    project.status = "parsed" if payload.segments else "draft"
    return save_project(projects_dir, project).script


def update_segment(project_id: str, segment_id: str, payload: Segment, *, projects_dir):
    project = load_project(projects_dir, project_id)
    updated_segments: list[Segment] = []
    changed = False
    for segment in project.script.segments:
        if segment.id != segment_id:
            updated_segments.append(segment)
            continue
        changed = segment_content_payload(segment) != segment_content_payload(payload)
        updated_segments.append(payload)
    project.script.segments = updated_segments
    if changed:
        project.audio_assets.segments.pop(segment_id, None)
    project.script = sync_script_metadata(project.script)
    save_project(projects_dir, project)
    return payload


def add_segment(project_id: str, payload: Segment, *, projects_dir):
    project = load_project(projects_dir, project_id)
    project.script.segments.append(payload)
    project.script = sync_script_metadata(project.script)
    save_project(projects_dir, project)
    return payload


def delete_segment(project_id: str, segment_id: str, *, projects_dir):
    project = load_project(projects_dir, project_id)
    project.script.segments = [segment for segment in project.script.segments if segment.id != segment_id]
    project.audio_assets.segments.pop(segment_id, None)
    project.script = sync_script_metadata(project.script)
    save_project(projects_dir, project)
    return {"status": "deleted"}


def reorder_script(project_id: str, payload: ReorderSegmentsRequest, *, projects_dir):
    project = load_project(projects_dir, project_id)
    by_id = {segment.id: segment for segment in project.script.segments}
    project.script.segments = [
        by_id[segment_id].model_copy(update={"index": idx})
        for idx, segment_id in enumerate(payload.segment_ids)
        if segment_id in by_id
    ]
    project.script = sync_script_metadata(project.script)
    save_project(projects_dir, project)
    return project.script


def update_voice_assignments(project_id: str, payload: VoiceAssignmentsPayload, *, projects_dir):
    project = load_project(projects_dir, project_id)
    project.voice_assignments = payload.assignments
    if payload.assignments:
        project.status = "voices_configured"
    elif project.script.segments:
        project.status = "parsed"
    save_project(projects_dir, project)
    return {"assignments": project.voice_assignments, "status": project.status}
