from __future__ import annotations

import asyncio
import unittest

from backend.engine.llm_engine import LLMEngine
from backend.engine.llm_verified_five_step_pipeline import verify_step1_script_with_source
from backend.engine.prompts import read_aloud_extraction_prompt, verified_five_step_structure_prompt
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

    def test_legacy_single_pass_source_correction_restores_dialogue_narration_dialogue(self) -> None:
        engine = LLMEngine()
        script = engine._normalize_legacy_single_pass_script(
            Script(
                title="单步",
                source_text="“不，”老人说。“你遇上了一条交好运的船。跟他们待下去吧。”",
                segments=[
                    Segment(
                        id="s1",
                        index=0,
                        type="dialogue",
                        speaker="老人",
                        text="不。你遇上了一条交好运的船。跟他们待下去吧。",
                        emotion="serious",
                    )
                ],
                characters=[],
                metadata={"parser": "mock-single"},
            ),
            source_text="“不，”老人说。“你遇上了一条交好运的船。跟他们待下去吧。”",
        )
        self.assertEqual(
            [(segment.type, segment.speaker, segment.text) for segment in script.segments],
            [
                ("dialogue", "老人", "不，"),
                ("narration", "narrator", "老人说。"),
                ("dialogue", "老人", "你遇上了一条交好运的船。跟他们待下去吧。"),
            ],
        )
        self.assertEqual(script.segments[0].emotion, "serious")

    def test_read_aloud_parse_mode_normalizes_to_single_narrator_and_preserves_dialogue(self) -> None:
        engine = LLMEngine()
        script = engine._normalize_read_aloud_script(
            Script(
                title="朗读",
                source_text="叙述。\n“你可听清了？”",
                segments=[
                    Segment(id="s1", index=0, type="narration", speaker="甲", text="叙述部分。"),
                    Segment(
                        id="s2",
                        index=1,
                        type="dialogue",
                        speaker="乙",
                        text="[question-en] 你可听清了？",
                        non_verbal=["[question-en]"],
                    ),
                    Segment(id="s3", index=2, type="direction", speaker="乙", text="动作提示"),
                ],
                characters=[],
                metadata={"parser": "mock"},
            ),
            source_text="叙述。\n“你可听清了？”",
        )
        self.assertGreaterEqual(len(script.segments), 1)
        self.assertTrue(all(segment.speaker == "narrator" for segment in script.segments))
        self.assertEqual(script.segments[0].type, "narration")
        self.assertEqual(script.segments[1].type, "dialogue")
        self.assertEqual(script.segments[1].non_verbal, ["[question-en]"])
        self.assertEqual([character.name for character in script.characters], ["narrator"])
        self.assertEqual(script.characters[0].appearance_count, len(script.segments))
        self.assertEqual(script.metadata.get("parse_mode"), "read_aloud_single_voice")

    def test_read_aloud_parse_mode_stats_are_reported(self) -> None:
        engine = LLMEngine()
        engine.backend_name = "mock"
        script = asyncio.run(
            engine.parse_text_chunked_stream(
                "这是一段较长的叙述。\n“你可听清了？”",
                prompt=None,
                llm_options={},
                parse_mode="read_aloud_single_voice",
            )
        )
        self.assertGreaterEqual(len(script.segments), 1)
        stats = engine.last_parse_stats
        self.assertEqual(stats.get("parse_mode"), "read_aloud_single_voice")
        self.assertIn(stats.get("mode"), {"single", "chunked"})

    def test_verified_five_step_parse_mode_stats_are_reported(self) -> None:
        engine = LLMEngine()
        engine.backend_name = "mock"
        script = asyncio.run(
            engine.parse_text_chunked_stream(
                "旁白：第一行\n甲：第二行",
                prompt="用户自定义提示词",
                llm_options={},
                parse_mode="verified_five_step_pipeline",
            )
        )
        self.assertGreaterEqual(len(script.segments), 1)
        stats = engine.last_parse_stats
        self.assertEqual(stats.get("parse_mode"), "verified_five_step_pipeline")
        self.assertEqual(stats.get("mode"), "verified_five_step")
        self.assertTrue(stats.get("custom_prompt_ignored"))
        step_stats = stats.get("step_stats") or {}
        self.assertIn("step1_script_gen", step_stats)
        self.assertIn("step2_verify_script", step_stats)
        self.assertIn("step3_enrich", step_stats)
        self.assertIn("step4_verify_enrich", step_stats)
        self.assertIn("step5_json_build", step_stats)

    def test_read_aloud_structure_splits_narration_plus_dialogue(self) -> None:
        segments = LLMEngine._build_read_aloud_structure_segments(
            "店小二迎出来道：“客官，是打尖还是住店？”"
        )
        self.assertEqual([(seg.type, seg.text) for seg in segments], [
            ("narration", "店小二迎出来道："),
            ("dialogue", "客官，是打尖还是住店？"),
        ])

    def test_read_aloud_structure_splits_dialogue_plus_narration(self) -> None:
        segments = LLMEngine._build_read_aloud_structure_segments(
            "“圣地亚哥”，他们俩从小船停泊的地方爬上岸时，孩子对他说。"
        )
        self.assertEqual([(seg.type, seg.text) for seg in segments], [
            ("dialogue", "圣地亚哥，"),
            ("narration", "他们俩从小船停泊的地方爬上岸时，孩子对他说。"),
        ])

    def test_read_aloud_structure_splits_dialogue_narration_dialogue(self) -> None:
        segments = LLMEngine._build_read_aloud_structure_segments(
            "“不，”老人说。“你遇上了一条交好运的船。跟他们待下去吧。”"
        )
        self.assertEqual([(seg.type, seg.text) for seg in segments], [
            ("dialogue", "不，"),
            ("narration", "老人说。"),
            ("dialogue", "你遇上了一条交好运的船。跟他们待下去吧。"),
        ])

    def test_read_aloud_structure_keeps_quoted_term_as_narration(self) -> None:
        segments = LLMEngine._build_read_aloud_structure_segments(
            "这类芯片虽然不算最先进，但却是现代经济的“基础部件”，广泛用于汽车、工业设备以及消费电子。"
        )
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0].type, "narration")
        self.assertIn("“基础部件”", segments[0].text)

    def test_read_aloud_merge_restores_missing_leading_narration(self) -> None:
        engine = LLMEngine()
        script = engine._normalize_read_aloud_script(
            Script(
                title="朗读",
                source_text="店小二迎出来道：“客官，是打尖还是住店？”",
                segments=[
                    Segment(id="m1", index=0, type="dialogue", speaker="narrator", text="客官，是打尖还是住店？", emotion="concern"),
                ],
                characters=[],
                metadata={"parser": "mock"},
            ),
            source_text="店小二迎出来道：“客官，是打尖还是住店？”",
        )
        self.assertEqual([(seg.type, seg.text) for seg in script.segments], [
            ("narration", "店小二迎出来道："),
            ("dialogue", "客官，是打尖还是住店？"),
        ])
        self.assertEqual(script.segments[1].emotion, "concern")

    def test_read_aloud_merge_keeps_narration_from_structure_when_model_duplicates_dialogue(self) -> None:
        engine = LLMEngine()
        script = engine._normalize_read_aloud_script(
            Script(
                title="朗读",
                source_text="巷子尽头忽有孩童哭声，一个妇人边跑边喊：“让一让！让一让！”",
                segments=[
                    Segment(
                        id="m1",
                        index=0,
                        type="narration",
                        speaker="narrator",
                        text="巷子尽头忽有孩童哭声，一个妇人边跑边喊：让一让！让一让！",
                        emotion="fearful",
                    ),
                    Segment(
                        id="m2",
                        index=1,
                        type="dialogue",
                        speaker="narrator",
                        text="让一让！让一让！",
                        emotion="neutral",
                    ),
                ],
                characters=[],
                metadata={"parser": "mock"},
            ),
            source_text="巷子尽头忽有孩童哭声，一个妇人边跑边喊：“让一让！让一让！”",
        )
        self.assertEqual([(seg.type, seg.text) for seg in script.segments], [
            ("narration", "巷子尽头忽有孩童哭声，一个妇人边跑边喊："),
            ("dialogue", "让一让！让一让！"),
        ])
        self.assertEqual(script.segments[0].emotion, "fearful")

    def test_read_aloud_merge_does_not_expand_first_dialogue_into_following_dialogue(self) -> None:
        engine = LLMEngine()
        script = engine._normalize_read_aloud_script(
            Script(
                title="朗读",
                source_text="“圣地亚哥”，他们俩从小船停泊的地方爬上岸时，孩子对他说。“我又能陪你出海了。我家挣到了一点儿钱。”",
                segments=[
                    Segment(
                        id="m1",
                        index=0,
                        type="dialogue",
                        speaker="narrator",
                        text="[question-ah] 圣地亚哥，我又能陪你出海了。我家挣到了一点儿钱。",
                        emotion="concern",
                        non_verbal=["[question-ah]"],
                    ),
                    Segment(id="m2", index=1, type="narration", speaker="narrator", text="他们俩从小船停泊的地方爬上岸时，孩子对他说。"),
                    Segment(id="m3", index=2, type="dialogue", speaker="narrator", text="我又能陪你出海了。我家挣到了一点儿钱。"),
                ],
                characters=[],
                metadata={"parser": "mock"},
            ),
            source_text="“圣地亚哥”，他们俩从小船停泊的地方爬上岸时，孩子对他说。“我又能陪你出海了。我家挣到了一点儿钱。”",
        )
        self.assertEqual([(seg.type, seg.text) for seg in script.segments], [
            ("dialogue", "[question-ah] 圣地亚哥，"),
            ("narration", "他们俩从小船停泊的地方爬上岸时，孩子对他说。"),
            ("dialogue", "我又能陪你出海了。我家挣到了一点儿钱。"),
        ])

    def test_read_aloud_merge_does_not_merge_dialogue_narration_dialogue_case(self) -> None:
        engine = LLMEngine()
        script = engine._normalize_read_aloud_script(
            Script(
                title="朗读",
                source_text="“不，”老人说。“你遇上了一条交好运的船。跟他们待下去吧。”",
                segments=[
                    Segment(id="m1", index=0, type="dialogue", speaker="narrator", text="不，你遇上了一条交好运的船。跟他们待下去吧。", emotion="serious"),
                    Segment(id="m2", index=1, type="narration", speaker="narrator", text="老人说。"),
                    Segment(id="m3", index=2, type="dialogue", speaker="narrator", text="你遇上了一条交好运的船。跟他们待下去吧。"),
                ],
                characters=[],
                metadata={"parser": "mock"},
            ),
            source_text="“不，”老人说。“你遇上了一条交好运的船。跟他们待下去吧。”",
        )
        self.assertEqual([(seg.type, seg.text) for seg in script.segments], [
            ("dialogue", "不，"),
            ("narration", "老人说。"),
            ("dialogue", "你遇上了一条交好运的船。跟他们待下去吧。"),
        ])

    def test_read_aloud_merge_does_not_merge_cheerful_dialogue_case(self) -> None:
        engine = LLMEngine()
        script = engine._normalize_read_aloud_script(
            Script(
                title="朗读",
                source_text="“那敢情好，”老人说。“都是打鱼人嘛。”",
                segments=[
                    Segment(id="m1", index=0, type="dialogue", speaker="narrator", text="那敢情好，都是打鱼人嘛。", emotion="cheerful"),
                    Segment(id="m2", index=1, type="narration", speaker="narrator", text="老人说。"),
                    Segment(id="m3", index=2, type="dialogue", speaker="narrator", text="都是打鱼人嘛。"),
                ],
                characters=[],
                metadata={"parser": "mock"},
            ),
            source_text="“那敢情好，”老人说。“都是打鱼人嘛。”",
        )
        self.assertEqual([(seg.type, seg.text) for seg in script.segments], [
            ("dialogue", "那敢情好，"),
            ("narration", "老人说。"),
            ("dialogue", "都是打鱼人嘛。"),
        ])

    def test_structure_prompt_emphasizes_quoted_direct_speech(self) -> None:
        prompt = LLMEngine._structure_extraction_prompt()
        self.assertIn("只输出纯文本多行，不要 JSON", prompt)
        self.assertIn("旁白：", prompt)
        self.assertIn("舞台提示：", prompt)
        self.assertIn("角色名：", prompt)
        self.assertIn("引语拆分强规则", prompt)
        self.assertIn("石头笑着说", prompt)

    def test_read_aloud_prompt_prioritizes_dialogue_extraction(self) -> None:
        prompt = read_aloud_extraction_prompt()
        self.assertIn("首先识别并单独提取所有对话部分", prompt)
        self.assertIn("每句完整对话必须单独成为一个 dialogue 段", prompt)
        self.assertIn("对话以外的所有内容", prompt)
        self.assertIn("现代经济的“基础部件”", prompt)

    def test_verified_five_step_structure_prompt_uses_director_protocol(self) -> None:
        prompt = verified_five_step_structure_prompt()
        self.assertIn("资深的有声书导演", prompt)
        self.assertIn("脚本拆解与重构（Script Parsing & Reconstruction）", prompt)
        self.assertIn("时序一致性（最高优先级）", prompt)
        self.assertIn("提示语剥离", prompt)
        self.assertIn("小孩: 圣地亚哥，", prompt)
        self.assertIn("老人: 不，", prompt)
        self.assertIn("完整性：必须 100% 覆盖用户输入的全部文本", prompt)
        self.assertIn("只输出纯文本多行", prompt)

    def test_verified_five_step_step2_preserves_step1_dialogue_speaker(self) -> None:
        source = "掌柜抬手示意道：“都坐下，慢慢说。”"
        step1_script = Script(
            title="test",
            source_text=source,
            segments=[
                Segment(
                    id="s1",
                    index=0,
                    type="narration",
                    speaker="narrator",
                    text="掌柜抬手示意道：",
                ),
                Segment(
                    id="s2",
                    index=1,
                    type="dialogue",
                    speaker="掌柜",
                    text="都坐下，慢慢说。",
                ),
            ],
            characters=[],
            metadata={},
        )

        corrected_draft, report = verify_step1_script_with_source(
            step1_script=step1_script,
            source_text=source,
        )

        self.assertEqual([(seg.type, seg.speaker, seg.text) for seg in corrected_draft.segments], [
            ("narration", "narrator", "掌柜抬手示意道："),
            ("dialogue", "掌柜", "都坐下，慢慢说。"),
        ])
        self.assertGreaterEqual(report.get("speaker_preserved_count", 0), 0)

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
        # New contract: text differences are handled by merge guard and do not
        # count as structural drift.
        self.assertEqual(guard["mismatch_count"], 0)
        self.assertEqual(guard["mismatched_indices"], [])

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
