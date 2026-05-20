from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import (
    BatchUpdateSegmentsRequest,
    MergeCharacterRequest,
    MergeSegmentsRequest,
    Project,
    RenameCharacterRequest,
    Script,
    SearchReplaceSegmentsRequest,
    Segment,
    SegmentAsset,
    SplitSegmentRequest,
)
from backend.persistence import load_project, read_project_events, save_project
from backend.services.project_script_batch_service import (
    _weighted_text_duration_units,
    batch_update_segments,
    merge_adjacent_segments,
    merge_character,
    rename_character,
    search_replace_segments,
    split_segment,
)
from backend.services.project_snapshot_service import list_project_snapshots


class ProjectScriptBatchServiceTest(unittest.TestCase):
    def _build_project(self, projects_dir: Path) -> Project:
        project = Project(
            name="batch-ops",
            script=Script(
                source_text="旁白：你好。小王：早上好。小王：我们出发吧。",
                segments=[
                    Segment(id="s1", index=0, speaker="旁白", type="narration", text="你好。"),
                    Segment(id="s2", index=1, speaker="小王", type="dialogue", text="早上好。"),
                    Segment(id="s3", index=2, speaker="小王", type="dialogue", text="我们出发吧。"),
                ],
            ),
            voice_assignments={"旁白": "preset-n", "小王": "preset-a"},
        )
        project.audio_assets.segments = {
            "s1": SegmentAsset(segment_id="s1", audio_relpath="a.wav", duration_ms=100),
            "s2": SegmentAsset(segment_id="s2", audio_relpath="b.wav", duration_ms=100),
            "s3": SegmentAsset(segment_id="s3", audio_relpath="c.wav", duration_ms=100),
        }
        return save_project(projects_dir, project)

    def test_rename_character_updates_segments_and_voice_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = self._build_project(projects_dir)

            result = rename_character(
                project.id,
                RenameCharacterRequest(from_name="小王", to_name="王老师"),
                projects_dir=projects_dir,
            )
            self.assertEqual(result["status"], "voices_configured")
            reloaded = load_project(projects_dir, project.id)
            self.assertTrue(all(seg.speaker != "小王" for seg in reloaded.script.segments))
            self.assertEqual(sum(1 for seg in reloaded.script.segments if seg.speaker == "王老师"), 2)
            self.assertIn("王老师", reloaded.voice_assignments)
            self.assertNotIn("小王", reloaded.voice_assignments)
            self.assertNotIn("s2", reloaded.audio_assets.segments)
            self.assertNotIn("s3", reloaded.audio_assets.segments)
            self.assertGreaterEqual(len(list_project_snapshots(projects_dir, project.id, limit=10)), 1)

            events = read_project_events(projects_dir, project.id, limit=20)
            self.assertTrue(any((row.get("event") or {}).get("type") == "character_renamed" for row in events))

    def test_merge_character_keeps_target_voice_assignment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = self._build_project(projects_dir)
            reloaded = load_project(projects_dir, project.id)
            reloaded.voice_assignments["王老师"] = "preset-target"
            save_project(projects_dir, reloaded)

            merge_character(
                project.id,
                MergeCharacterRequest(source_name="小王", target_name="王老师"),
                projects_dir=projects_dir,
            )
            final_project = load_project(projects_dir, project.id)
            self.assertEqual(final_project.voice_assignments.get("王老师"), "preset-target")
            self.assertNotIn("小王", final_project.voice_assignments)

    def test_batch_update_and_search_replace(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = self._build_project(projects_dir)

            updated = batch_update_segments(
                project.id,
                BatchUpdateSegmentsRequest(segment_ids=["s2", "s3"], emotion="angry", type="direction"),
                projects_dir=projects_dir,
            )
            self.assertEqual(sorted(updated["changed_segment_ids"]), ["s2", "s3"])
            after_batch = load_project(projects_dir, project.id)
            self.assertEqual({seg.emotion for seg in after_batch.script.segments if seg.id in {"s2", "s3"}}, {"angry"})
            self.assertEqual({seg.type for seg in after_batch.script.segments if seg.id in {"s2", "s3"}}, {"direction"})

            replaced = search_replace_segments(
                project.id,
                SearchReplaceSegmentsRequest(find="出发", replace="行动", case_sensitive=False),
                projects_dir=projects_dir,
            )
            self.assertEqual(replaced["changed_segment_ids"], ["s3"])
            after_replace = load_project(projects_dir, project.id)
            target = next(seg for seg in after_replace.script.segments if seg.id == "s3")
            self.assertIn("行动", target.text)

    def test_split_and_merge_adjacent_segments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = self._build_project(projects_dir)

            split_result = split_segment(
                project.id,
                SplitSegmentRequest(segment_id="s3", cursor=2),
                projects_dir=projects_dir,
            )
            self.assertEqual(split_result["changed_segment_ids"], ["s3"])
            split_project_data = load_project(projects_dir, project.id)
            self.assertEqual(len(split_project_data.script.segments), 4)
            s3_idx = next(i for i, seg in enumerate(split_project_data.script.segments) if seg.id == "s3")
            next_seg = split_project_data.script.segments[s3_idx + 1]
            self.assertTrue(next_seg.text)

            merged = merge_adjacent_segments(
                project.id,
                MergeSegmentsRequest(first_segment_id="s2", second_segment_id="s3"),
                projects_dir=projects_dir,
            )
            self.assertIn("s3", merged["removed_segment_ids"])
            merged_project = load_project(projects_dir, project.id)
            self.assertEqual(len(merged_project.script.segments), 3)

    def test_split_segment_splits_timeline_with_gap_and_duration_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="timeline-split",
                script=Script(
                    segments=[
                        Segment(
                            id="s1",
                            index=0,
                            speaker="旁白",
                            text="你好。再见",
                            source_start_ms=1000,
                            source_end_ms=6000,
                            source_duration_ms=5000,
                            tts_overrides={"duration": 4.9, "speed": 1.1},
                        ),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)

            split_segment(
                saved.id,
                SplitSegmentRequest(segment_id="s1", cursor=3),
                projects_dir=projects_dir,
            )

            reloaded = load_project(projects_dir, saved.id)
            self.assertEqual(len(reloaded.script.segments), 2)
            left, right = reloaded.script.segments
            self.assertEqual(left.text, "你好。")
            self.assertEqual(right.text, "再见")
            self.assertEqual(left.source_start_ms, 1000)
            self.assertEqual(right.source_end_ms, 6000)
            self.assertEqual(right.source_start_ms - left.source_end_ms, 200)
            self.assertEqual(left.source_duration_ms, left.source_end_ms - left.source_start_ms)
            self.assertEqual(right.source_duration_ms, right.source_end_ms - right.source_start_ms)
            self.assertEqual((left.source_duration_ms or 0) + (right.source_duration_ms or 0), 4800)
            self.assertGreater(left.source_duration_ms or 0, right.source_duration_ms or 0)
            self.assertAlmostEqual(float(left.tts_overrides["duration"]), (left.source_duration_ms or 0) / 1000, places=3)
            self.assertAlmostEqual(float(right.tts_overrides["duration"]), (right.source_duration_ms or 0) / 1000, places=3)
            self.assertEqual(left.tts_overrides["speed"], 1.1)
            self.assertEqual(right.tts_overrides["speed"], 1.1)

    def test_merge_adjacent_segments_merges_timeline_and_duration_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="timeline-merge",
                script=Script(
                    segments=[
                        Segment(
                            id="s1",
                            index=0,
                            speaker="旁白",
                            text="你好。",
                            source_start_ms=1000,
                            source_end_ms=3100,
                            source_duration_ms=2100,
                            tts_overrides={"duration": 2.1, "speed": 1.05},
                        ),
                        Segment(
                            id="s2",
                            index=1,
                            speaker="旁白",
                            text="再见",
                            source_start_ms=3300,
                            source_end_ms=6000,
                            source_duration_ms=2700,
                            tts_overrides={"duration": 2.7, "speed": 0.95},
                        ),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)

            result = merge_adjacent_segments(
                saved.id,
                MergeSegmentsRequest(first_segment_id="s1", second_segment_id="s2"),
                projects_dir=projects_dir,
            )

            self.assertEqual(result["changed_segment_ids"], ["s1"])
            self.assertEqual(result["removed_segment_ids"], ["s2"])
            reloaded = load_project(projects_dir, saved.id)
            self.assertEqual(len(reloaded.script.segments), 1)
            merged = reloaded.script.segments[0]
            self.assertEqual(merged.source_start_ms, 1000)
            self.assertEqual(merged.source_end_ms, 6000)
            self.assertEqual(merged.source_duration_ms, 5000)
            self.assertAlmostEqual(float(merged.tts_overrides["duration"]), 5.0, places=3)
            self.assertEqual(merged.tts_overrides["speed"], 1.05)

    def test_merge_adjacent_segments_adds_duration_overrides_without_timeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="duration-merge",
                script=Script(
                    segments=[
                        Segment(id="s1", index=0, speaker="旁白", text="hello", tts_overrides={"duration": 1.25, "speed": 1.1}),
                        Segment(id="s2", index=1, speaker="旁白", text="world", tts_overrides={"duration": 2.5, "speed": 0.9}),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)

            merge_adjacent_segments(
                saved.id,
                MergeSegmentsRequest(first_segment_id="s1", second_segment_id="s2"),
                projects_dir=projects_dir,
            )

            merged = load_project(projects_dir, saved.id).script.segments[0]
            self.assertIsNone(merged.source_start_ms)
            self.assertIsNone(merged.source_end_ms)
            self.assertIsNone(merged.source_duration_ms)
            self.assertAlmostEqual(float(merged.tts_overrides["duration"]), 3.75, places=3)
            self.assertEqual(merged.tts_overrides["speed"], 1.1)

    def test_weighted_text_duration_units_accounts_for_tokens_numbers_and_punctuation(self) -> None:
        cjk_with_pause = _weighted_text_duration_units("你好，世界。")
        plain_cjk = _weighted_text_duration_units("你好世界")
        english_tokens = _weighted_text_duration_units("AI model 2026.")

        self.assertGreater(cjk_with_pause, plain_cjk)
        self.assertGreater(english_tokens, 3.0)


if __name__ == "__main__":
    unittest.main()
