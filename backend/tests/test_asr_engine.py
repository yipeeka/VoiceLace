from __future__ import annotations

import unittest

from backend.engine.asr_engine import ASREngine


class AsrEngineDeviceParseTest(unittest.TestCase):
    def test_parse_cuda_with_index(self) -> None:
        engine = ASREngine()
        whisper_device, faster_device, faster_index = engine._parse_device("cuda:1")
        self.assertEqual(whisper_device, "cuda:1")
        self.assertEqual(faster_device, "cuda")
        self.assertEqual(faster_index, 1)

    def test_parse_cuda_without_index(self) -> None:
        engine = ASREngine()
        whisper_device, faster_device, faster_index = engine._parse_device("cuda")
        self.assertEqual(whisper_device, "cuda:0")
        self.assertEqual(faster_device, "cuda")
        self.assertEqual(faster_index, 0)

    def test_parse_cpu(self) -> None:
        engine = ASREngine()
        whisper_device, faster_device, faster_index = engine._parse_device("cpu")
        self.assertEqual(whisper_device, "cpu")
        self.assertEqual(faster_device, "cpu")
        self.assertEqual(faster_index, 0)


if __name__ == "__main__":
    unittest.main()
