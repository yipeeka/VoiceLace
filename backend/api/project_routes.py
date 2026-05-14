from __future__ import annotations

import logging
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from backend.models import (
    BatchUpdateSegmentsRequest,
    CreateProjectRequest,
    MergeCharacterRequest,
    MergeSegmentsRequest,
    Project,
    RenameCharacterRequest,
    ReorderSegmentsRequest,
    SearchReplaceSegmentsRequest,
    Script,
    Segment,
    SplitSegmentRequest,
    VoiceAssignmentsPayload,
)
from backend.persistence import append_project_event
from backend.services import (
    add_project_segment,
    batch_update_project_segments,
    build_project_parse_qc_report,
    build_project_file_payload,
    create_project_record,
    delete_project_segment,
    delete_project_with_outputs,
    deduplicate_project_file_projects,
    get_project_event_rows,
    get_project_history,
    get_project_record,
    get_project_script,
    import_project_archive_bytes,
    import_project_file_bytes,
    list_project_summaries,
    list_project_snapshots,
    merge_adjacent_project_segments,
    merge_project_character,
    merge_project_file_shadows as merge_project_file_shadows_service,
    rename_project_character,
    resolve_project_source_audio_path,
    reorder_project_script,
    update_project_script,
    update_project_record,
    update_project_segment,
    update_project_voice_assignments,
    upload_project_source_audio,
    search_replace_project_segments,
    split_project_segment,
    get_project_snapshot,
    restore_project_snapshot,
)
from backend.state import get_app_state

router = APIRouter()
logger = logging.getLogger(__name__)


class DeduplicateProjectFilesRequest(BaseModel):
    dry_run: bool = True
    delete_orphan_event_logs: bool = True


class MergeProjectFileShadowsRequest(BaseModel):
    dry_run: bool = True
    delete_orphan_event_logs: bool = True


@router.get("")
async def list_projects(state=Depends(get_app_state)):
    return list_project_summaries(projects_dir=state.settings.projects_dir)


@router.post("")
async def create_project(payload: CreateProjectRequest, state=Depends(get_app_state)):
    return create_project_record(payload.name, projects_dir=state.settings.projects_dir)


@router.post("/maintenance/deduplicate-project-files")
async def deduplicate_project_files(payload: DeduplicateProjectFilesRequest, state=Depends(get_app_state)):
    result = deduplicate_project_file_projects(
        state.settings.projects_dir,
        dry_run=payload.dry_run,
        delete_orphan_event_logs=payload.delete_orphan_event_logs,
    )
    logger.info(
        "Project deduplication dry_run=%s group_count=%s remove_count=%s removed_event_log_count=%s",
        payload.dry_run,
        result["group_count"],
        result["remove_count"],
        result["removed_event_log_count"],
    )
    return result


@router.post("/maintenance/merge-project-file-shadows")
async def merge_project_file_shadows(payload: MergeProjectFileShadowsRequest, state=Depends(get_app_state)):
    result = merge_project_file_shadows_service(
        state.settings.projects_dir,
        dry_run=payload.dry_run,
        delete_orphan_event_logs=payload.delete_orphan_event_logs,
    )
    logger.info(
        "Project shadow merge dry_run=%s pair_count=%s remove_count=%s updated_source_count=%s removed_event_log_count=%s",
        payload.dry_run,
        result["pair_count"],
        result["remove_count"],
        result["updated_source_count"],
        result["removed_event_log_count"],
    )
    return result


@router.get("/{project_id}/export/project-file")
async def export_project_file(project_id: str, state=Depends(get_app_state)):
    project = get_project_record(project_id, projects_dir=state.settings.projects_dir)
    payload = build_project_file_payload(project).model_dump(mode="json")
    safe_name = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in project.name).strip("_") or "project"
    filename = f"{safe_name}.bvtproject.json"
    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-BVT-Project-File": "1",
        },
    )


@router.post("/import/project-file")
async def import_project_file(file: UploadFile = File(...), state=Depends(get_app_state)):
    try:
        response = import_project_file_bytes(
            await file.read(),
            filename=file.filename,
            projects_dir=state.settings.projects_dir,
        )
        logger.info(
            "Project file import %s project_id=%s source_project_id=%s match_reason=%s fingerprint_prefix=%s filename=%s",
            response["open_mode"],
            response["project_id"],
            response["source_project_id"],
            response["match_reason"],
            response["project_file_fingerprint"][:12],
            file.filename or "",
        )
        return response
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid project file: {exc}") from exc


