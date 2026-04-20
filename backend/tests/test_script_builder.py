from __future__ import annotations

import unittest

from backend.engine.script_builder import build_script_from_model_payload


class ScriptBuilderTest(unittest.TestCase):
    def test_build_script_sanitizes_nested_metadata_values(self) -> None:
        payload = {
            "title": "t",
            "segments": [
                {
                    "type": "narration",
                    "speaker": "narrator",
                    "text": "这是一个用于测试 metadata 的有效片段文本。",
                }
            ],
            "metadata": {
                "language": "zh",
                "pronunciation_hints": {"倒了血霉": "DAO3 LE5 XUE4 MEI2"},
                "flags": ["a", "b"],
            },
        }
        script = build_script_from_model_payload("这是一个用于测试 metadata 的有效片段文本。", payload, "gemini")
        self.assertEqual(script.metadata["language"], "zh")
        self.assertIsInstance(script.metadata["pronunciation_hints"], str)
        self.assertIn("倒了血霉", script.metadata["pronunciation_hints"])
        self.assertIsInstance(script.metadata["flags"], str)
        self.assertEqual(script.metadata["parser"], "gemini")


if __name__ == "__main__":
    unittest.main()
