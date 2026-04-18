from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.models import Project
from backend.persistence import save_project
from backend.services import build_project_file_payload
from backend.services.project_file_open_service import import_project_file_bytes


class ProjectFileOpenServiceTest(unittest.TestCase):
    def test_import_project_file_reuses_by_source_project_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            source = save_project(projects_dir, Project(name="source"))
            payload = build_project_file_payload(source)
            raw = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False).encode("utf-8")

            result = import_project_file_bytes(raw, filename="a.bvtproject.json", projects_dir=projects_dir)

            self.assertEqual(result["open_mode"], "reused")
            self.assertEqual(result["project_id"], source.id)
            self.assertEqual(result["import_source"], "project_file")
            self.assertTrue(result["project_file_fingerprint"])

    def test_import_project_file_creates_when_no_match(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            source = Project(name="new-project")
            payload = build_project_file_payload(source)
            raw = json.dumps(payload.model_dump(mode="json"), ensure_ascii=False).encode("utf-8")

            result = import_project_file_bytes(raw, filename="b.bvtproject.json", projects_dir=projects_dir)

            self.assertEqual(result["open_mode"], "created")
            self.assertEqual(result["project_name"], "new-project")
            self.assertTrue((projects_dir / f"{result['project_id']}.json").exists())

    def test_import_project_file_invalid_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            with self.assertRaises(ValueError):
                import_project_file_bytes(b"bad-json", filename="x.bvtproject.json", projects_dir=projects_dir)


if __name__ == "__main__":
    unittest.main()
