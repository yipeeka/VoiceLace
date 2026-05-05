from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project, Script, Segment
from backend.persistence import append_project_event, load_project, save_project
from backend.services.project_history_service import get_project_history
from backend.services.project_snapshot_service import (
    SNAPSHOT_RETENTION_LIMIT,
    create_project_snapshot,
    list_project_snapshots,
    restore_project_snapshot,
)


class ProjectSnapshotServiceTest(unittest.TestCase):
    def test_create_list_restore_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = save_project(
                projects_dir,
                Project(
                    name="snap-demo",
                    script=Script(segments=[Segment(id="s1", index=0, speaker="narrator", text="old")]),
                ),
            )

            first = create_project_snapshot(projects_dir, project, reason="before_script_save")

            project.script.segments[0].text = "new"
            save_project(projects_dir, project)
            restored, backup = restore_project_snapshot(projects_dir, project.id, first["id"])

            self.assertEqual(restored.script.segments[0].text, "old")
            self.assertTrue(backup["id"])
            reloaded = load_project(projects_dir, project.id)
            self.assertEqual(reloaded.script.segments[0].text, "old")

    def test_snapshot_retention_limit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = save_project(projects_dir, Project(name="retention"))
            for idx in range(SNAPSHOT_RETENTION_LIMIT + 5):
                project.name = f"retention-{idx}"
                save_project(projects_dir, project)
                create_project_snapshot(projects_dir, project, reason="before_project_update")

            snapshots = list_project_snapshots(projects_dir, project.id, limit=200)
            self.assertEqual(len(snapshots), SNAPSHOT_RETENTION_LIMIT)

    def test_history_contains_snapshot_and_project_event(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = save_project(projects_dir, Project(name="history"))
            create_project_snapshot(projects_dir, project, reason="before_project_update")
            append_project_event(
                projects_dir,
                project.id,
                {"source": "project", "status": "draft", "event": {"type": "project_updated", "message": "x"}},
            )
            rows = get_project_history(project.id, projects_dir=projects_dir, limit=20)
            kinds = {row.get("kind") for row in rows}
            self.assertIn("snapshot", kinds)
            self.assertIn("event", kinds)


if __name__ == "__main__":
    unittest.main()
