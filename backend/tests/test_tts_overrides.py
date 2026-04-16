from __future__ import annotations

import unittest

from backend.engine.tts_overrides import normalize_tts_overrides


class TtsOverridesTest(unittest.TestCase):
    def test_none_returns_empty_dict(self) -> None:
        self.assertEqual(normalize_tts_overrides(None), {})

    def test_normalize_supported_fields(self) -> None:
        result = normalize_tts_overrides(
            {
                "speed": 1,
                "duration": 4.2,
                "denoise": True,
                "num_step": 20,
                "guidance_scale": 2,
            }
        )
        self.assertEqual(
            result,
            {
                "speed": 1.0,
                "duration": 4.2,
                "denoise": True,
                "num_step": 20,
                "guidance_scale": 2.0,
            },
        )

    def test_reject_unknown_field(self) -> None:
        with self.assertRaisesRegex(ValueError, "Unsupported tts_overrides field"):
            normalize_tts_overrides({"temperature": 0.3})

    def test_reject_invalid_type(self) -> None:
        with self.assertRaisesRegex(ValueError, "tts_overrides.num_step must be an integer"):
            normalize_tts_overrides({"num_step": 12.5})

    def test_reject_out_of_range(self) -> None:
        with self.assertRaisesRegex(ValueError, "tts_overrides.speed must be between 0.5 and 2.0"):
            normalize_tts_overrides({"speed": 2.5})


if __name__ == "__main__":
    unittest.main()
