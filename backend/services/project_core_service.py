from __future__ import annotations

from backend.models import Project, ProjectSummary
from backend.persistence import load_project, read_project_events, save_project


def list_projects(*, projects_dir):
    projects = []
    for file in sorted(projects_dir.glob("*.json")):
        project = load_project(projects_dir, file.stem)
        projects.append(ProjectSummary.from_project(project))
    return projects


def create_project(name: str, *, projects_dir):
    project = Project(name=name)
    return save_project(projects_dir, project)


def get_project(project_id: str, *, projects_dir):
    return load_project(projects_dir, project_id)


def update_project(project_id: str, payload: Project, *, projects_dir):
    project = payload.model_copy(update={"id": project_id})
    return save_project(projects_dir, project)


def get_project_events(project_id: str, *, projects_dir, limit: int = 500):
    _ = load_project(projects_dir, project_id)
    return read_project_events(projects_dir, project_id, limit=limit)
