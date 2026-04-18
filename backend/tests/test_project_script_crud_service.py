from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project, ReorderSegmentsRequest, Script, Segment, SegmentAsset, VoiceAssignmentsPayload
from backend.persistence import load_project, save_project
from backend.services.project_script_crud_service import (
    add_segment,
    delete_segment,
    get_script,
    reorder_script,
    update_script,
    update_segment,
    update_voice_assignments,
)


class ProjectScriptCrudServiceTest(unittest.TestCase):
    def test_update_script_removes_deleted_and_changed_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="script",
                script=Script(
                    segments=[
                        Segment(id="s1", index=0, speaker="narrator", text="old1"),
                        Segment(id="s2", index=1, speaker="narrator", text="old2"),
                    ]
                ),
            )
            project.audio_assets.segments = {
                "s1": SegmentAsset(segment_id="s1", audio_relpath="a.wav", duration_ms=1000),
                "s2": SegmentAsset(segment_id="s2", audio_relpath="b.wav", duration_ms=1000),
            }
            saved = save_project(projects_dir, project)

            updated = update_script(
                saved.id,
                Script(segments=[Segment(id="s1", index=0, speaker="narrator", text="new1")]),
                projects_dir=projects_dir,
            )

            self.assertEqual(len(updated.segments), 1)
            reloaded = load_project(projects_dir, saved.id)
            self.assertEqual(reloaded.audio_assets.segments, {})

    def test_update_segment_and_reorder_and_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="script",
                script=Script(
                    segments=[
                        Segment(id="s1", index=0, speaker="a", text="t1"),
                        Segment(id="s2", index=1, speaker="b", text="t2"),
                    ]
                ),
            )
            project.audio_assets.segments = {
                "s1": SegmentAsset(segment_id="s1", audio_relpath="a.wav", duration_ms=1000),
            }
            saved = save_project(projects_dir, project)

            update_segment(
                saved.id,
                "s1",
                Segment(id="s1", index=0, speaker="a", text="t1-changed"),
                projects_dir=projects_dir,
            )
            after_update = load_project(projects_dir, saved.id)
            self.assertNotIn("s1", after_update.audio_assets.segments)

            add_segment(saved.id, Segment(id="s3", index=5, speaker="c", text="t3"), projects_dir=projects_dir)
            reordered = reorder_script(
                saved.id,
                ReorderSegmentsRequest(segment_ids=["s3", "s1", "s2"]),
                projects_dir=projects_dir,
            )
            self.assertEqual([seg.id for seg in reordered.segments], ["s3", "s1", "s2"])
            self.assertEqual([seg.index for seg in reordered.segments], [0, 1, 2])

            result = delete_segment(saved.id, "s2", projects_dir=projects_dir)
            self.assertEqual(result["status"], "deleted")
            after_delete = get_script(saved.id, projects_dir=projects_dir)
            self.assertEqual([seg.id for seg in after_delete.segments], ["s3", "s1"])

    def test_update_voice_assignments_sets_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = save_project(projects_dir, Project(name="script"))

            result = update_voice_assignments(
                project.id,
                VoiceAssignmentsPayload(assignments={"narrator": "preset-1"}),
                projects_dir=projects_dir,
            )
            self.assertEqual(result["status"], "voices_configured")


if __name__ == "__main__":
    unittest.main()
