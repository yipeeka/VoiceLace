from __future__ import annotations

import unittest

from backend.engine.llm_two_step_pipeline import (
    analyze_two_step_structure_drift,
    build_step2_input_payload,
    merge_two_step_output,
    parse_step1_lines_to_structured_draft,
)
from backend.models import Script, Segment


class TwoStepPipelineTest(unittest.TestCase):
    def test_parse_step1_lines_to_structured_draft_maps_prefixes(self) -> None:
        raw = "\n".join(
            [
                "旁白：天色已晚。",
                "舞台提示：众人起身。",
                "王婆：且慢一步。",
            ]
        )
        draft = parse_step1_lines_to_structured_draft(raw, source_text="src")
        self.assertEqual(len(draft.segments), 3)
        self.assertEqual(draft.segments[0].type, "narration")
        self.assertEqual(draft.segments[0].speaker, "narrator")
        self.assertEqual(draft.segments[1].type, "direction")
        self.assertEqual(draft.segments[1].speaker, "narrator")
        self.assertEqual(draft.segments[2].type, "dialogue")
        self.assertEqual(draft.segments[2].speaker, "王婆")

    def test_parse_step1_lines_reports_line_number_for_invalid_line(self) -> None:
        with self.assertRaisesRegex(ValueError, "line 2"):
            parse_step1_lines_to_structured_draft("旁白：第一句\n这不是合法前缀", source_text="src")

    def test_parse_step1_lines_skips_hallucinated_non_verbal_only_line(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：门外忽然有人笑道：\n旁白：[laughter]\n有人：我早就料到！",
            source_text="门外忽然有人笑道：“我早就料到！”",
        )
        self.assertEqual(len(draft.segments), 2)
        self.assertEqual(draft.segments[0].text, "门外忽然有人笑道：")
        self.assertEqual(draft.segments[1].type, "dialogue")
        self.assertEqual(draft.segments[1].speaker, "有人")
        self.assertEqual(draft.segments[1].text, "[laughter] 我早就料到！")

    def test_parse_step1_lines_keeps_non_verbal_only_line_when_present_in_source(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：[laughter]",
            source_text="[laughter]",
        )
        self.assertEqual(len(draft.segments), 1)
        self.assertEqual(draft.segments[0].text, "[laughter]")

    def test_parse_step1_lines_splits_leadin_speaker_like_quandao_and_gengyandao(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "少安劝道：“娘，你先别哭坏了身子。”\n老太太哽咽道：“我心里疼啊！”",
            source_text="少安劝道：“娘，你先别哭坏了身子。”\n老太太哽咽道：“我心里疼啊！”",
        )
        self.assertEqual(len(draft.segments), 4)
        self.assertEqual(draft.segments[0].type, "narration")
        self.assertEqual(draft.segments[0].text, "少安劝道：")
        self.assertEqual(draft.segments[1].type, "dialogue")
        self.assertEqual(draft.segments[1].speaker, "少安")
        self.assertEqual(draft.segments[1].text, "娘，你先别哭坏了身子。")
        self.assertEqual(draft.segments[2].type, "narration")
        self.assertEqual(draft.segments[2].text, "老太太哽咽道：")
        self.assertEqual(draft.segments[3].type, "dialogue")
        self.assertEqual(draft.segments[3].speaker, "老太太")
        self.assertEqual(draft.segments[3].text, "我心里疼啊！")

    def test_parse_step1_lines_normalizes_complex_leadin_speaker_names(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁边卖粥的汉子吆喝道：“热粥嘞！”\n老周朝前挪了两步，又回头对儿子说道：“快跟上。”\n有人惊呼道：“不好了！”",
            source_text="旁边卖粥的汉子吆喝道：“热粥嘞！”\n老周朝前挪了两步，又回头对儿子说道：“快跟上。”\n有人惊呼道：“不好了！”",
        )
        self.assertEqual(len(draft.segments), 6)
        self.assertEqual(draft.segments[0].text, "旁边卖粥的汉子吆喝道：")
        self.assertEqual(draft.segments[1].speaker, "旁边卖粥的汉子")
        self.assertEqual(draft.segments[1].text, "热粥嘞！")
        self.assertEqual(draft.segments[2].text, "老周朝前挪了两步，又回头对儿子说道：")
        self.assertEqual(draft.segments[3].speaker, "老周")
        self.assertEqual(draft.segments[3].text, "快跟上。")
        self.assertEqual(draft.segments[4].text, "有人惊呼道：")
        self.assertEqual(draft.segments[5].speaker, "有人")
        self.assertEqual(draft.segments[5].text, "不好了！")

    def test_parse_step1_lines_splits_inline_quote_then_attribution(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：“不，”老人说。\n老人：你遇上了一条交好运的船。跟他们待下去吧。\n旁白：“对，”孩子说。\n孩子：我请你到露台饭店去喝杯啤酒，然后一起把打鱼的家什带回去。",
            source_text="“不，”老人说。“你遇上了一条交好运的船。跟他们待下去吧。”\n“对，”孩子说。“我请你到露台饭店去喝杯啤酒，然后一起把打鱼的家什带回去。”",
        )
        self.assertEqual(draft.segments[0].type, "dialogue")
        self.assertEqual(draft.segments[0].speaker, "老人")
        self.assertEqual(draft.segments[0].text, "不，")
        self.assertEqual(draft.segments[1].type, "narration")
        self.assertEqual(draft.segments[1].speaker, "narrator")
        self.assertEqual(draft.segments[1].text, "老人说。")
        self.assertEqual(draft.segments[2].type, "dialogue")
        self.assertEqual(draft.segments[2].speaker, "老人")
        self.assertEqual(draft.segments[2].text, "你遇上了一条交好运的船。跟他们待下去吧。")
        self.assertEqual(draft.segments[3].type, "dialogue")
        self.assertEqual(draft.segments[3].speaker, "孩子")
        self.assertEqual(draft.segments[3].text, "对，")
        self.assertEqual(draft.segments[4].type, "narration")
        self.assertEqual(draft.segments[4].text, "孩子说。")
        self.assertEqual(draft.segments[5].type, "dialogue")
        self.assertEqual(draft.segments[5].speaker, "孩子")
        self.assertEqual(
            draft.segments[5].text,
            "我请你到露台饭店去喝杯啤酒，然后一起把打鱼的家什带回去。",
        )

    def test_parse_step1_lines_splits_leading_quote_with_context_and_attribution(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：“圣地亚哥”，他们俩从小船停泊的地方爬上岸时，孩子对他说。\n孩子：我又能陪你出海了。我家挣到了一点儿钱。",
            source_text="“圣地亚哥”，他们俩从小船停泊的地方爬上岸时，孩子对他说。“我又能陪你出海了。我家挣到了一点儿钱。”",
        )
        self.assertEqual(draft.segments[0].type, "dialogue")
        self.assertEqual(draft.segments[0].speaker, "孩子")
        self.assertEqual(draft.segments[0].text, "圣地亚哥")
        self.assertEqual(draft.segments[1].type, "narration")
        self.assertEqual(
            draft.segments[1].text,
            "他们俩从小船停泊的地方爬上岸时，孩子对他说。",
        )
        self.assertEqual(draft.segments[2].type, "dialogue")
        self.assertEqual(draft.segments[2].speaker, "孩子")
        self.assertEqual(draft.segments[2].text, "我又能陪你出海了。我家挣到了一点儿钱。")

    def test_merge_two_step_output_filters_unknown_non_verbal_tags(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：引导。\n孩子：我又能陪你出海了。",
            source_text="引导。'我又能陪你出海了。'",
        )
        step2_script = Script(
            title="t",
            source_text="src",
            segments=[
                Segment(
                    id="x0",
                    index=0,
                    type="narration",
                    speaker="narrator",
                    text="引导。",
                    emotion="neutral",
                    non_verbal=[],
                    tts_overrides={},
                ),
                Segment(
                    id="x1",
                    index=1,
                    type="dialogue",
                    speaker="孩子",
                    text="[cheerful] 我又能陪你出海了。",
                    emotion="excited",
                    non_verbal=["[cheerful]"],
                    tts_overrides={},
                ),
            ],
            characters=[],
            metadata={},
        )
        guard = analyze_two_step_structure_drift(draft, step2_script)
        merged = merge_two_step_output(
            structure_draft=draft,
            tts_script=step2_script,
            source_text="src",
            structure_guard=guard,
        )
        self.assertEqual(merged.segments[1].non_verbal, [])
        self.assertEqual(merged.segments[1].text, "我又能陪你出海了。")

    def test_build_step2_input_payload_uses_step1_structure_without_id(self) -> None:
        draft = parse_step1_lines_to_structured_draft("旁白：第一句\n张三：第二句", source_text="src")
        payload = build_step2_input_payload(draft)
        self.assertIn("segments", payload)
        self.assertEqual(len(payload["segments"]), 2)
        self.assertNotIn("id", payload["segments"][0])
        self.assertEqual(payload["segments"][0]["index"], 0)
        self.assertEqual(payload["segments"][1]["speaker"], "张三")

    def test_build_step2_input_payload_supports_segment_slice(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：第一句\n张三：第二句\n旁白：第三句",
            source_text="第一句\n第二句\n第三句",
        )
        payload = build_step2_input_payload(draft, start_index=1, end_index=3)
        self.assertEqual(len(payload["segments"]), 2)
        self.assertEqual(payload["segments"][0]["index"], 1)
        self.assertEqual(payload["segments"][1]["index"], 2)
        self.assertEqual(payload["source_text"], "第二句\n第三句")

    def test_merge_two_step_output_keeps_structure_and_applies_enrichment_rules(self) -> None:
        draft = parse_step1_lines_to_structured_draft("旁白：开场。\n老人：朝着前方走。", source_text="src")
        step2_script = Script(
            title="t",
            source_text="src",
            segments=[
                Segment(
                    id="x0",
                    index=0,
                    type="narration",
                    speaker="narrator",
                    text="开场。",
                    emotion="neutral",
                    non_verbal=[],
                    tts_overrides={},
                ),
                Segment(
                    id="x1",
                    index=1,
                    type="dialogue",
                    speaker="老人",
                    text="朝CHAO2着前方走。",
                    emotion="serious",
                    non_verbal=["question-en"],
                    tts_overrides={"speed": 1.05, "pitch": 1.2},
                ),
            ],
            characters=[],
            metadata={},
        )
        guard = analyze_two_step_structure_drift(draft, step2_script)
        merged = merge_two_step_output(
            structure_draft=draft,
            tts_script=step2_script,
            source_text="src",
            structure_guard=guard,
        )
        self.assertEqual(merged.segments[1].id, draft.segments[1].id)
        self.assertEqual(merged.segments[1].index, draft.segments[1].index)
        self.assertEqual(merged.segments[1].type, "dialogue")
        self.assertEqual(merged.segments[1].speaker, "老人")
        self.assertEqual(merged.segments[1].emotion, "serious")
        self.assertEqual(merged.segments[1].non_verbal, ["[question-en]"])
        self.assertTrue(merged.segments[1].text.startswith("[question-en] "))
        self.assertIn("朝CHAO2着前方走。", merged.segments[1].text)
        self.assertEqual(merged.segments[1].tts_overrides, {"speed": 1.05})

    def test_merge_two_step_output_falls_back_to_step1_text_when_semantics_changed(self) -> None:
        draft = parse_step1_lines_to_structured_draft("旁白：第一句。\n老人：原始句子。", source_text="src")
        step2_script = Script(
            title="t",
            source_text="src",
            segments=[
                Segment(
                    id="x0",
                    index=0,
                    type="narration",
                    speaker="narrator",
                    text="第一句。",
                    emotion="neutral",
                    non_verbal=[],
                    tts_overrides={},
                ),
                Segment(
                    id="x1",
                    index=1,
                    type="dialogue",
                    speaker="老人",
                    text="这句已经被改写了。",
                    emotion="sad",
                    non_verbal=[],
                    tts_overrides={},
                ),
            ],
            characters=[],
            metadata={},
        )
        guard = analyze_two_step_structure_drift(draft, step2_script)
        merged = merge_two_step_output(
            structure_draft=draft,
            tts_script=step2_script,
            source_text="src",
            structure_guard=guard,
        )
        self.assertEqual(merged.segments[1].text, "原始句子。")

    def test_merge_two_step_output_keeps_non_verbal_from_step1_text_when_step2_missing_it(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：门外忽然有人笑道：\n旁白：[laughter]\n有人：我早就料到！",
            source_text="门外忽然有人笑道：“我早就料到！”",
        )
        step2_script = Script(
            title="t",
            source_text="src",
            segments=[
                Segment(
                    id="x0",
                    index=0,
                    type="narration",
                    speaker="narrator",
                    text="门外忽然有人笑道：",
                    emotion="playful",
                    non_verbal=[],
                    tts_overrides={},
                ),
                Segment(
                    id="x1",
                    index=1,
                    type="dialogue",
                    speaker="有人",
                    text="我早就料到！",
                    emotion="playful",
                    non_verbal=[],
                    tts_overrides={},
                ),
            ],
            characters=[],
            metadata={},
        )
        guard = analyze_two_step_structure_drift(draft, step2_script)
        merged = merge_two_step_output(
            structure_draft=draft,
            tts_script=step2_script,
            source_text="src",
            structure_guard=guard,
        )
        self.assertEqual(merged.segments[1].text, "[laughter] 我早就料到！")
        self.assertEqual(merged.segments[1].non_verbal, ["[laughter]"])

    def test_merge_two_step_output_moves_non_verbal_from_leadin_narration_to_next_dialogue(self) -> None:
        draft = parse_step1_lines_to_structured_draft(
            "旁白：王婆低声问道：\n王婆：你可听清了？\n旁白：西门庆叹道：\n西门庆：唉，这事难办。",
            source_text="王婆低声问道：“你可听清了？”\n西门庆叹道：“唉，这事难办。”",
        )
        step2_script = Script(
            title="t",
            source_text="src",
            segments=[
                Segment(
                    id="x0",
                    index=0,
                    type="narration",
                    speaker="narrator",
                    text="[whisper] 王婆低声问道：",
                    emotion="serious",
                    non_verbal=["[whisper]"],
                    tts_overrides={},
                ),
                Segment(
                    id="x1",
                    index=1,
                    type="dialogue",
                    speaker="王婆",
                    text="你可听清了？",
                    emotion="concern",
                    non_verbal=[],
                    tts_overrides={},
                ),
                Segment(
                    id="x2",
                    index=2,
                    type="narration",
                    speaker="narrator",
                    text="[sigh] 西门庆叹道：",
                    emotion="melancholy",
                    non_verbal=["[sigh]"],
                    tts_overrides={},
                ),
                Segment(
                    id="x3",
                    index=3,
                    type="dialogue",
                    speaker="西门庆",
                    text="唉，这事难办。",
                    emotion="sad",
                    non_verbal=[],
                    tts_overrides={},
                ),
            ],
            characters=[],
            metadata={},
        )
        guard = analyze_two_step_structure_drift(draft, step2_script)
        merged = merge_two_step_output(
            structure_draft=draft,
            tts_script=step2_script,
            source_text="src",
            structure_guard=guard,
        )
        self.assertEqual(merged.segments[0].text, "王婆低声问道：")
        self.assertEqual(merged.segments[0].non_verbal, [])
        self.assertEqual(merged.segments[1].text, "[whisper] 你可听清了？")
        self.assertEqual(merged.segments[1].non_verbal, ["[whisper]"])
        self.assertEqual(merged.segments[2].text, "西门庆叹道：")
        self.assertEqual(merged.segments[2].non_verbal, [])
        self.assertEqual(merged.segments[3].text, "[sigh] 唉，这事难办。")
        self.assertEqual(merged.segments[3].non_verbal, ["[sigh]"])


if __name__ == "__main__":
    unittest.main()
