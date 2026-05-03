from __future__ import annotations

import asyncio
import shutil
import unittest
from pathlib import Path
import uuid

from backend.engine.tts_engine import TTSEngine
from backend.models import VoicePreset


class _StopIterationModel:
    def generate(self, **kwargs):
        raise StopIteration()


class _CaptureModel:
    def __init__(self) -> None:
        self.kwargs = None

    def generate(self, **kwargs):
        import numpy as np

        self.kwargs = kwargs
        return np.array([0.1, -0.1, 0.05, -0.05], dtype=np.float32)


class TTSEngineTest(unittest.TestCase):
    def test_format_exception_message_includes_exception_type_when_detail_empty(self) -> None:
        engine = TTSEngine()
        message = engine._format_exception_message("VoxCPM2 运行失败", StopIteration())
        self.assertEqual(message, "VoxCPM2 运行失败: StopIteration")

    def test_fallback_or_raise_rejects_mock_when_not_allowed(self) -> None:
        engine = TTSEngine()
        with self.assertRaises(RuntimeError) as ctx:
            engine._fallback_or_raise("boom", allow_mock=False)
        self.assertEqual(str(ctx.exception), "boom")
        self.assertEqual(engine.last_error, "boom")
        self.assertEqual(engine.backend_name, "mock")

    def test_voxcpm2_stop_iteration_surfaces_non_mock_error(self) -> None:
        engine = TTSEngine()
        engine.backend_name = "voxcpm2"
        engine.is_loaded = True
        engine._model = _StopIterationModel()
        tmp_dir = Path.cwd() / "tmp_test_outputs" / f"beautyvoice-tts-test-{uuid.uuid4().hex[:8]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        output_path = tmp_dir / "out.wav"
        with self.assertRaises(RuntimeError) as ctx:
            engine._synthesize_to_file_sync("测试", output_path)
        message = str(ctx.exception)
        self.assertIn("VoxCPM2 运行失败: RuntimeError: VoxCPM.generate 未返回任何音频帧", message)
        self.assertEqual(engine.backend_name, "voxcpm2")

    def test_unload_model_clears_error_status(self) -> None:
        engine = TTSEngine()
        engine.is_loaded = True
        engine.backend_name = "voxcpm2"
        engine.last_error = "VoxCPM2 运行失败: RuntimeError"
        engine._model = object()

        asyncio.run(engine.unload_model())

        self.assertFalse(engine.is_loaded)
        self.assertIsNone(engine._model)
        self.assertEqual(engine.backend_name, "unloaded")
        self.assertEqual(engine.last_error, "")

    def test_voxcpm2_clone_control_instruction_prefixes_hifi_text(self) -> None:
        engine = TTSEngine()
        engine.backend_name = "voxcpm2"
        engine.is_loaded = True
        capture_model = _CaptureModel()
        engine._model = capture_model
        tmp_dir = Path.cwd() / "tmp_test_outputs" / f"voxcpm-control-{uuid.uuid4().hex[:8]}"
        ref_path = tmp_dir / "ref.wav"
        output_path = tmp_dir / "out.wav"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        ref_path.write_bytes(b"fake")
        preset = VoicePreset(
            name="clone-control",
            backend_profiles={
                "voxcpm2": {
                    "voice_mode": "clone",
                    "ref_audio_path": str(ref_path),
                    "ref_text": "参考文本",
                    "use_hifi_clone": True,
                    "control_instruction": "更悲伤，语速稍慢",
                }
            },
        )

        try:
            engine._synthesize_to_file_sync("您好", output_path, preset=preset)

            self.assertEqual(capture_model.kwargs["text"], "(更悲伤，语速稍慢)您好")
            self.assertEqual(capture_model.kwargs["reference_wav_path"], str(ref_path))
            self.assertEqual(capture_model.kwargs["prompt_wav_path"], str(ref_path))
            self.assertEqual(capture_model.kwargs["prompt_text"], "参考文本")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
