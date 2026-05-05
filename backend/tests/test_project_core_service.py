from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project
from backend.persistence import append_project_event
from backend.services.project_core_service import (
    create_project,
    get_project,
    get_project_events,
    list_projects,
    update_project,
)


class ProjectCoreServiceTest(unittest.TestCase):
    def test_create_list_get_update_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            created = create_project("core", projects_dir=projects_dir)

            listed = list_projects(projects_dir=projects_dir)
            self.assertEqual(len(listed), 1)
            self.assertEqual(listed[0].id, created.id)

            loaded = get_project(created.id, projects_dir=projects_dir)
            self.assertEqual(loaded.name, "core")

            updated = update_project(
                created.id,
                Project(id=created.id, name="core-updated"),
                projects_dir=projects_dir,
            )
            self.assertEqual(updated.name, "core-updated")

    def test_get_project_events_requires_project_and_reads_rows(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            created = create_project("core-events", projects_dir=projects_dir)
            append_project_event(projects_dir, created.id, {"task_id": "t1", "status": "done"})

            rows = get_project_events(created.id, projects_dir=projects_dir, limit=500)
            self.assertTrue(any(row.get("task_id") == "t1" for row in rows))


if __name__ == "__main__":
    unittest.main()
