from __future__ import annotations

import unittest

from backend.models import Project, Segment
from backend.services.dubbing_timeline_service import (
    apply_reasonable_dubbing_timeline,
    filter_model_tts_overrides,
    fingerprint_tts_overrides,
    is_dubbing_timeline_project,
    is_source_timeline_lock_enabled,
)


class DubbingTimelineServiceTest(unittest.TestCase):
    def test_expands_short_segment_without_overlapping_neighbors(self) -> None:
        rows = [
            {"id": "a", "text": "前一句", "start_ms": 0, "end_ms": 800},
            {
                "id": "b",
                "text": "这是一句比较长的内容，需要更合理的口播时间。",
                "start_ms": 1000,
                "end_ms": 1300,
            },
            {"id": "c", "text": "后一句", "start_ms": 2600, "end_ms": 3200},
        ]

        adjusted = apply_reasonable_dubbing_timeline(rows)

        self.assertEqual(adjusted[0]["end_ms"], 800)
        self.assertGreater(adjusted[1]["duration_ms"], 300)
        self.assertGreaterEqual(adjusted[1]["start_ms"], adjusted[0]["end_ms"] + 20)
        self.assertLessEqual(adjusted[1]["end_ms"], adjusted[2]["start_ms"] - 20)
        self.assertIn("timeline_adjustment", adjusted[1]["timing_check"])

    def test_preserves_overlapping_short_segments_instead_of_collapsing_them(self) -> None:
        rows = [
            {"id": "a", "text": "是合理的吗？", "start_ms": 229000, "end_ms": 229960},
            {"id": "b", "text": "评论区聊聊", "start_ms": 228740, "end_ms": 229660},
        ]

        adjusted = apply_reasonable_dubbing_timeline(rows)

        self.assertEqual([row["id"] for row in adjusted], ["a", "b"])
        self.assertEqual(adjusted[0]["text"], "是合理的吗？")
        self.assertGreater(adjusted[0]["end_ms"], adjusted[0]["start_ms"])
        self.assertEqual(adjusted[1]["text"], "评论区聊聊")
        self.assertGreaterEqual(adjusted[1]["end_ms"], 229660)
        self.assertGreater(adjusted[1]["end_ms"], adjusted[1]["start_ms"])

    def test_filters_timing_overrides_only_for_dubbing_timeline(self) -> None:
        overrides = {"duration": 1.2, "speed": 0.9, "denoise": True, "num_step": 20}

        self.assertEqual(filter_model_tts_overrides(overrides, dubbing_timeline=False), overrides)
        self.assertEqual(
            filter_model_tts_overrides(overrides, dubbing_timeline=True),
            {"denoise": True, "num_step": 20},
        )

    def test_dubbing_timeline_project_detection_and_fingerprint_target(self) -> None:
        project = Project(name="dub")
        project.script.metadata = {"dubbing_source": True}
        project.script.segments = [
            Segment(id="s1", index=0, text="hello", source_start_ms=100, source_end_ms=900),
        ]

        self.assertTrue(is_dubbing_timeline_project(config=project.synthesis_config, project=project))
        payload = fingerprint_tts_overrides(
            model_overrides={"denoise": True},
            segment=project.script.segments[0],
            dubbing_timeline=True,
        )
        self.assertEqual(payload["_timeline_target_duration_ms"], 800)
        self.assertIn("_timeline_stretch_policy_version", payload)

    def test_source_timeline_lock_requires_checkbox_and_source_timing(self) -> None:
        project = Project(name="dub")
        project.script.metadata = {"dubbing_source": True}
        project.script.segments = [
            Segment(id="s1", index=0, text="hello", source_start_ms=100, source_end_ms=900),
        ]

        self.assertTrue(is_dubbing_timeline_project(config=project.synthesis_config, project=project))
        self.assertFalse(is_source_timeline_lock_enabled(config=project.synthesis_config, project=project))

        project.synthesis_config.timeline_lock_enabled = True
        self.assertTrue(is_source_timeline_lock_enabled(config=project.synthesis_config, project=project))


if __name__ == "__main__":
    unittest.main()
