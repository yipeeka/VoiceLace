from __future__ import annotations

import asyncio
import unittest

from backend.engine.llm_engine import LLMEngine
from backend.models import Script, Segment


class LlmEngineStatsTest(unittest.TestCase):
    def test_parse_stats_contains_observability_fields(self) -> None:
        engine = LLMEngine()
        engine.backend_name = "mock"
        engine.model_name = "mock-model"
        script = asyncio.run(
            engine.parse_text_chunked_stream(
                "第一行\n第二行",
                prompt=None,
                llm_options={
                    "enable_structured_output": False,
                    "enable_json_repair": False,
                    "n_ctx": 4096,
                    "max_tokens": 1024,
                },
            )
        )
        self.assertGreaterEqual(len(script.segments), 1)
        stats = engine.last_parse_stats
        self.assertEqual(stats.get("parse_mode"), "two_step_pipeline")
        self.assertEqual(stats.get("mode"), "two_step")
        self.assertEqual(stats.get("model_name"), "mock-model")
        self.assertFalse(stats.get("structured_output_enabled"))
        self.assertFalse(stats.get("json_repair_enabled"))
        self.assertEqual(stats.get("n_ctx"), 4096)
        self.assertEqual(stats.get("max_tokens"), 1024)
        self.assertIn("think_mode_enabled", stats)
        self.assertIn("step_stats", stats)

    def test_legacy_parse_mode_still_supported(self) -> None:
        engine = LLMEngine()
        engine.backend_name = "mock"
        script = asyncio.run(
            engine.parse_text_chunked_stream(
                "旁白：测试\n角色：你好",
                prompt=None,
                llm_options={},
                parse_mode="legacy_single_pass",
            )
        )
        self.assertGreaterEqual(len(script.segments), 1)
        stats = engine.last_parse_stats
        self.assertEqual(stats.get("parse_mode"), "legacy_single_pass")
        self.assertIn(stats.get("mode"), {"single", "chunked"})

    def test_structure_prompt_emphasizes_quoted_direct_speech(self) -> None:
        prompt = LLMEngine._structure_extraction_prompt()
        self.assertIn("不要把引号内台词并入 narration", prompt)
        self.assertIn("冒号后或引号内的文本优先判为 dialogue", prompt)
        self.assertIn("老太太一想到她的孙子被枪打死了", prompt)
        self.assertIn('"speaker": "老太太"', prompt)

    def test_two_step_structure_drift_is_reported_not_raised(self) -> None:
        engine = LLMEngine()
        step1 = Script(
            title="test",
            source_text="a\nb",
            segments=[
                Segment(id="s1", index=0, type="narration", speaker="narrator", text="第一句"),
                Segment(id="s2", index=1, type="dialogue", speaker="角色A", text="第二句"),
            ],
            characters=[],
            metadata={},
        )
        # Step2 intentionally rewrites the second segment text.
        step2 = Script(
            title="test",
            source_text="a\nb",
            segments=[
                Segment(id="x1", index=0, type="narration", speaker="narrator", text="第一句", emotion="neutral"),
                Segment(id="x2", index=1, type="dialogue", speaker="角色A", text="第二句（被改写）", emotion="serious"),
            ],
            characters=[],
            metadata={},
        )
        draft = engine._to_structured_draft(step1, source_text=step1.source_text)
        guard = engine._analyze_two_step_structure_drift(draft, step2)
        self.assertFalse(guard["segment_count_changed"])
        self.assertEqual(guard["mismatch_count"], 1)
        self.assertEqual(guard["mismatched_indices"], [1])

        merged = engine._merge_two_step_output(
            structure_draft=draft,
            tts_script=step2,
            source_text=step1.source_text,
            structure_guard=guard,
        )
        # Structure is always anchored to Step1.
        self.assertEqual(merged.segments[1].text, "第二句")
        self.assertEqual(merged.segments[1].id, "s2")
        # But Step2 enrichment can still be reused by index.
        self.assertEqual(merged.segments[1].emotion, "serious")

    def test_two_step_segment_count_change_disables_step2_injection(self) -> None:
        engine = LLMEngine()
        step1 = Script(
            title="test",
            source_text="a\nb",
            segments=[
                Segment(id="s1", index=0, type="narration", speaker="narrator", text="第一句"),
                Segment(id="s2", index=1, type="dialogue", speaker="角色A", text="第二句"),
            ],
            characters=[],
            metadata={},
        )
        # Step2 drops one segment.
        step2 = Script(
            title="test",
            source_text="a\nb",
            segments=[
                Segment(id="x1", index=0, type="narration", speaker="narrator", text="第一句", emotion="cheerful"),
            ],
            characters=[],
            metadata={},
        )
        draft = engine._to_structured_draft(step1, source_text=step1.source_text)
        guard = engine._analyze_two_step_structure_drift(draft, step2)
        self.assertTrue(guard["segment_count_changed"])

        merged = engine._merge_two_step_output(
            structure_draft=draft,
            tts_script=step2,
            source_text=step1.source_text,
            structure_guard=guard,
        )
        # Count must stay equal to Step1 and fallback to neutral when Step2 count changed.
        self.assertEqual(len(merged.segments), 2)
        self.assertEqual(merged.segments[0].id, "s1")
        self.assertEqual(merged.segments[1].id, "s2")
        self.assertEqual(merged.segments[0].emotion, "neutral")
        self.assertEqual(merged.segments[1].emotion, "neutral")


if __name__ == "__main__":
    unittest.main()
