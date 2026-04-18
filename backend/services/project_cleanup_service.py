from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from backend.persistence import load_project, project_event_log_path, project_path, read_project_events


def delete_project_with_outputs(project_id: str, *, projects_dir: Path, output_dir: Path) -> dict[str, Any]:
    _ = load_project(projects_dir, project_id)
    events = read_project_events(projects_dir, project_id, limit=0)
    task_ids = {event.get("task_id") for event in events if event.get("task_id")}

    path = project_path(projects_dir, project_id)
    if path.exists():
        path.unlink()
    log_path = project_event_log_path(projects_dir, project_id)
    if log_path.exists():
        log_path.unlink()

    for ext in ("wav", "mp3", "srt", "lrc"):
        export_file = output_dir / f"{project_id}.{ext}"
        if export_file.exists():
            export_file.unlink()
    archive_file = output_dir / f"{project_id}.archive.zip"
    if archive_file.exists():
        archive_file.unlink()
    project_output_dir = output_dir / "projects" / project_id
    if project_output_dir.exists() and project_output_dir.is_dir():
        shutil.rmtree(project_output_dir, ignore_errors=True)

    removed_task_dirs = 0
    for task_id in task_ids:
        task_dir = output_dir / str(task_id)
        if task_dir.exists() and task_dir.is_dir():
            shutil.rmtree(task_dir, ignore_errors=True)
            removed_task_dirs += 1
    return {"status": "deleted", "removed_task_dirs": removed_task_dirs}
