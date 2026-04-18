from __future__ import annotations

import unittest

from backend.models import Script, Segment
from backend.services.project_script_service import segment_content_payload, sync_script_metadata


class ProjectScriptServiceTest(unittest.TestCase):
    def test_sync_script_metadata_updates_indices_and_characters(self) -> None:
        script = Script(
            segments=[
                Segment(index=8, speaker="A", text="one"),
                Segment(index=3, speaker="B", text="two"),
                Segment(index=6, speaker="A", text="three"),
            ]
        )

        synced = sync_script_metadata(script)

        self.assertEqual([seg.index for seg in synced.segments], [0, 1, 2])
        by_name = {character.name: character.appearance_count for character in synced.characters}
        self.assertEqual(by_name["A"], 2)
        self.assertEqual(by_name["B"], 1)

    def test_segment_content_payload_contains_stable_fields(self) -> None:
        segment = Segment(
            speaker="narrator",
            text="hello",
            type="narration",
            emotion="serious",
            non_verbal=["laugh"],
            tts_overrides={"speed": 1.1},
        )

        payload = segment_content_payload(segment)

        self.assertEqual(payload["speaker"], "narrator")
        self.assertEqual(payload["text"], "hello")
        self.assertEqual(payload["type"], "narration")
        self.assertEqual(payload["emotion"], "serious")
        self.assertEqual(payload["non_verbal"], ["laugh"])
        self.assertEqual(payload["tts_overrides"], {"speed": 1.1})


if __name__ == "__main__":
    unittest.main()
