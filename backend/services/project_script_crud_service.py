from __future__ import annotations

from backend.models import ReorderSegmentsRequest, Script, Segment, VoiceAssignmentsPayload
from backend.persistence import append_project_event, load_project, save_project

from .project_script_service import segment_content_payload, sync_script_metadata
from .project_snapshot_service import create_project_snapshot


def get_script(project_id: str, *, projects_dir):
    return load_project(projects_dir, project_id).script


def update_script(project_id: str, payload: Script, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_script_save")
    previous_segments = {segment.id: segment for segment in project.script.segments}
    previous_ids = [segment.id for segment in project.script.segments]
    next_script = sync_script_metadata(payload)
    next_ids = [segment.id for segment in next_script.segments]
    next_segment_ids = {segment.id for segment in next_script.segments}
    full_rebuild_required = previous_ids != next_ids

    for removed_id in list(project.audio_assets.segments.keys()):
        if removed_id not in next_segment_ids:
            project.audio_assets.segments.pop(removed_id, None)
            full_rebuild_required = True

    for segment in next_script.segments:
        previous = previous_segments.get(segment.id)
        if previous is None:
            full_rebuild_required = True
            continue
        if segment_content_payload(previous) != segment_content_payload(segment):
            project.audio_assets.segments.pop(segment.id, None)
            full_rebuild_required = True

    project.script = next_script
    if full_rebuild_required:
        project.audio_assets.full_rebuild_required = True
    project.status = "parsed" if payload.segments else "draft"
    saved = save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        project.id,
        {
            "source": "project",
            "status": project.status,
            "event": {
                "type": "script_saved",
                "message": f"剧本已保存，共 {len(saved.script.segments)} 段",
            },
        },
    )
    return saved.script


def update_segment(project_id: str, segment_id: str, payload: Segment, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_segment_update")
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
        project.audio_assets.full_rebuild_required = True
    project.script = sync_script_metadata(project.script)
    save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        project.id,
        {
            "source": "project",
            "status": project.status,
            "event": {
                "type": "script_segment_updated",
                "message": f"片段 {segment_id} 已保存",
            },
        },
    )
    return payload


def add_segment(project_id: str, payload: Segment, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_segment_add")
    project.script.segments.append(payload)
    project.script = sync_script_metadata(project.script)
    project.audio_assets.full_rebuild_required = True
    save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        project.id,
        {
            "source": "project",
            "status": project.status,
            "event": {
                "type": "script_segment_added",
                "message": f"片段 {payload.id} 已新增",
            },
        },
    )
    return payload


def delete_segment(project_id: str, segment_id: str, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_segment_delete")
    project.script.segments = [segment for segment in project.script.segments if segment.id != segment_id]
    project.audio_assets.segments.pop(segment_id, None)
    project.audio_assets.full_rebuild_required = True
    project.script = sync_script_metadata(project.script)
    save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        project.id,
        {
            "source": "project",
            "status": project.status,
            "event": {
                "type": "script_segment_deleted",
                "message": f"片段 {segment_id} 已删除",
            },
        },
    )
    return {"status": "deleted"}


def reorder_script(project_id: str, payload: ReorderSegmentsRequest, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_script_reorder")
    previous_ids = [segment.id for segment in project.script.segments]
    by_id = {segment.id: segment for segment in project.script.segments}
    project.script.segments = [
        by_id[segment_id].model_copy(update={"index": idx})
        for idx, segment_id in enumerate(payload.segment_ids)
        if segment_id in by_id
    ]
    if previous_ids != [segment.id for segment in project.script.segments]:
        project.audio_assets.full_rebuild_required = True
    project.script = sync_script_metadata(project.script)
    save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        project.id,
        {
            "source": "project",
            "status": project.status,
            "event": {
                "type": "script_reordered",
                "message": f"片段顺序已更新，共 {len(project.script.segments)} 段",
            },
        },
    )
    return project.script


def update_voice_assignments(project_id: str, payload: VoiceAssignmentsPayload, *, projects_dir):
    project = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, project, reason="before_voice_assignment_save")
    project.voice_assignments = payload.assignments
    if payload.assignments:
        project.status = "voices_configured"
    elif project.script.segments:
        project.status = "parsed"
    save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        project.id,
        {
            "source": "project",
            "status": project.status,
            "event": {
                "type": "voice_assignments_saved",
                "message": f"角色分配已保存，角色数 {len(project.voice_assignments)}",
            },
        },
    )
    return {"assignments": project.voice_assignments, "status": project.status}
