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
            self.assertTrue(any(isinstance(cmd, list) and "-osrt" in cmd and "-ml" in cmd and "1" in cmd for cmd in calls))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_timestamps_require_forced_aligner(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-missing-aligner"
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

            with self.assertRaisesRegex(RuntimeError, "ForcedAligner"):
                asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))
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
            engine.qwen3_enable_timestamps = False

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

    def test_qwen3_crispasr_parses_srt_timestamps_into_alignments(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-srt-ts"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = "1\n00:00:00,320 --> 00:00:00,560\nAnd\n\n2\n00:00:00,960 --> 00:00:01,280\nmy\n"

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["text"], "And\nmy")
            self.assertEqual(len(result["alignments"]), 2)
            self.assertEqual(result["alignments"][0]["start_ms"], 320)
            self.assertEqual(result["alignments"][1]["end_ms"], 1280)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_merges_trailing_punctuation_fragments_without_extending_time(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-tail-fragments"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:10,800 --> 00:00:11,680\n叫“老人遗骸\n\n"
                "2\n00:00:16,000 --> 00:00:16,480\n”\n\n"
                "3\n00:00:16,960 --> 00:00:17,040\n吧。\n\n"
                "4\n00:00:17,040 --> 00:00:18,320\n好，新建，\n\n"
                "5\n00:00:19,120 --> 00:00:19,920\n然后把\n\n"
                "6\n00:00:20,720 --> 00:00:22,480\n要生成的文本\n\n"
                "7\n00:00:24,880 --> 00:00:25,680\n贴进来。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "叫“老人遗骸”吧。")
            self.assertEqual(result["alignments"][0]["start_ms"], 10800)
            self.assertEqual(result["alignments"][0]["end_ms"], 11680)
            self.assertEqual(result["alignments"][1]["text"], "好，新建，")
            self.assertTrue(any("尾随短片段" in warning for warning in result["warnings"]))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_merges_single_punctuation_after_complete_phrase(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-single-punctuation"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:01:23,180 --> 00:01:24,220\n设为背景音乐\n\n"
                "2\n00:01:24,860 --> 00:01:25,100\n。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(len(result["alignments"]), 1)
            self.assertEqual(result["alignments"][0]["text"], "设为背景音乐。")
            self.assertEqual(result["alignments"][0]["start_ms"], 83180)
            self.assertEqual(result["alignments"][0]["end_ms"], 84220)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_moves_leading_punctuation_to_previous_segment(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-leading-punctuation"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:15,360 --> 00:00:16,880\n他的双手常用绳索拉\n\n"
                "2\n00:00:18,480 --> 00:00:19,040\n大鱼，\n\n"
                "3\n00:00:20,560 --> 00:00:20,720\n留下了刻得很深的伤疤。\n\n"
                "4\n00:00:20,720 --> 00:00:23,120\n但是这些伤疤中没有一块是新的\n\n"
                "5\n00:00:24,000 --> 00:00:25,920\n，它们像无鱼可打的沙漠中。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "他的双手常用绳索拉大鱼，")
            self.assertEqual(result["alignments"][0]["end_ms"], 16880)
            self.assertEqual(result["alignments"][2]["text"], "但是这些伤疤中没有一块是新的，")
            self.assertEqual(result["alignments"][2]["end_ms"], 23120)
            self.assertEqual(result["alignments"][3]["text"], "它们像无鱼可打的沙漠中。")
            self.assertEqual(result["alignments"][3]["start_ms"], 24000)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_moves_short_leading_phrase_through_comma(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-leading-phrase"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:15,360 --> 00:00:16,880\n他的双手常用绳索拉\n\n"
                "2\n00:00:18,480 --> 00:00:19,040\n大鱼，\n\n"
                "3\n00:00:58,160 --> 00:00:58,720\n跟着有三个礼\n\n"
                "4\n00:00:59,360 --> 00:01:00,400\n拜，我们每天都逮住了大鱼。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "他的双手常用绳索拉大鱼，")
            self.assertEqual(result["alignments"][0]["end_ms"], 16880)
            self.assertEqual(result["alignments"][1]["text"], "跟着有三个礼拜，")
            self.assertEqual(result["alignments"][1]["end_ms"], 58720)
            self.assertEqual(result["alignments"][2]["text"], "我们每天都逮住了大鱼。")
            self.assertEqual(result["alignments"][2]["start_ms"], 59360)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_keeps_discourse_starter_as_own_segment(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-discourse-starter"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:15,120 --> 00:00:16,000\n首先，先加载模型\n\n"
                "2\n00:00:16,200 --> 00:00:16,400\n然后，\n\n"
                "3\n00:00:16,600 --> 00:00:18,000\n进入下一步。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "首先，先加载模型")
            self.assertEqual(result["alignments"][1]["text"], "然后，")
            self.assertEqual(result["alignments"][1]["start_ms"], 16200)
            self.assertEqual(result["alignments"][1]["end_ms"], 16400)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_merges_known_split_compound_boundaries(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-compound-boundaries"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:01,040 --> 00:00:01,920\n今天介绍一\n\n"
                "2\n00:00:02,800 --> 00:00:03,760\n下Voice Lens的\n\n"
                "3\n00:00:07,680 --> 00:00:10,160\n现在我们先建立一个新的项目，就\n\n"
                "4\n00:00:10,800 --> 00:00:11,680\n叫“老人遗海”吧。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "今天介绍一下")
            self.assertEqual(result["alignments"][0]["start_ms"], 1040)
            self.assertEqual(result["alignments"][0]["end_ms"], 1920)
            self.assertEqual(result["alignments"][1]["text"], "Voice Lens的")
            self.assertEqual(result["alignments"][1]["start_ms"], 2800)
            self.assertEqual(result["alignments"][1]["end_ms"], 3760)
            self.assertEqual(result["alignments"][2]["text"], "现在我们先建立一个新的项目，就叫")
            self.assertEqual(result["alignments"][2]["start_ms"], 7680)
            self.assertEqual(result["alignments"][2]["end_ms"], 10160)
            self.assertEqual(result["alignments"][3]["text"], "“老人遗海”吧。")
            self.assertEqual(result["alignments"][3]["start_ms"], 10800)
            self.assertEqual(result["alignments"][3]["end_ms"], 11680)
            compound_repairs = [item for item in result["timeline_repairs"] if item.get("kind") == "compound_boundary"]
            self.assertEqual([item.get("moved_text") for item in compound_repairs], ["下", "叫"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_uses_boundary_word_dictionary(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-boundary-dict"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:01,000 --> 00:00:02,000\n先加\n\n"
                "2\n00:00:02,400 --> 00:00:03,000\n载模型\n\n"
                "3\n00:00:04,000 --> 00:00:05,000\n进入配\n\n"
                "4\n00:00:05,400 --> 00:00:06,000\n置页面\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "先加载")
            self.assertEqual(result["alignments"][1]["text"], "模型")
            self.assertEqual(result["alignments"][2]["text"], "进入配置")
            self.assertEqual(result["alignments"][3]["text"], "页面")
            compound_repairs = [item for item in result["timeline_repairs"] if item.get("kind") == "compound_boundary"]
            self.assertEqual([item.get("moved_text") for item in compound_repairs], ["载", "置"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_uses_jieba_for_unknown_boundary_word(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-jieba-boundary"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:01,000 --> 00:00:02,000\n打开用\n\n"
                "2\n00:00:02,400 --> 00:00:03,000\n户设置\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "打开用户")
            self.assertEqual(result["alignments"][1]["text"], "设置")
            compound_repairs = [item for item in result["timeline_repairs"] if item.get("kind") == "compound_boundary"]
            self.assertIn("户", [item.get("moved_text") for item in compound_repairs])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_moves_trailing_open_quote_to_next_segment(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-trailing-opener"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:21,120 --> 00:00:22,960\n然后，比如说我们刚才生成的“\n\n"
                "2\n00:00:23,680 --> 00:00:26,080\n老人遗海”的项目，我们就可以。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "然后，比如说我们刚才生成的")
            self.assertEqual(result["alignments"][1]["text"], "“老人遗海”的项目，我们就可以。")
            self.assertTrue(any(item.get("kind") == "trailing_opener" for item in result["timeline_repairs"]))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_repairs_need_split_boundary_only(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-need-boundary"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:32,820 --> 00:00:33,620\n他说：“我只需\n\n"
                "2\n00:00:33,820 --> 00:00:38,187\n要音乐。”再输入，不需要人声。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "他说：“我只需要")
            self.assertEqual(result["alignments"][1]["text"], "音乐。”再输入，不需要人声。")
            compound_repairs = [item for item in result["timeline_repairs"] if item.get("kind") == "compound_boundary"]
            self.assertIn("要", [item.get("moved_text") for item in compound_repairs])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_repairs_long_text_with_too_short_timing(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-short-timing"
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
            engine.qwen3_enable_timestamps = True

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:15,360 --> 00:00:16,880\n他的双手常用绳索拉大鱼，\n\n"
                "2\n00:00:20,560 --> 00:00:20,720\n留下了刻得很深的伤疤。\n\n"
                "3\n00:00:20,720 --> 00:00:23,120\n但是这些伤疤中没有一块是新的。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][1]["text"], "留下了刻得很深的伤疤。")
            self.assertEqual(result["alignments"][1]["start_ms"], 17080)
            self.assertEqual(result["alignments"][1]["end_ms"], 20520)
            self.assertTrue(any("过短时间轴" in warning for warning in result["warnings"]))
            self.assertTrue(any(item.get("kind") == "short_timing" for item in result["timeline_repairs"]))
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

    def test_transcribe_tightens_segment_bounds_from_word_timestamps(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-word-timing"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "我们试听一下效果",
                    [
                        {
                            "start": 92.780,
                            "end": 104.510,
                            "text": "我们试听一下效果",
                            "words": [
                                {"start": 93.000, "end": 93.700, "word": "我们"},
                                {"start": 93.820, "end": 94.500, "word": "试听"},
                                {"start": 94.650, "end": 95.100, "word": "一下"},
                                {"start": 95.260, "end": 96.700, "word": "效果"},
                            ],
                        }
                    ],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            segment = result["alignments"][0]
            self.assertEqual(segment["start_ms"], 92920)
            self.assertEqual(segment["end_ms"], 96780)
            self.assertIn("已矫正 1 个异常过长或过宽的识别时间轴片段。", result["warnings"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_short_text_fallback_trims_suspiciously_long_segment(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-long-short-text"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "我们试听一下效果",
                    [{"start": 92.780, "end": 104.510, "text": "我们试听一下效果"}],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            segment = result["alignments"][0]
            self.assertEqual(segment["start_ms"], 92780)
            self.assertLessEqual(segment["end_ms"] - segment["start_ms"], 4000)
            self.assertGreater(segment["end_ms"] - segment["start_ms"], 2500)
            self.assertIn("已矫正 1 个异常过长或过宽的识别时间轴片段。", result["warnings"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_splits_word_timestamps_on_long_internal_silence(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-split-word-gap"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "解析完成后，进入基础编辑页面。",
                    [
                        {
                            "start": 36.990,
                            "end": 48.900,
                            "text": "解析完成后，进入基础编辑页面。",
                            "words": [
                                {"start": 37.150, "end": 37.700, "word": "解析"},
                                {"start": 37.760, "end": 38.200, "word": "完成"},
                                {"start": 38.260, "end": 38.620, "word": "后，"},
                                {"start": 45.200, "end": 45.580, "word": "进入"},
                                {"start": 45.640, "end": 46.380, "word": "基础"},
                                {"start": 46.440, "end": 47.120, "word": "编辑"},
                                {"start": 47.180, "end": 47.760, "word": "页面。"},
                            ],
                        }
                    ],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            self.assertEqual(len(result["alignments"]), 2)
            self.assertEqual(result["alignments"][0]["text"], "解析完成后，")
            self.assertEqual(result["alignments"][1]["text"], "进入基础编辑页面。")
            self.assertLessEqual(result["alignments"][0]["end_ms"], 38800)
            self.assertGreaterEqual(result["alignments"][1]["start_ms"], 45100)
            self.assertIn("已按词间静音自动拆分 1 个识别片段。", result["warnings"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_keeps_word_gap_below_split_threshold_together(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-keep-short-word-gap"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "解析完成后，进入基础编辑页面。",
                    [
                        {
                            "start": 36.990,
                            "end": 42.900,
                            "text": "解析完成后，进入基础编辑页面。",
                            "words": [
                                {"start": 37.150, "end": 37.700, "word": "解析"},
                                {"start": 37.760, "end": 38.200, "word": "完成"},
                                {"start": 38.260, "end": 38.620, "word": "后，"},
                                {"start": 39.300, "end": 40.200, "word": "进入"},
                                {"start": 40.260, "end": 40.900, "word": "基础"},
                                {"start": 40.960, "end": 41.520, "word": "编辑"},
                                {"start": 41.580, "end": 42.100, "word": "页面。"},
                            ],
                        }
                    ],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            self.assertEqual(len(result["alignments"]), 1)
            self.assertEqual(result["alignments"][0]["text"], "解析完成后，进入基础编辑页面。")
            self.assertNotIn("已按词间静音自动拆分 1 个识别片段。", result["warnings"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_prefers_detected_silence_boundaries_for_split(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-silence-boundary-split"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "解析完成后，进入基础编辑页面。",
                    [
                        {
                            "start": 36.990,
                            "end": 48.900,
                            "text": "解析完成后，进入基础编辑页面。",
                            "words": [
                                {"start": 37.150, "end": 37.700, "word": "解析"},
                                {"start": 37.760, "end": 38.200, "word": "完成"},
                                {"start": 38.260, "end": 38.620, "word": "后，"},
                                {"start": 45.200, "end": 45.580, "word": "进入"},
                                {"start": 45.640, "end": 46.380, "word": "基础"},
                                {"start": 46.440, "end": 47.120, "word": "编辑"},
                                {"start": 47.180, "end": 47.760, "word": "页面。"},
                            ],
                        }
                    ],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]
            engine._detect_silence_ranges = lambda _path: [{"start": 39.0, "end": 44.0}]  # type: ignore[method-assign]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            self.assertEqual(len(result["alignments"]), 2)
            self.assertEqual(result["alignments"][0]["end_ms"], 39000)
            self.assertEqual(result["alignments"][1]["start_ms"], 44000)
            self.assertIn("已避开 1 段长静音区域切分识别片段。", result["warnings"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_can_disable_silence_aware_split(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-silence-split-disabled"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "解析完成后，进入基础编辑页面。",
                    [
                        {
                            "start": 36.990,
                            "end": 48.900,
                            "text": "解析完成后，进入基础编辑页面。",
                            "words": [
                                {"start": 37.150, "end": 37.700, "word": "解析"},
                                {"start": 37.760, "end": 38.200, "word": "完成"},
                                {"start": 38.260, "end": 38.620, "word": "后，"},
                                {"start": 45.200, "end": 45.580, "word": "进入"},
                                {"start": 45.640, "end": 46.380, "word": "基础"},
                                {"start": 46.440, "end": 47.120, "word": "编辑"},
                                {"start": 47.180, "end": 47.760, "word": "页面。"},
                            ],
                        }
                    ],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]
            engine._detect_silence_ranges = lambda _path: [{"start": 39.0, "end": 44.0}]  # type: ignore[method-assign]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False, silence_aware_split=False))
            self.assertEqual(len(result["alignments"]), 2)
            self.assertLess(result["alignments"][0]["end_ms"], 39000)
            self.assertGreater(result["alignments"][1]["start_ms"], 44000)
            self.assertNotIn("已避开 1 段长静音区域切分识别片段。", result["warnings"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_silence_ranges_keep_millisecond_precision(self) -> None:
        result = ASREngine._normalize_silence_ranges([
            {"start": 36.9234, "end": 44.8765},
        ])
        self.assertEqual(result, [{"start": 36.923, "end": 44.877}])

    def test_transcribe_merges_split_groups_shorter_than_min_duration(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-merge-short-split"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "好，进入基础编辑页面。",
                    [
                        {
                            "start": 36.990,
                            "end": 42.900,
                            "text": "好，进入基础编辑页面。",
                            "words": [
                                {"start": 37.150, "end": 37.520, "word": "好，"},
                                {"start": 39.200, "end": 39.580, "word": "进入"},
                                {"start": 39.640, "end": 40.280, "word": "基础"},
                                {"start": 40.340, "end": 40.900, "word": "编辑"},
                                {"start": 40.960, "end": 41.480, "word": "页面。"},
                            ],
                        }
                    ],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            self.assertEqual(len(result["alignments"]), 1)
            self.assertEqual(result["alignments"][0]["text"], "好，进入基础编辑页面。")
            self.assertGreaterEqual(result["alignments"][0]["start_ms"], 39100)
            self.assertNotIn("已按词间静音自动拆分 1 个识别片段。", result["warnings"])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_transcribe_removes_segments_that_become_short_after_silence_boundaries(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-merge-boundary-short-split"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(_: object):
                return (
                    "点击开始解析按钮。\n解析完成后，进入基础编辑页面。",
                    [
                        {
                            "start": 25.460,
                            "end": 31.550,
                            "text": "点击开始解析按钮。",
                            "words": [
                                {"start": 25.100, "end": 25.380, "word": "点"},
                                {"start": 26.700, "end": 26.900, "word": "击"},
                                {"start": 26.960, "end": 27.560, "word": "开始"},
                                {"start": 27.620, "end": 28.180, "word": "解析"},
                                {"start": 28.240, "end": 28.820, "word": "按钮。"},
                            ],
                        },
                        {
                            "start": 36.990,
                            "end": 48.900,
                            "text": "解析完成后，进入基础编辑页面。",
                            "words": [
                                {"start": 37.050, "end": 37.120, "word": "解"},
                                {"start": 38.300, "end": 38.520, "word": "析"},
                                {"start": 38.580, "end": 39.120, "word": "完成"},
                                {"start": 39.180, "end": 39.540, "word": "后，"},
                                {"start": 45.200, "end": 45.580, "word": "进入"},
                                {"start": 45.640, "end": 46.380, "word": "基础"},
                                {"start": 46.440, "end": 47.120, "word": "编辑"},
                                {"start": 47.180, "end": 47.760, "word": "页面。"},
                            ],
                        },
                    ],
                    "faster-whisper",
                )

            engine._transcribe_whisper_segments = fake_transcribe  # type: ignore[assignment]
            engine._detect_silence_ranges = lambda _path: [  # type: ignore[method-assign]
                {"start": 25.460, "end": 26.500},
                {"start": 37.120, "end": 38.000},
                {"start": 40.000, "end": 44.000},
            ]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="whisper", speaker_labels=False))
            self.assertEqual([item["text"] for item in result["alignments"]], [
                "点击开始解析按钮。",
                "解析完成后，",
                "进入基础编辑页面。",
            ])
            for item in result["alignments"]:
                self.assertLess(item["start_ms"], item["end_ms"])
                self.assertGreaterEqual(item["end_ms"] - item["start_ms"], 700)
            self.assertEqual(result["alignments"][0]["start_ms"], 26500)
            self.assertEqual(result["alignments"][1]["start_ms"], 38000)
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
