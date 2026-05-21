from __future__ import annotations

import asyncio
import json
import re
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
            crisp_cmds = [cmd for cmd in calls if isinstance(cmd, list) and "--backend" in cmd]
            self.assertEqual(len(crisp_cmds), 1)
            cmd = crisp_cmds[0]
            self.assertIn("--vad", cmd)
            self.assertIn("-osrt", cmd)
            self.assertIn("-ojf", cmd)
            self.assertIn("--split-on-punct", cmd)
            self.assertIn("-of", cmd)
            self.assertNotIn("-ml", cmd)
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

    def test_qwen3_crispasr_transcribe_does_not_pass_preview_line_length_to_ml(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-preview-ml"
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
                asyncio.run(
                    engine.transcribe(
                        str(wav_path),
                        backend="qwen3_crispasr",
                        speaker_labels=False,
                        qwen3_preview_max_line_length=30,
                    )
                )

            crisp_cmds = [cmd for cmd in calls if isinstance(cmd, list) and "--backend" in cmd]
            self.assertEqual(len(crisp_cmds), 1)
            self.assertNotIn("-ml", crisp_cmds[0])

            calls.clear()
            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                asyncio.run(
                    engine.transcribe(
                        str(wav_path),
                        backend="qwen3_crispasr",
                        speaker_labels=False,
                        qwen3_preview_max_line_length=-1,
                    )
                )
            crisp_cmds = [cmd for cmd in calls if isinstance(cmd, list) and "--backend" in cmd]
            self.assertEqual(len(crisp_cmds), 1)
            self.assertNotIn("-ml", crisp_cmds[0])
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_plain_text_can_request_punctuation_split_without_ml(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-split-ml"
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
                return _Proc(returncode=0, stdout="第一句。\n第二句。", stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                raw_text, segments, backend = asyncio.run(
                    engine._transcribe_crispasr_segments(
                        wav_path,
                        split_on_punctuation=True,
                        max_line_length=30,
                    )
                )

            self.assertEqual(backend, "qwen3_crispasr")
            self.assertIn("第一句", raw_text)
            crisp_cmds = [cmd for cmd in calls if isinstance(cmd, list) and "--backend" in cmd]
            self.assertEqual(len(crisp_cmds), 1)
            cmd = crisp_cmds[0]
            self.assertIn("--split-on-punct", cmd)
            self.assertNotIn("-ml", cmd)
            self.assertEqual(segments[0]["text"], "第一句。\n第二句。")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_hybrid_qwen_text_segments_split_long_preview_lines_on_natural_breaks(self) -> None:
        text = (
            "而且福利根本不止这些，孩子从幼儿园到大学全免费，十五个州的公立大学连学费都免，"
            "就交一百多欧的注册费，还送全州公交地铁票，全家医保更是顶配，公立医保覆盖所有基础治疗，"
            "看牙配眼镜都能报。"
        )

        rows = ASREngine._build_qwen_text_segments(
            text,
            [{"text": text}],
            max_line_length=20,
        )

        self.assertGreater(len(rows), 1)
        self.assertEqual("".join(row["text"] for row in rows), text)
        self.assertTrue(any(row["text"].endswith("，") for row in rows[:-1]))
        self.assertTrue(all(ASREngine._preview_line_text_length(row["text"]) <= 20 for row in rows))

    def test_hybrid_qwen_text_segments_do_not_hard_cut_without_breaks(self) -> None:
        text = "这是一个没有任何自然停顿所以不能被硬切开的超长识别片段"

        rows = ASREngine._build_qwen_text_segments(
            text,
            [{"text": text}],
            max_line_length=10,
        )

        self.assertEqual(rows, [{"text": text, "speaker": ""}])

    def test_hybrid_qwen_text_segments_keep_crispasr_rows_until_too_long(self) -> None:
        rows = ASREngine._build_qwen_text_segments(
            "",
            [
                {"text": "第一句；第二句"},
                {"text": "第三句，第四句"},
            ],
            max_line_length=20,
        )

        self.assertEqual(
            rows,
            [
                {"text": "第一句；第二句", "speaker": ""},
                {"text": "第三句，第四句", "speaker": ""},
            ],
        )

    def test_hybrid_qwen_text_segments_split_only_standalone_weak_breaks(self) -> None:
        text = "他说这句话，”然后继续说明，后面才可以拆分，最后也可以拆分。"

        rows = ASREngine._build_qwen_text_segments(
            text,
            [{"text": text}],
            max_line_length=8,
        )

        self.assertEqual("".join(row["text"] for row in rows), text)
        self.assertIn("他说这句话，”然后继续说明，", [row["text"] for row in rows])
        self.assertFalse(any(row["text"].endswith("，") and next_row["text"].startswith("”") for row, next_row in zip(rows, rows[1:])))
        self.assertGreater(len(rows), 1)

    def test_hybrid_qwen_text_segments_keep_closing_quote_with_sentence_punctuation(self) -> None:
        rows = ASREngine._build_qwen_text_segments(
            "",
            [
                {"text": "老周朝超前挪了两步，又回头对儿子说道：“把包袱扎紧，别散了。"},
                {"text": "”我省得。"},
                {"text": "旁边卖粥的汉子吆喝道：“热粥，新熬的热粥，一碗几文？"},
                {"text": "两文一碗，童叟无欺。"},
                {"text": "”说话间，城楼上鼓声三下，队伍忽然一阵骚动。"},
            ],
            max_line_length=20,
        )

        joined = "".join(row["text"] for row in rows)
        self.assertIn("别散了。”我省得。", joined)
        self.assertIn("说道：“把包袱扎紧", joined)
        self.assertIn("吆喝道：“热粥", joined)
        self.assertEqual(
            joined,
            "老周朝超前挪了两步，又回头对儿子说道：“把包袱扎紧，别散了。”我省得。"
            "旁边卖粥的汉子吆喝道：“热粥，新熬的热粥，一碗几文？两文一碗，童叟无欺。”"
            "说话间，城楼上鼓声三下，队伍忽然一阵骚动。",
        )
        self.assertFalse(any(row["text"].startswith("”") for row in rows))

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
            self.assertTrue(any("未找到 JSON full" in warning for warning in result["warnings"]))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_preview_final_audio_bounds_clamps_out_of_audio_alignment(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-preview-audio-bounds"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            async def fake_transcribe(*args, **kwargs):
                return (
                    "第四，也有相应的惩罚。\n失联三十天，直接停掉所有补助。",
                    [
                        {
                            "start": 128.460,
                            "end": 135.660,
                            "text": "第四，也有相应的惩罚。",
                        },
                        {
                            "start": 179.510,
                            "end": 179.511,
                            "text": "失联三十天，直接停掉所有补助。",
                        },
                    ],
                    "qwen3_crispasr",
                )

            engine._transcribe_crispasr_segments = fake_transcribe  # type: ignore[assignment]
            engine._probe_audio_duration_seconds = lambda _path: 149.916  # type: ignore[method-assign]
            engine._repair_qwen3_short_timings = lambda segments: (segments, 0, [])  # type: ignore[method-assign]

            result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False, enable_timestamps=True))

            self.assertTrue(result["alignments"])
            self.assertTrue(all(item["end_ms"] <= 149916 for item in result["alignments"]))
            self.assertTrue(all(item["end_ms"] > item["start_ms"] for item in result["alignments"]))
            reports = [item for item in result["timeline_repairs"] if item.get("kind") == "qwen3_preview_audio_bounds"]
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0]["audio_duration_ms"], 149916)
            self.assertGreaterEqual(reports[0]["out_of_audio_before"], 1)
            self.assertEqual(reports[0]["out_of_audio_after"], 0)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_preview_srt_fallback_still_clamps_to_audio_duration(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-srt-fallback-audio-bounds"
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
                def __init__(self, returncode=0, stdout=b"", stderr=b""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:02:08,460 --> 00:02:15,660\n第四，也有相应的惩罚。\n\n"
                "2\n00:02:59,510 --> 00:03:20,000\n失联三十天，直接停掉所有补助。\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0)
                if isinstance(cmd, list) and cmd and cmd[0] == "ffprobe":
                    return _Proc(returncode=0, stdout=b"149.916")
                output_stem = cmd[cmd.index("-of") + 1]
                with open(f"{output_stem}.srt", "w", encoding="utf-8") as handle:
                    handle.write(srt_text)
                return _Proc(returncode=0, stdout="", stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertTrue(result["alignments"])
            self.assertTrue(all(item["end_ms"] <= 149916 for item in result["alignments"]))
            self.assertTrue(any("未找到 JSON full" in warning for warning in result["warnings"]))
            diagnostics = [item for item in result["timeline_repairs"] if item.get("kind") == "qwen3_crispasr_preview_diagnostics"]
            self.assertEqual(len(diagnostics), 1)
            self.assertTrue(diagnostics[0]["srt_found"])
            self.assertFalse(diagnostics[0]["json_found"])
            self.assertEqual(diagnostics[0]["audio_duration_ms"], 149916)
            reports = [item for item in result["timeline_repairs"] if item.get("kind") == "qwen3_preview_audio_bounds"]
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0]["out_of_audio_after"], 0)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_repairs_srt_timeline_from_json_full_words(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-json-srt-repair"
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
                def __init__(self, returncode=0, stdout=b"", stderr=b""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:00,000 --> 00:00:10,000\n你好\n\n"
                "2\n00:00:00,400 --> 00:00:00,400\n，\n\n"
                "3\n00:00:00,400 --> 00:00:02,000\n世界\n\n"
                "4\n00:00:02,000 --> 00:00:05,000\n结束\n"
            )
            json_text = json.dumps(
                {
                    "transcription": [
                        {
                            "offsets": {"from": 500, "to": 3200},
                            "text": "你好世界结束",
                            "words": [
                                {"text": "你", "t0": 50, "t1": 70},
                                {"text": "好", "t0": 70, "t1": 100},
                                {"text": "，", "t0": 100, "t1": 100},
                                {"text": "世", "t0": 110, "t1": 130},
                                {"text": "界", "t0": 130, "t1": 160},
                                {"text": "结", "t0": 220, "t1": 260},
                                {"text": "束", "t0": 260, "t1": 320},
                            ],
                        }
                    ]
                },
                ensure_ascii=False,
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0)
                if isinstance(cmd, list) and cmd and cmd[0] == "ffprobe":
                    return _Proc(returncode=0, stdout=b"3.0")
                output_stem = cmd[cmd.index("-of") + 1]
                with open(f"{output_stem}.srt", "w", encoding="utf-8") as handle:
                    handle.write(srt_text)
                with open(f"{output_stem}.json", "w", encoding="utf-8") as handle:
                    handle.write(json_text)
                return _Proc(returncode=0, stdout="", stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual([item["text"] for item in result["alignments"]], ["你好，", "世界", "结束"])
            self.assertEqual(result["alignments"][0]["start_ms"], 500)
            self.assertEqual(result["alignments"][0]["end_ms"], 1000)
            self.assertEqual(result["alignments"][1]["start_ms"], 1100)
            self.assertEqual(result["alignments"][1]["end_ms"], 1600)
            self.assertEqual(result["alignments"][2]["start_ms"], 2200)
            self.assertEqual(result["alignments"][2]["end_ms"], 3000)
            reports = [item for item in result["timeline_repairs"] if item.get("kind") == "qwen3_json_srt_repair_report"]
            self.assertEqual(len(reports), 1)
            report = reports[0]
            self.assertEqual(report["entries_before"], 4)
            self.assertEqual(report["entries_after"], 3)
            self.assertEqual(report["entries_matched_to_json_words"], 4)
            self.assertEqual(report["unmatched_entries"], [])
            self.assertEqual(report["zero_or_negative_after"], 0)
            self.assertEqual(report["overlap_after"], 0)
            self.assertEqual(report["out_of_audio_after"], 0)
            diagnostics = [item for item in result["timeline_repairs"] if item.get("kind") == "qwen3_crispasr_preview_diagnostics"]
            self.assertEqual(len(diagnostics), 1)
            self.assertTrue(diagnostics[0]["has_forced_aligner_arg"])
            self.assertTrue(diagnostics[0]["has_vad_arg"])
            self.assertTrue(diagnostics[0]["has_srt_output_arg"])
            self.assertTrue(diagnostics[0]["has_json_full_output_arg"])
            self.assertTrue(diagnostics[0]["has_split_on_punct_arg"])
            self.assertTrue(diagnostics[0]["has_output_stem_arg"])
            self.assertTrue(diagnostics[0]["srt_found"])
            self.assertTrue(diagnostics[0]["json_found"])
            self.assertEqual(diagnostics[0]["audio_duration_ms"], 3000)
            self.assertTrue(any("JSON full 词级时间轴修复" in warning for warning in result["warnings"]))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_json_srt_repair_matches_crispasr_script_tail_behavior(self) -> None:
        segments = [
            {
                "start": 128.470,
                "end": 135.670,
                "text": "第四，也有相应的惩罚，错过一次就业中心预约，补贴直接减百分之三十，每个月少拿一百五。",
            },
            {
                "start": 135.670,
                "end": 146.550,
                "text": "失联三十天，直接停掉所有补助，包含租房和供暖费，相当于现在能领一万七的四口之家，以后可能要多花积蓄，强制找工作，福利直接缩水。",
            },
            {
                "start": 146.550,
                "end": 149.910,
                "text": "那你们觉得这次这样的改革是合理的吗？",
            },
            {
                "start": 149.910,
                "end": 149.910,
                "text": "评论区聊聊。",
            },
        ]

        def char_words(text: str, start: float, end: float) -> list[dict[str, float | str]]:
            compact = re.sub(r"\s+", "", text)
            if not compact:
                return []
            if end <= start:
                return [{"text": char, "start": start, "end": end} for char in compact]
            step = (end - start) / len(compact)
            words: list[dict[str, float | str]] = []
            for index, char in enumerate(compact):
                words.append({"text": char, "start": start + step * index, "end": start + step * (index + 1)})
            return words

        raw_words: list[dict[str, float | str]] = []
        for segment in segments:
            raw_words.extend(char_words(str(segment["text"]), float(segment["start"]), float(segment["end"])))

        repaired, report = ASREngine._repair_qwen3_srt_segments_from_json_words(
            segments,
            [{"qwen3_json_raw_words": raw_words}],
            audio_duration_sec=149.916688,
        )

        self.assertEqual(report["entries_before"], 4)
        self.assertEqual(report["entries_after"], 3)
        self.assertEqual(report["entries_matched_to_json_words"], 4)
        self.assertEqual(report["unmatched_entries"], [])
        self.assertEqual(report["zero_or_negative_after"], 0)
        self.assertEqual(report["overlap_after"], 0)
        self.assertEqual(report["out_of_audio_after"], 0)
        self.assertEqual(repaired[-2]["text"], segments[1]["text"])
        self.assertEqual(repaired[-2]["start"], 135.670)
        self.assertEqual(repaired[-2]["end"], 146.550)
        self.assertEqual(repaired[-1]["text"], "那你们觉得这次这样的改革是合理的吗？评论区聊聊。")
        self.assertEqual(repaired[-1]["start"], 146.550)
        self.assertEqual(repaired[-1]["end"], 149.910)
        self.assertTrue(all(item.get("qwen3_json_srt_repaired") for item in repaired))
        self.assertTrue(all(item.get("preserve_timing_boundaries") for item in repaired))

    def test_qwen3_preview_skips_extra_postprocessing_after_json_srt_repair(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-json-srt-skip-postprocess"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            wav_path = temp_dir / "sample.wav"
            wav_path.write_bytes(b"RIFFdemo")
            engine = ASREngine()

            repaired_segments = [
                {
                    "start": 135.670,
                    "end": 146.550,
                    "text": "失联三十天，直接停掉所有补助，包含租房和供暖费，相当于现在能领一万七的四口之家，以后可能要多花积蓄，强制找工作，福利直接缩水。",
                    "qwen3_json_srt_repaired": True,
                    "preserve_timing_boundaries": True,
                },
                {
                    "start": 146.550,
                    "end": 149.910,
                    "text": "那你们觉得这次这样的改革是合理的吗？评论区聊聊。",
                    "qwen3_json_srt_repaired": True,
                    "preserve_timing_boundaries": True,
                },
            ]

            async def fake_qwen(*args, **kwargs):
                return ("\n".join(item["text"] for item in repaired_segments), repaired_segments, "qwen3_crispasr")

            def fail_weak_split(*args, **kwargs):
                raise AssertionError("JSON full repaired Qwen3 preview must not run weak punctuation split")

            def fail_word_gap_split(*args, **kwargs):
                raise AssertionError("JSON full repaired Qwen3 preview must not run generic word-gap split")

            engine._transcribe_crispasr_segments = fake_qwen  # type: ignore[assignment]
            engine._split_qwen3_long_segments_by_weak_punctuation = fail_weak_split  # type: ignore[method-assign]
            engine._split_segments_by_word_gaps = fail_word_gap_split  # type: ignore[method-assign]
            engine._probe_audio_duration_seconds = lambda _path: 149.916688  # type: ignore[method-assign]

            result = asyncio.run(
                engine.transcribe(
                    str(wav_path),
                    backend="qwen3_crispasr",
                    speaker_labels=False,
                    qwen3_preview_max_line_length=20,
                )
            )

            self.assertEqual([item["text"] for item in result["alignments"]], [item["text"] for item in repaired_segments])
            self.assertEqual(result["alignments"][-1]["end_ms"], 149910)
            self.assertFalse(any(item.get("kind") == "qwen3_weak_punctuation_split" for item in result["timeline_repairs"]))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_speaker_labels_force_timestamps_and_use_diarization(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-diar"
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
            engine.qwen3_enable_timestamps = False

            calls = []

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            srt_text = (
                "1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"
                "2\n00:00:01,000 --> 00:00:02,000\n谢谢\n"
            )

            def fake_run(cmd, *args, **kwargs):
                calls.append(cmd)
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            async def fake_diar(_: object):
                return [
                    {"start": 0.0, "end": 1.0, "speaker": "SPEAKER_00"},
                    {"start": 1.0, "end": 2.0, "speaker": "SPEAKER_01"},
                ]

            engine._run_diarization = fake_diar  # type: ignore[assignment]
            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=True))

            self.assertTrue(any(isinstance(cmd, list) and "-osrt" in cmd and "-am" in cmd for cmd in calls))
            self.assertTrue(result["speaker_labels"])
            self.assertIn("说话人1：你好", result["labeled_text"])
            self.assertIn("说话人2：谢谢", result["labeled_text"])
            self.assertEqual(result["alignments"][0]["speaker"], "说话人1")
            self.assertEqual(result["alignments"][1]["speaker"], "说话人2")
            self.assertEqual(result["speaker_map"], {"说话人1": "说话人1", "说话人2": "说话人2"})
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_speaker_labels_require_forced_aligner(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-diar-missing-aligner"
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

            with self.assertRaisesRegex(RuntimeError, "Qwen3-ForcedAligner"):
                asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=True))
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

    def test_qwen3_crispasr_uses_jieba_hmm_for_split_comparative_boundary(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-jieba-hmm-boundary"
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
                "1\n00:00:50,420 --> 00:00:54,980\n关键去年房租补贴还涨了百分之十五，住的越远补贴越\n\n"
                "2\n00:00:55,460 --> 00:00:56,020\n高\n"
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(len(result["alignments"]), 1)
            self.assertEqual(result["alignments"][0]["text"], "关键去年房租补贴还涨了百分之十五，住的越远补贴越高")
            compound_repairs = [item for item in result["timeline_repairs"] if item.get("kind") == "compound_boundary"]
            self.assertIn("高", [item.get("moved_text") for item in compound_repairs])
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

    def test_qwen3_crispasr_outputs_positive_duration_for_zero_length_srt_cue(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-zero-length-cue"
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

            srt_text = "1\n00:02:30,001 --> 00:02:30,001\n评论区聊聊。\n"

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                return _Proc(returncode=0, stdout=srt_text, stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(result["alignments"][0]["text"], "评论区聊聊。")
            self.assertEqual(result["alignments"][0]["start_ms"], 150001)
            self.assertGreaterEqual(result["alignments"][0]["end_ms"], 150161)
            self.assertLessEqual(result["alignments"][0]["end_ms"], 150801)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_fuses_srt_text_with_json_word_timeline(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-json-repair"
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
                "1\n00:02:26,550 --> 00:02:29,910\n那你们觉得这次这样的改革是合理的吗？\n\n"
                "2\n00:02:29,910 --> 00:02:29,910\n评论区聊聊。\n\n"
                "3\n00:02:29,910 --> 00:02:29,910\n”\n"
            )
            full_json_text = "那你们觉得这次这样的改革是合理的吗？评论区聊聊。”"
            json_words = []
            for idx, char in enumerate(full_json_text):
                if char == "”":
                    json_words.append({"text": char, "t0": 14991, "t1": 14991})
                else:
                    json_words.append({"text": char, "t0": 14655 + idx * 8, "t1": 14663 + idx * 8})
            json_text = json.dumps(
                {
                    "transcription": [
                        {
                            "offsets": {"from": 146550, "to": 149910},
                            "text": full_json_text,
                            "words": json_words,
                        }
                    ]
                },
                ensure_ascii=False,
            )

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and cmd and cmd[0] == "ffmpeg":
                    return _Proc(returncode=0, stdout="", stderr="")
                output_stem = cmd[cmd.index("-of") + 1]
                with open(f"{output_stem}.srt", "w", encoding="utf-8") as handle:
                    handle.write(srt_text)
                with open(f"{output_stem}.json", "w", encoding="utf-8") as handle:
                    handle.write(json_text)
                return _Proc(returncode=0, stdout="", stderr="")

            with patch("backend.engine.asr_engine.subprocess.run", side_effect=fake_run):
                result = asyncio.run(engine.transcribe(str(wav_path), backend="qwen3_crispasr", speaker_labels=False))

            self.assertEqual(len(result["alignments"]), 2)
            self.assertEqual(result["alignments"][0]["text"], "那你们觉得这次这样的改革是合理的吗？")
            self.assertEqual(result["alignments"][1]["text"], "评论区聊聊。”")
            self.assertGreater(result["alignments"][1]["end_ms"], result["alignments"][1]["start_ms"])
            self.assertGreaterEqual(result["alignments"][1]["start_ms"], result["alignments"][0]["end_ms"])
            repair_kinds = [item.get("kind") for item in result["timeline_repairs"]]
            self.assertIn("qwen3_quote_fragment_merge", repair_kinds)
            self.assertTrue(all(alignment["text"] != "”" for alignment in result["alignments"]))
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_json_parser_accepts_second_word_offsets(self) -> None:
        json_text = json.dumps(
            {
                "transcription": [
                    {
                        "offsets": {"from": 1200, "to": 1800},
                        "text": "你好",
                        "words": [
                            {"text": "你", "t0": 1.2, "t1": 1.4},
                            {"text": "好", "t0": 1.4, "t1": 1.8},
                        ],
                    }
                ]
            },
            ensure_ascii=False,
        )

        segments = ASREngine._parse_crispasr_qwen3_json_segments(json_text)

        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["words"][0]["start"], 1.2)
        self.assertEqual(segments[0]["words"][1]["end"], 1.8)

    def test_qwen3_crispasr_json_parser_preserves_zero_duration_text_words(self) -> None:
        json_text = json.dumps(
            {
                "transcription": [
                    {
                        "offsets": {"from": 0, "to": 1000},
                        "text": "未闻窗外",
                        "words": [
                            {"text": "未", "t0": 10, "t1": 10},
                            {"text": "闻", "t0": 10, "t1": 10},
                            {"text": "窗", "t0": 10, "t1": 10},
                            {"text": "外", "t0": 20, "t1": 30},
                        ],
                    }
                ]
            },
            ensure_ascii=False,
        )

        segments = ASREngine._parse_crispasr_qwen3_json_segments(json_text)
        stream, _, _ = ASREngine._build_timeline_char_stream(segments)

        self.assertEqual(stream, "未闻窗外")
        self.assertTrue(all(word["end"] > word["start"] for word in segments[0]["words"]))

    def test_qwen3_crispasr_json_loader_accepts_plain_stem_json_name(self) -> None:
        temp_dir = settings.data_dir / "tmp-tests" / "asr-qwen3-json-name"
        shutil.rmtree(temp_dir, ignore_errors=True)
        temp_dir.mkdir(parents=True, exist_ok=True)
        try:
            json_text = json.dumps(
                {
                    "transcription": [
                        {
                            "offsets": {"from": 0, "to": 500},
                            "text": "你好",
                            "words": [{"text": "你", "t0": 0, "t1": 25}, {"text": "好", "t0": 25, "t1": 50}],
                        }
                    ]
                },
                ensure_ascii=False,
            )
            (temp_dir / "output.json").write_text(json_text, encoding="utf-8")

            segments = ASREngine._load_crispasr_qwen3_json_segments(
                work_dir=temp_dir,
                output_stem=temp_dir / "output",
            )

            self.assertEqual(len(segments), 1)
            self.assertEqual(segments[0]["text"], "你好")
            self.assertEqual(len(segments[0]["words"]), 2)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def test_qwen3_crispasr_splits_long_segments_on_allowed_punctuation_not_colon(self) -> None:
        text = "他说：第一段很长很长，第二段继续很长；第三段最后很长。"
        segments, split_count, repairs = ASREngine._split_qwen3_long_segments_by_weak_punctuation(
            [{"start": 0.0, "end": 9.0, "text": text}],
            max_line_length=8,
        )

        self.assertGreater(split_count, 0)
        self.assertTrue(any(item.get("kind") == "qwen3_weak_punctuation_split" for item in repairs))
        texts = [str(segment.get("text") or "") for segment in segments]
        self.assertEqual("".join(texts), text)
        self.assertTrue(texts[0].startswith("他说：第一段"))
        self.assertFalse(any(item == "他说：" for item in texts))
        self.assertTrue(all(float(item["end"]) > float(item["start"]) for item in segments))

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
