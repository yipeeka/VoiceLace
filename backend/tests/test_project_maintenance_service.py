from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project, ProjectOrigin
from backend.persistence import load_project, save_project
from backend.services.project_maintenance_service import (
    deduplicate_project_file_projects,
    merge_project_file_shadows,
)


class ProjectMaintenanceServiceTest(unittest.TestCase):
    def test_deduplicate_project_file_projects_removes_duplicates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            p1 = Project(
                name="same",
                project_origin=ProjectOrigin(
                    kind="project_file",
                    source_project_id="s1",
                    project_file_name="a.bvtproject.json",
                    project_file_fingerprint="fp-dup",
                ),
            )
            p2 = Project(
                name="same",
                project_origin=ProjectOrigin(
                    kind="project_file",
                    source_project_id="s1",
                    project_file_name="a.bvtproject.json",
                    project_file_fingerprint="fp-dup",
                ),
            )
            save_project(projects_dir, p1)
            save_project(projects_dir, p2)

            dry = deduplicate_project_file_projects(projects_dir, dry_run=True, delete_orphan_event_logs=True)
            self.assertEqual(dry["group_count"], 1)
            self.assertEqual(dry["remove_count"], 1)

            real = deduplicate_project_file_projects(projects_dir, dry_run=False, delete_orphan_event_logs=True)
            self.assertEqual(real["remove_count"], 1)
            remaining = list(projects_dir.glob("*.json"))
            self.assertEqual(len(remaining), 1)

    def test_merge_project_file_shadows_updates_source_origin(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            source = Project(name="same")
            source_saved = save_project(projects_dir, source)
            shadow = Project(
                name="same",
                project_origin=ProjectOrigin(
                    kind="project_file",
                    source_project_id=source_saved.id,
                    project_file_name="shadow.bvtproject.json",
                    project_file_fingerprint="fp-shadow",
                ),
            )
            shadow_saved = save_project(projects_dir, shadow)

            dry = merge_project_file_shadows(projects_dir, dry_run=True, delete_orphan_event_logs=True)
            self.assertEqual(dry["pair_count"], 1)
            self.assertEqual(dry["remove_count"], 1)

            real = merge_project_file_shadows(projects_dir, dry_run=False, delete_orphan_event_logs=True)
            self.assertEqual(real["remove_count"], 1)
            reloaded = load_project(projects_dir, source_saved.id)
            self.assertEqual(reloaded.project_origin.kind, "project_file")
            self.assertEqual(reloaded.project_origin.project_file_name, "shadow.bvtproject.json")
            self.assertFalse((projects_dir / f"{shadow_saved.id}.json").exists())


if __name__ == "__main__":
    unittest.main()
