from __future__ import annotations

import unittest

from backend.models import Project, Segment
from backend.services.tts_finalize_service import should_use_source_timeline


class TtsTimelinePolicyTest(unittest.TestCase):
    def test_voxcpm2_dubbing_project_uses_source_timeline(self) -> None:
        project = Project(name="dub")
        project.script.metadata = {"dubbing_source": True}
        project.script.segments = [Segment(id="s1", index=0, text="hello", source_start_ms=100, source_end_ms=900)]
        project.synthesis_config.tts_backend = "voxcpm2"
        project.synthesis_config.timeline_lock_enabled = True

        self.assertTrue(should_use_source_timeline(config=project.synthesis_config, project=project))

    def test_omnivoice_dubbing_project_without_lock_uses_gap_timeline(self) -> None:
        project = Project(name="dub")
        project.script.metadata = {"dubbing_source": True}
        project.script.segments = [Segment(id="s1", index=0, text="hello", source_start_ms=100, source_end_ms=900)]
        project.synthesis_config.tts_backend = "omnivoice"
        project.synthesis_config.timeline_lock_enabled = False

        self.assertFalse(should_use_source_timeline(config=project.synthesis_config, project=project))

    def test_timeline_lock_requires_source_timing(self) -> None:
        project = Project(name="plain")
        project.synthesis_config.timeline_lock_enabled = True

        self.assertFalse(should_use_source_timeline(config=project.synthesis_config, project=project))


if __name__ == "__main__":
    unittest.main()
