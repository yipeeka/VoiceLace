from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project
from backend.persistence import append_project_event, save_project
from backend.services.project_cleanup_service import delete_project_with_outputs


class ProjectCleanupServiceTest(unittest.TestCase):
    def test_delete_project_with_outputs_removes_project_and_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            projects_dir = root / "projects"
            output_dir = root / "output"
            projects_dir.mkdir(parents=True, exist_ok=True)
            output_dir.mkdir(parents=True, exist_ok=True)

            project = save_project(projects_dir, Project(name="cleanup"))
            append_project_event(projects_dir, project.id, {"task_id": "task-1", "status": "done"})

            (output_dir / f"{project.id}.wav").write_bytes(b"x")
            (output_dir / f"{project.id}.archive.zip").write_bytes(b"x")
            task_dir = output_dir / "task-1"
            task_dir.mkdir(parents=True, exist_ok=True)
            (task_dir / "dummy.txt").write_text("ok", encoding="utf-8")
            project_out = output_dir / "projects" / project.id
            project_out.mkdir(parents=True, exist_ok=True)
            (project_out / "mix.wav").write_bytes(b"x")

            result = delete_project_with_outputs(project.id, projects_dir=projects_dir, output_dir=output_dir)

            self.assertEqual(result["status"], "deleted")
            self.assertEqual(result["removed_task_dirs"], 1)
            self.assertFalse((projects_dir / f"{project.id}.json").exists())
            self.assertFalse((projects_dir / f"{project.id}.events.jsonl").exists())
            self.assertFalse((output_dir / f"{project.id}.wav").exists())
            self.assertFalse((output_dir / f"{project.id}.archive.zip").exists())
            self.assertFalse(project_out.exists())
            self.assertFalse(task_dir.exists())


if __name__ == "__main__":
    unittest.main()
