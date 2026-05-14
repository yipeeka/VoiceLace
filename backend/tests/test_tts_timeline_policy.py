from __future__ import annotations

import unittest

from backend.models import Project
from backend.services.tts_finalize_service import should_use_source_timeline


class TtsTimelinePolicyTest(unittest.TestCase):
    def test_voxcpm2_dubbing_project_does_not_force_source_timeline(self) -> None:
        project = Project(name="dub")
        project.script.metadata = {"dubbing_source": True}
        project.synthesis_config.tts_backend = "voxcpm2"
        project.synthesis_config.timeline_lock_enabled = True

        self.assertFalse(should_use_source_timeline(config=project.synthesis_config, project=project))

    def test_omnivoice_dubbing_project_uses_source_timeline(self) -> None:
        project = Project(name="dub")
        project.script.metadata = {"dubbing_source": True}
        project.synthesis_config.tts_backend = "omnivoice"
        project.synthesis_config.timeline_lock_enabled = False

        self.assertTrue(should_use_source_timeline(config=project.synthesis_config, project=project))


if __name__ == "__main__":
    unittest.main()
