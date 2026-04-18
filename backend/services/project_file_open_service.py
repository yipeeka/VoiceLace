from __future__ import annotations

from typing import Any

from backend.models import Project, ProjectOrigin
from backend.persistence import save_project

from .project_file_service import normalize_synthesis_config, parse_project_file_payload
from .project_import_service import find_project_file_match, reset_imported_audio_assets
from .project_script_service import sync_script_metadata


def import_project_file_bytes(raw_bytes: bytes, *, filename: str | None, projects_dir) -> dict[str, Any]:
    try:
        payload, fingerprint = parse_project_file_payload(raw_bytes)
    except Exception as exc:
        raise ValueError(str(exc)) from exc
    imported_script = sync_script_metadata(payload.script.model_copy(deep=True))
    imported_script.source_text = payload.script.source_text or ""
    normalized_synthesis_config = normalize_synthesis_config(payload.synthesis_config)
    matched, match_reason = find_project_file_match(
        projects_dir,
        fingerprint=fingerprint,
        source_project_id=payload.source_project_id,
    )
    if matched is None:
        imported_project = Project(
            name=payload.project.name,
            script=imported_script,
            voice_assignments=dict(payload.voice_assignments or {}),
            synthesis_config=normalized_synthesis_config,
            status=payload.project.status,
            project_origin=ProjectOrigin(
                kind="project_file",
                source_project_id=payload.source_project_id,
                project_file_name=filename or None,
                project_file_fingerprint=fingerprint,
            ),
        )
        reset_imported_audio_assets(imported_project)
        open_mode = "created"
        saved = save_project(projects_dir, imported_project)
    else:
        matched.name = payload.project.name
        matched.script = imported_script
        matched.voice_assignments = dict(payload.voice_assignments or {})
        matched.synthesis_config = normalized_synthesis_config
        matched.status = payload.project.status
        matched.project_origin = matched.project_origin.model_copy(
            update={
                "kind": "project_file",
                "source_project_id": payload.source_project_id,
                "project_file_name": filename or matched.project_origin.project_file_name,
                "project_file_fingerprint": fingerprint,
            }
        )
        reset_imported_audio_assets(matched)
        open_mode = "reused"
        saved = save_project(projects_dir, matched)
    return {
        "project_id": saved.id,
        "project_name": saved.name,
        "source_project_id": payload.source_project_id,
        "import_source": "project_file",
        "open_mode": open_mode,
        "match_reason": match_reason,
        "project_file_fingerprint": fingerprint,
        "warnings": [],
    }
