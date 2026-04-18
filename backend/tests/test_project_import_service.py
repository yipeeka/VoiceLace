from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project, ProjectOrigin, SegmentAsset
from backend.persistence import save_project
from backend.services.project_import_service import find_project_file_match, reset_imported_audio_assets


class ProjectImportServiceTest(unittest.TestCase):
    def test_find_project_file_match_prefers_source_project_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            original = save_project(projects_dir, Project(name="original"))
            imported = Project(
                name="imported",
                project_origin=ProjectOrigin(
                    kind="project_file",
                    source_project_id=original.id,
                    project_file_name="a.bvtproject.json",
                    project_file_fingerprint="fp-1",
                ),
            )
            save_project(projects_dir, imported)

            matched, reason = find_project_file_match(
                projects_dir,
                fingerprint="not-exists",
                source_project_id=original.id,
            )

            self.assertIsNotNone(matched)
            self.assertEqual(matched.id, original.id)
            self.assertEqual(reason, "source_project_id")

    def test_find_project_file_match_by_fingerprint(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            imported = Project(
                name="imported",
                project_origin=ProjectOrigin(
                    kind="project_file",
                    source_project_id=None,
                    project_file_name="a.bvtproject.json",
                    project_file_fingerprint="fp-2",
                ),
            )
            save_project(projects_dir, imported)

            matched, reason = find_project_file_match(
                projects_dir,
                fingerprint="fp-2",
                source_project_id=None,
            )

            self.assertIsNotNone(matched)
            self.assertEqual(matched.id, imported.id)
            self.assertEqual(reason, "fingerprint")

    def test_reset_imported_audio_assets_clears_segment_assets(self) -> None:
        project = Project(name="audio-project")
        project.audio_assets.segments["seg-1"] = SegmentAsset(relpath="seg-1.wav", duration_sec=1.23)
        project.audio_assets.latest_task_id = "task-1"
        project.audio_assets.full_wav_relpath = "x.wav"

        reset_imported_audio_assets(project)

        self.assertIsNone(project.audio_assets.latest_task_id)
        self.assertEqual(project.audio_assets.segments, {})
        self.assertIsNone(project.audio_assets.full_wav_relpath)


if __name__ == "__main__":
    unittest.main()
