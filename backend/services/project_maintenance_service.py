from __future__ import annotations

from collections import defaultdict
from pathlib import Path
from typing import Any

from backend.models import Project
from backend.persistence import (
    load_project,
    project_event_log_path,
    project_path,
    save_project,
)


def deduplicate_project_file_projects(
    projects_dir: Path,
    *,
    dry_run: bool,
    delete_orphan_event_logs: bool,
) -> dict[str, Any]:
    grouped: dict[str, list[Project]] = defaultdict(list)
    for file in sorted(projects_dir.glob("*.json")):
        project = load_project(projects_dir, file.stem)
        if project.project_origin.kind != "project_file":
            continue
        fingerprint = (project.project_origin.project_file_fingerprint or "").strip()
        if not fingerprint:
            continue
        grouped[fingerprint].append(project)

    duplicate_groups: list[dict[str, Any]] = []
    remove_project_ids: list[str] = []
    for fingerprint, projects in grouped.items():
        if len(projects) <= 1:
            continue
        ordered = sorted(
            projects,
            key=lambda item: (item.updated_at, item.created_at, item.id),
            reverse=True,
        )
        keep = ordered[0]
        remove = ordered[1:]
        remove_ids = [item.id for item in remove]
        duplicate_groups.append(
            {
                "fingerprint_prefix": fingerprint[:12],
                "keep_project_id": keep.id,
                "remove_project_ids": remove_ids,
            }
        )
        remove_project_ids.extend(remove_ids)

    removed_event_logs = 0
    if not dry_run:
        for project_id in remove_project_ids:
            path = project_path(projects_dir, project_id)
            if path.exists():
                path.unlink()
            if delete_orphan_event_logs:
                log_path = project_event_log_path(projects_dir, project_id)
                if log_path.exists():
                    log_path.unlink()
                    removed_event_logs += 1

    return {
        "dry_run": dry_run,
        "group_count": len(duplicate_groups),
        "remove_count": len(remove_project_ids),
        "removed_event_log_count": removed_event_logs,
        "groups": duplicate_groups,
    }


def merge_project_file_shadows(
    projects_dir: Path,
    *,
    dry_run: bool,
    delete_orphan_event_logs: bool,
) -> dict[str, Any]:
    by_id: dict[str, Project] = {}
    for file in sorted(projects_dir.glob("*.json")):
        project = load_project(projects_dir, file.stem)
        by_id[project.id] = project

    shadow_pairs: list[dict[str, Any]] = []
    remove_project_ids: list[str] = []
    updated_source_ids: list[str] = []
    removed_event_logs = 0

    for shadow in by_id.values():
        if shadow.project_origin.kind != "project_file":
            continue
        source_id = (shadow.project_origin.source_project_id or "").strip()
        if not source_id:
            continue
        if source_id == shadow.id:
            continue
        source = by_id.get(source_id)
        if source is None:
            continue
        if source.name != shadow.name:
            continue

        shadow_pairs.append(
            {
                "source_project_id": source.id,
                "shadow_project_id": shadow.id,
                "name": shadow.name,
                "fingerprint_prefix": (shadow.project_origin.project_file_fingerprint or "")[:12],
            }
        )
        remove_project_ids.append(shadow.id)

        if dry_run:
            continue

        source.project_origin = source.project_origin.model_copy(
            update={
                "kind": "project_file",
                "source_project_id": source.id,
                "project_file_name": shadow.project_origin.project_file_name,
                "project_file_fingerprint": shadow.project_origin.project_file_fingerprint,
            }
        )
        save_project(projects_dir, source)
        updated_source_ids.append(source.id)

        shadow_path = project_path(projects_dir, shadow.id)
        if shadow_path.exists():
            shadow_path.unlink()
        if delete_orphan_event_logs:
            log_path = project_event_log_path(projects_dir, shadow.id)
            if log_path.exists():
                log_path.unlink()
                removed_event_logs += 1

    return {
        "dry_run": dry_run,
        "pair_count": len(shadow_pairs),
        "remove_count": len(remove_project_ids),
        "updated_source_count": len(set(updated_source_ids)),
        "removed_event_log_count": removed_event_logs,
        "pairs": shadow_pairs,
    }
