from __future__ import annotations

import asyncio
import shutil
import unittest
from unittest.mock import patch

from backend.config import settings
from backend.engine.asr_engine import ASREngine


class AsrEngineTest(unittest.TestCase):
    def test_parse_cuda_with_index(self) -> None:
        engine = ASREngine()
        whisper_device, faster_device, faster_index = engine._parse_device("cuda:1")
        self.assertEqual(whisper_device, "cuda:1")
        self.assertEqual(faster_device, "cuda")
        self.assertEqual(faster_index, 1)

    def test_parse_cpu(self) -> None:
        engine = ASREngine()
        whisper_device, faster_device, faster_index = engine._parse_device("cpu")
        self.assertEqual(whisper_device, "cpu")
        self.assertEqual(faster_device, "cpu")
        self.assertEqual(faster_index, 0)

    def test_transcribe_rejects_unsupported_backend(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-unsupported-backend"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()
            with self.assertRaises(ValueError):
                asyncio.run(engine.transcribe(str(wav_path), backend="unknown_backend", speaker_labels=False))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_command_build_and_parse_plain_text(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-crispasr"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            exe_path = temp_dir / "crispasr.exe"
            exe_path.write_bytes(b"exe")
            model_path = temp_dir / "qwen3.gguf"
            model_path.write_bytes(b"gguf")
            aligner_path = temp_dir / "qwen3-forced-aligner.gguf"
            aligner_path.write_bytes(b"gguf")

            engine = ASREngine()
            engine.crispasr_exe = str(exe_path)
            engine.qwen3_model_path = str(model_path)
            engine.qwen3_forced_aligner_model_path = str(aligner_path)
            engine.qwen3_language = "auto"
            engine.qwen3_threads = 2
            engine.qwen3_enable_timestamps = True

            calls = []

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            def fake_run(cmd, *args, **kwargs):
                calls.append(cmd)
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout="你好，世界", stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["backend"], "qwen3_crispasr")
            self.assertEqual(result["text"], "你好，世界")
            self.assertTrue(any(isinstance(cmd, list) and "--backend" in cmd and "qwen3" in cmd for cmd in calls))
            self.assertTrue(any(isinstance(cmd, list) and "-m" in cmd and str(model_path) in cmd for cmd in calls))
            self.assertTrue(any(isinstance(cmd, list) and "-f" in cmd for cmd in calls))
            self.assertTrue(any(isinstance(cmd, list) and "-am" in cmd and str(aligner_path) in cmd for cmd in calls))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_parses_inline_timestamps_into_alignments(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-inline-ts"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            exe_path = temp_dir / "crispasr.exe"
            exe_path.write_bytes(b"exe")
            model_path = temp_dir / "qwen3.gguf"
            model_path.write_bytes(b"gguf")

            engine = ASREngine()
            engine.crispasr_exe = str(exe_path)
            engine.qwen3_model_path = str(model_path)
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            inline_text = (
                "[00:00:00.480 --> 00:00:00.640] 雾 "
                "[00:00:00.640 --> 00:00:01.040] 未散 "
                "[00:00:01.280 --> 00:00:01.600] ， "
                "[00:00:01.600 --> 00:00:02.400] 城门外已经排起了长队。"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=inline_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["backend"], "qwen3_crispasr")
            self.assertTrue(result["alignments"])
            self.assertNotIn("[00:00:00", result["text"])
            first = result["alignments"][0]
            self.assertGreaterEqual(first.get("end_ms", 0), first.get("start_ms", 0))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_without_speaker_labels_skips_diarization(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-no-diar"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return "你好世界", [{"start": 0.0, "end": 1.0, "text": "你好世界"}], "faster-whisper"

            async def fake_diar(_: object):
                raise AssertionError("diarization should not be called")

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]
            engine._run_diarization = fake_diar  # type: ignore[assignment]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            self.assertEqual(result["text"], "你好世界")
            self.assertEqual(result["labeled_text"], "你好世界")
            self.assertFalse(result["speaker_labels"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_with_speaker_labels_uses_diarization(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-with-diar"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "你好\n谢谢",
                    [
                        {"start": 0.0, "end": 1.0, "text": "你好"},
                        {"start": 1.0, "end": 2.0, "text": "谢谢"},
                    ],
                    "faster-whisper",
                )

            async def fake_diar(_: object):
                return [
                    {"start": 0.0, "end": 1.1, "speaker": "SPEAKER_00"},
                    {"start": 1.1, "end": 2.0, "speaker": "SPEAKER_01"},
                ]

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]
            engine._run_diarization = fake_diar  # type: ignore[assignment]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=True))
            self.assertIn("说话人1：你好", result["labeled_text"])
            self.assertIn("说话人2：谢谢", result["labeled_text"])
            self.assertEqual(result["text"], "你好\n谢谢")
            self.assertTrue(result["speaker_labels"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_with_speaker_labels_raises_when_diarization_unavailable(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-diar-unavailable"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return "你好世界", [{"start": 0.0, "end": 1.0, "text": "你好世界"}], "openai-whisper"

            async def fake_diar(_: object):
                raise RuntimeError("未配置 pyannote token")

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]
            engine._run_diarization = fake_diar  # type: ignore[assignment]

            with self.assertRaises(RuntimeError):
                asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=True))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_load_audio_for_diarization_decodes_pcm_bytes(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-load-audio"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            pcm = b"\x00\x00\x80\x3f" * 4  # 4 float32 samples, each 1.0

            class _Proc:
                stdout = pcm
                stderr = b""

            import subprocess as real_subprocess

            original_run = real_subprocess.run

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc()
                return original_run(cmd, *args, **kwargs)

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                payload = ASREngine._load_audio_for_diarization(wav_path)

            self.assertEqual(payload["sample_rate"], 16000)
            waveform = payload["waveform"]
            self.assertEqual(tuple(waveform.shape), (1, 4))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_run_diarization_uses_memory_audio_payload(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-diar-memory-input"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            class _Turn:
                def __init__(self, start: float, end: float):
                    self.start = start
                    self.end = end

            class _Annotation:
                def itertracks(self, yield_label: bool = False):
                    if not yield_label:
                        return []
                    return iter([(_Turn(0.0, 1.0), None, "SPEAKER_00")])

            captured = {}

            class _Pipeline:
                def __call__(self, audio_input):
                    captured["audio_input"] = audio_input
                    return _Annotation()

            async def fake_ensure():
                return _Pipeline()

            def fake_load_audio(_: object):
                return {"waveform": "dummy-waveform", "sample_rate": 16000}

            engine._ensure_diarization_pipeline = fake_ensure  # type: ignore[assignment]
            engine._load_audio_for_diarization = fake_load_audio  # type: ignore[assignment]

            turns = asyncio.run(engine._run_diarization(wav_path))
            self.assertEqual(turns[0]["speaker"], "SPEAKER_00")
            self.assertIsInstance(captured.get("audio_input"), dict)
            self.assertEqual(captured["audio_input"]["sample_rate"], 16000)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