@router.post("/import/archive")
async def import_project_archive(file: UploadFile = File(...), state=Depends(get_app_state)):
    try:
        return import_project_archive_bytes(
            await file.read(),
            settings=state.settings,
            voice_manager=state.voice_manager,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{project_id}")
async def get_project(project_id: str, state=Depends(get_app_state)):
    return get_project_record(project_id, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/source-audio")
async def upload_source_audio(project_id: str, file: UploadFile = File(...), state=Depends(get_app_state)):
    suffix = Path(file.filename or "source.wav").suffix or ".wav"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            temp_path = Path(tmp.name)
            shutil.copyfileobj(file.file, tmp)
        return upload_project_source_audio(
            project_id=project_id,
            input_path=temp_path,
            audio_name=file.filename,
            projects_dir=state.settings.projects_dir,
            output_dir=state.settings.output_dir,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        if temp_path:
            temp_path.unlink(missing_ok=True)


@router.get("/{project_id}/source-audio")
async def get_source_audio(project_id: str, state=Depends(get_app_state)):
    try:
        path = resolve_project_source_audio_path(
            project_id=project_id,
            projects_dir=state.settings.projects_dir,
            output_dir=state.settings.output_dir,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="audio/mpeg", filename=path.name)


@router.put("/{project_id}")
async def update_project(project_id: str, payload: Project, state=Depends(get_app_state)):
    return update_project_record(project_id, payload, projects_dir=state.settings.projects_dir)


@router.delete("/{project_id}")
async def delete_project(project_id: str, state=Depends(get_app_state)):
    return delete_project_with_outputs(
        project_id,
        projects_dir=state.settings.projects_dir,
        output_dir=state.settings.output_dir,
    )


@router.get("/{project_id}/script")
async def get_script(project_id: str, state=Depends(get_app_state)):
    return get_project_script(project_id, projects_dir=state.settings.projects_dir)


@router.put("/{project_id}/script")
async def update_script(project_id: str, payload: Script, state=Depends(get_app_state)):
    return update_project_script(
        project_id,
        payload,
        projects_dir=state.settings.projects_dir,
    )


@router.put("/{project_id}/script/segments/{segment_id}")
async def update_segment(project_id: str, segment_id: str, payload: Segment, state=Depends(get_app_state)):
    return update_project_segment(
        project_id,
        segment_id,
        payload,
        projects_dir=state.settings.projects_dir,
    )


@router.post("/{project_id}/script/segments")
async def add_segment(project_id: str, payload: Segment, state=Depends(get_app_state)):
    return add_project_segment(project_id, payload, projects_dir=state.settings.projects_dir)


@router.delete("/{project_id}/script/segments/{segment_id}")
async def delete_segment(project_id: str, segment_id: str, state=Depends(get_app_state)):
    return delete_project_segment(project_id, segment_id, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/script/reorder")
async def reorder_script(project_id: str, payload: ReorderSegmentsRequest, state=Depends(get_app_state)):
    return reorder_project_script(project_id, payload, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/script/rename-character")
async def rename_character(project_id: str, payload: RenameCharacterRequest, state=Depends(get_app_state)):
    return rename_project_character(project_id, payload, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/script/merge-character")
async def merge_character(project_id: str, payload: MergeCharacterRequest, state=Depends(get_app_state)):
    return merge_project_character(project_id, payload, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/script/batch-update")
async def batch_update_segments(project_id: str, payload: BatchUpdateSegmentsRequest, state=Depends(get_app_state)):
    return batch_update_project_segments(project_id, payload, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/script/search-replace")
async def search_replace_segments(project_id: str, payload: SearchReplaceSegmentsRequest, state=Depends(get_app_state)):
    return search_replace_project_segments(project_id, payload, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/script/split-segment")
async def split_segment(project_id: str, payload: SplitSegmentRequest, state=Depends(get_app_state)):
    return split_project_segment(project_id, payload, projects_dir=state.settings.projects_dir)


@router.post("/{project_id}/script/merge-segments")
async def merge_segments(project_id: str, payload: MergeSegmentsRequest, state=Depends(get_app_state)):
    return merge_adjacent_project_segments(project_id, payload, projects_dir=state.settings.projects_dir)


@router.put("/{project_id}/voice-assignments")
async def update_voice_assignments(project_id: str, payload: VoiceAssignmentsPayload, state=Depends(get_app_state)):
    return update_project_voice_assignments(
        project_id,
        payload,
        projects_dir=state.settings.projects_dir,
    )


@router.get("/{project_id}/events")
async def get_project_events(project_id: str, limit: int = 500, state=Depends(get_app_state)):
    return get_project_event_rows(
        project_id,
        projects_dir=state.settings.projects_dir,
        limit=limit,
    )


@router.get("/{project_id}/snapshots")
async def get_project_snapshots(project_id: str, limit: int = 50, state=Depends(get_app_state)):
    _ = get_project_record(project_id, projects_dir=state.settings.projects_dir)
    return list_project_snapshots(state.settings.projects_dir, project_id, limit=limit)


@router.get("/{project_id}/snapshots/{snapshot_id}")
async def get_snapshot_detail(project_id: str, snapshot_id: str, state=Depends(get_app_state)):
    _ = get_project_record(project_id, projects_dir=state.settings.projects_dir)
    return get_project_snapshot(state.settings.projects_dir, project_id, snapshot_id)


@router.post("/{project_id}/snapshots/{snapshot_id}/restore")
async def restore_snapshot(project_id: str, snapshot_id: str, state=Depends(get_app_state)):
    project, backup = restore_project_snapshot(state.settings.projects_dir, project_id, snapshot_id)
    append_project_event(
        state.settings.projects_dir,
        project_id,
        {
            "source": "project",
            "status": project.status,
            "event": {
                "type": "snapshot_restored",
                "message": f"已回滚到快照 {snapshot_id}",
                "snapshot_id": snapshot_id,
                "backup_snapshot_id": backup["id"],
            },
        },
    )
    logger.info("Project snapshot restored project_id=%s snapshot_id=%s backup_snapshot_id=%s", project_id, snapshot_id, backup["id"])
    return {
        "project_id": project_id,
        "snapshot_id": snapshot_id,
        "backup_snapshot": backup,
        "project": project,
    }


@router.get("/{project_id}/history")
async def get_history(project_id: str, limit: int = 200, state=Depends(get_app_state)):
    return get_project_history(project_id, projects_dir=state.settings.projects_dir, limit=limit)


@router.get("/{project_id}/parse-qc")
async def get_parse_quality_report(project_id: str, state=Depends(get_app_state)):
    return build_project_parse_qc_report(project_id, projects_dir=state.settings.projects_dir)
