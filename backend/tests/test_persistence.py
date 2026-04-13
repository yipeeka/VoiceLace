from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.models import Project
from backend.persistence import load_project, save_project


class PersistenceTest(unittest.TestCase):
    def test_save_project_writes_valid_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            projects_dir = Path(tmp)
            project = Project(name="atomic-test")
            saved = save_project(projects_dir, project)
            project_file = projects_dir / f"{saved.id}.json"
            self.assertTrue(project_file.exists())
            parsed = json.loads(project_file.read_text(encoding="utf-8"))
            self.assertEqual(parsed["id"], saved.id)
            self.assertEqual(parsed["name"], "atomic-test")

    def test_save_project_overwrites_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            projects_dir = Path(tmp)
            project = Project(name="v1")
            saved = save_project(projects_dir, project)
            saved.name = "v2"
            save_project(projects_dir, saved)
            loaded = load_project(projects_dir, saved.id)
            self.assertEqual(loaded.name, "v2")


if __name__ == "__main__":
    unittest.main()
