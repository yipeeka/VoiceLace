from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

MODULE_PATH = Path(__file__).resolve().parents[1] / "services" / "music_assist_params.py"
spec = importlib.util.spec_from_file_location("music_assist_params", MODULE_PATH)
music_assist_params = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(music_assist_params)

coerce_allowed_string = music_assist_params.coerce_allowed_string
nearest_allowed_int = music_assist_params.nearest_allowed_int


class MusicAssistNormalizationTests(unittest.TestCase):
    def test_bpm_uses_nearest_allowed_option(self) -> None:
        allowed_bpms = {60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 180}

        self.assertEqual(nearest_allowed_int(72, allowed_bpms), 70)
        self.assertEqual(nearest_allowed_int(76, allowed_bpms), 80)

    def test_string_options_are_matched_case_insensitively(self) -> None:
        self.assertEqual(coerce_allowed_string(" c major ", {"C major", "G major"}), "C major")
        self.assertEqual(coerce_allowed_string(" 4/4 ", {"4/4", "3/4"}), "4/4")
        self.assertIsNone(coerce_allowed_string("8/8", {"4/4", "3/4"}))


if __name__ == "__main__":
    unittest.main()
