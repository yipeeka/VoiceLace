from __future__ import annotations

from backend.models import Project, ProjectSummary
from backend.persistence import append_project_event, load_project, read_project_events, save_project
from .project_snapshot_service import create_project_snapshot


def list_projects(*, projects_dir):
    projects = []
    for file in sorted(projects_dir.glob("*.json")):
        project = load_project(projects_dir, file.stem)
        projects.append(ProjectSummary.from_project(project))
    return projects


def create_project(name: str, *, projects_dir):
    project = Project(name=name)
    saved = save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        saved.id,
        {"source": "project", "status": saved.status, "event": {"type": "project_created", "message": f"已创建项目：{saved.name}"}},
    )
    return saved


def get_project(project_id: str, *, projects_dir):
    return load_project(projects_dir, project_id)


def update_project(project_id: str, payload: Project, *, projects_dir):
    previous = load_project(projects_dir, project_id)
    create_project_snapshot(projects_dir, previous, reason="before_project_update")
    project = payload.model_copy(update={"id": project_id})
    saved = save_project(projects_dir, project)
    if previous.name != saved.name:
        append_project_event(
            projects_dir,
            saved.id,
            {
                "source": "project",
                "status": saved.status,
                "event": {
                    "type": "project_renamed",
                    "message": f"{previous.name} -> {saved.name}",
                },
            },
        )
    else:
        append_project_event(
            projects_dir,
            saved.id,
            {"source": "project", "status": saved.status, "event": {"type": "project_updated", "message": "项目元数据已更新"}},
        )
    return saved


def get_project_events(project_id: str, *, projects_dir, limit: int = 500):
    _ = load_project(projects_dir, project_id)
    return read_project_events(projects_dir, project_id, limit=limit)
