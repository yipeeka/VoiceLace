from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from backend.models import Project


def project_path(projects_dir: Path, project_id: str) -> Path:
    return projects_dir / f"{project_id}.json"


def save_project(projects_dir: Path, project: Project) -> Project:
    project.updated_at = datetime.now(timezone.utc)
    project_path(projects_dir, project.id).write_text(
        project.model_dump_json(indent=2),
        encoding="utf-8",
    )
    return project


def load_project(projects_dir: Path, project_id: str) -> Project:
    path = project_path(projects_dir, project_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")
    return Project.model_validate(json.loads(path.read_text(encoding="utf-8")))


def project_event_log_path(projects_dir: Path, project_id: str) -> Path:
    return projects_dir / f"{project_id}.events.jsonl"


def append_project_event(projects_dir: Path, project_id: str, event: dict) -> None:
    record = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **event,
    }
    log_path = project_event_log_path(projects_dir, project_id)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def read_project_events(projects_dir: Path, project_id: str, limit: int = 500) -> list[dict]:
    log_path = project_event_log_path(projects_dir, project_id)
    if not log_path.exists():
        return []
    lines = log_path.read_text(encoding="utf-8").splitlines()
    tail = lines[-limit:] if limit > 0 else lines
    events: list[dict] = []
    for line in tail:
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return events
