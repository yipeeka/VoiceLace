from __future__ import annotations

import unittest

from backend.engine.voxcpm2_adapter import build_voxcpm2_text_payload


class VoxCpm2AdapterTest(unittest.TestCase):
    def test_maps_and_filters_tags(self) -> None:
        payload = build_voxcpm2_text_payload(
            text="[laughter] [question-yi] 你今天来得好晚。",
            non_verbal=["[surprise-wa]", "[surprise-ah]"],
            emotion=None,
            speed=None,
        )
        self.assertIn("[laughing]", payload["text"])
        self.assertIn("[Surprise-wa]", payload["text"])
        self.assertNotIn("question-yi", payload["text"])
        self.assertNotIn("surprise-ah", payload["text"])

    def test_converts_inline_pinyin_to_braces(self) -> None:
        payload = build_voxcpm2_text_payload(
            text="他朝CHAO2门外走去。",
            non_verbal=[],
            emotion=None,
            speed=None,
        )
        self.assertIn("{chao2}", payload["text"])
        self.assertTrue(payload["has_phoneme"])

    def test_speed_generates_style_hint(self) -> None:
        payload = build_voxcpm2_text_payload(
            text="我们开始吧。",
            non_verbal=[],
            emotion="cheerful",
            speed=1.2,
        )
        self.assertIn("cheerful tone", payload["style_instruction"])
        self.assertIn("slightly faster", payload["style_instruction"])


if __name__ == "__main__":
    unittest.main()
