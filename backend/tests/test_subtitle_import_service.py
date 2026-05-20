from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from backend.persistence import load_project
from backend.services.subtitle_import_service import create_dubbing_project_from_subtitle, parse_subtitle_bytes


class _FakeTranslationEngine:
    is_loaded = True
    backend_name = "fake"

    async def generate_text(self, *, text, system_prompt, llm_options):
        return f"{text}译"


def _fake_state(projects_dir: Path):
    config = SimpleNamespace(
        secondary_llm_model_path="fake.gguf",
        secondary_llm_clip_model_path="",
        secondary_llm_n_ctx=4096,
        secondary_llm_n_gpu_layers=-1,
        secondary_llm_threads=0,
        secondary_enable_llama_cpp_think_mode=False,
        llm_api_model="",
        secondary_llm_temperature=0.2,
        secondary_llm_top_p=0.9,
        secondary_llm_top_k=40,
        secondary_llm_min_p=0.0,
        secondary_llm_presence_penalty=0.0,
        secondary_llm_repeat_penalty=1.0,
        secondary_llm_max_tokens=1024,
    )
    return SimpleNamespace(
        settings=SimpleNamespace(projects_dir=projects_dir),
        orchestrator=SimpleNamespace(config=config),
        translation_llm_engine=_FakeTranslationEngine(),
        translation_engine_source="secondary_local",
        translation_engine_error="",
    )


class SubtitleImportServiceTest(unittest.IsolatedAsyncioTestCase):
    def test_parse_srt_multiline_and_line_policy(self) -> None:
        raw = """1
00:00:01,000 --> 00:00:03,500
旁白：第一行原文
Second translated line

2
00:00:04,000 --> 00:00:05,000
下一句
""".encode("utf-8")

        original = parse_subtitle_bytes(raw, filename="demo.srt", mode="original", line_policy="auto")
        self.assertEqual(original["format"], "srt")
        self.assertEqual(original["segment_count"], 2)
        self.assertEqual(original["cues"][0]["speaker"], "旁白")
        self.assertIn("Second translated line", original["cues"][0]["text"])

        translated = parse_subtitle_bytes(raw, filename="demo.srt", mode="translated", line_policy="auto")
        self.assertEqual(translated["cues"][0]["text"], "第一行原文")
        self.assertEqual(translated["cues"][0]["duration_ms"], 2500)

    def test_parse_ass_dialogue_with_commas_tags_and_speakers(self) -> None:
        raw = """[Script Info]
Title: demo

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.25,Default,老周,0,0,0,,{\\an8}你好,世界\\N第二行
Dialogue: 0,0:00:04.00,0:00:05.00,Default,儿子,0,0,0,,知道了
""".encode("utf-8")

        parsed = parse_subtitle_bytes(raw, filename="demo.ass", mode="original", line_policy="all")
        self.assertEqual(parsed["format"], "ass")
        self.assertEqual(parsed["segment_count"], 2)
        self.assertEqual(parsed["speakers"], ["老周", "儿子"])
        self.assertEqual(parsed["cues"][0]["text"], "你好,世界\n第二行")
        self.assertEqual(parsed["cues"][0]["duration_ms"], 2250)

    async def test_create_original_project_preserves_source_timeline(self) -> None:
        raw = """1
00:00:00,000 --> 00:00:02,000
旁白：开场白
""".encode("utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            projects_dir = Path(tmp)
            result = await create_dubbing_project_from_subtitle(
                state=_fake_state(projects_dir),
                data=raw,
                filename="demo.srt",
                project_name="字幕项目",
                mode="original",
                target_language="中文",
                translation_source="secondary_local",
                line_policy="auto",
            )
            project = load_project(projects_dir, result["project_id"])
            self.assertTrue(project.synthesis_config.timeline_lock_enabled)
            self.assertTrue(project.script.metadata["subtitle_source"])
            self.assertEqual(project.script.metadata["dubbing_mode"], "original")
            self.assertEqual(project.script.segments[0].source_start_ms, 0)
            self.assertEqual(project.script.segments[0].source_end_ms, 2000)
            self.assertEqual(project.script.segments[0].tts_overrides, {})

    async def test_create_translated_project_uses_translation_service(self) -> None:
        raw = """1
00:00:00,000 --> 00:00:01,500
Hello
""".encode("utf-8")
        with tempfile.TemporaryDirectory() as tmp:
            result = await create_dubbing_project_from_subtitle(
                state=_fake_state(Path(tmp)),
                data=raw,
                filename="demo.srt",
                project_name="翻译项目",
                mode="translated",
                target_language="中文",
                translation_source="secondary_local",
                line_policy="auto",
            )
            project = result["project"]
            segment = project.script.segments[0]
            self.assertEqual(project.script.metadata["dubbing_mode"], "translated")
            self.assertEqual(segment.source_text, "Hello")
            self.assertEqual(segment.text, "Hello译")
            self.assertEqual(segment.source_duration_ms, 1500)
            self.assertEqual(segment.tts_overrides, {})


if __name__ == "__main__":
    unittest.main()
