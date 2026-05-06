from __future__ import annotations

import json
import unittest
from pathlib import Path

from backend.models import Character, Project, Script, Segment, VoicePreset
from backend.services.voice_preset_service import (
    analyze_reference_audio,
    build_content_recommendation_payload,
    parse_content_recommendations,
    recommend_presets_for_project,
)


class VoicePresetServiceTest(unittest.TestCase):
    def test_analyze_reference_audio_returns_metrics_for_valid_wave(self) -> None:
        sample_path = (
            Path(__file__).resolve().parents[2]
            / ".venv"
            / "Lib"
            / "site-packages"
            / "gradio"
            / "media_assets"
            / "audio"
            / "audio_sample.wav"
        )
        self.assertTrue(sample_path.exists(), f"sample wav not found: {sample_path}")

        report = analyze_reference_audio(sample_path)
        self.assertIn(report.status, {"pass", "warning", "fail"})
        self.assertGreater(report.duration_sec, 0)
        self.assertGreater(report.sample_rate, 0)

    def test_recommend_presets_prioritizes_tag_and_description_match(self) -> None:
        project = Project(
            name="recommend-demo",
            script=Script(
                segments=[
                    Segment(id="s1", index=0, speaker="阿青", type="dialogue", text="请放心，我会陪着你。"),
                    Segment(id="s2", index=1, speaker="阿青", type="dialogue", text="慢慢来，不着急。"),
                ],
                characters=[
                    Character(name="阿青", description="温柔、细腻的年轻女声，语气平静"),
                ],
            ),
        )

        warm_preset = VoicePreset(
            id="p1",
            name="温柔姐姐",
            tags=["温柔", "女声", "平静"],
            suitable_role_description="适合知性温和的女性角色",
            description="语气细腻，表达克制",
        )
        dramatic_preset = VoicePreset(
            id="p2",
            name="硬汉战士",
            tags=["男声", "戏剧", "高张力"],
            suitable_role_description="适合战斗场景",
            description="情绪爆发力强",
        )

        result = recommend_presets_for_project(project, [warm_preset, dramatic_preset], backend="omnivoice", limit=2)
        rows = result["recommendations"]
        self.assertEqual(len(rows), 1)
        top = rows[0]["top"]
        self.assertEqual(top[0]["preset_id"], "p1")
        self.assertNotIn("p2", {item["preset_id"] for item in top})

    def test_build_content_recommendation_payload_contains_character_sample_text(self) -> None:
        project = Project(
            name="content-demo",
            script=Script(
                segments=[
                    Segment(id="s1", index=0, speaker="旁白", type="narration", text="天色骤暗，风声渐急。"),
                    Segment(id="s2", index=1, speaker="阿青", type="dialogue", text="别怕，我会一直在这里。"),
                ],
                characters=[Character(name="阿青", description="沉稳温柔")],
            ),
        )
        preset = VoicePreset(id="p1", name="温柔旁白")
        payload = build_content_recommendation_payload(project, [preset], backend="omnivoice", limit=3)

        self.assertEqual(payload["backend"], "omnivoice")
        self.assertEqual(payload["limit"], 3)
        self.assertEqual(len(payload["characters"]), 2)
        rows = {row["name"]: row for row in payload["characters"]}
        self.assertIn("阿青", rows)
        self.assertIn("别怕，我会一直在这里。", rows["阿青"]["sample_text"])

    def test_placeholder_character_description_is_not_used_for_content_recommendation(self) -> None:
        project = Project(
            name="placeholder-demo",
            script=Script(
                segments=[
                    Segment(id="s1", index=0, speaker="书生", type="dialogue", text="此事还须从长计议。"),
                    Segment(id="s2", index=1, speaker="童子", type="dialogue", text="先生，茶已经备好了。"),
                ],
                characters=[
                    Character(name="书生", description="书生 的角色档案"),
                    Character(name="童子", description="童子 的角色档案"),
                ],
            ),
        )
        male_preset = VoicePreset(id="p1", name="沉稳男声", description="Male, Chinese, Novel, Reliable")
        child_preset = VoicePreset(id="p2", name="童声", description="Child, Cartoon, Lively")
        female_preset = VoicePreset(id="p3", name="温柔女声", description="Female, Gentle, Warm")

        payload = build_content_recommendation_payload(project, [male_preset, child_preset, female_preset], backend="omnivoice", limit=2)
        rows = {row["name"]: row for row in payload["characters"]}
        self.assertEqual(rows["书生"]["description"], "")
        self.assertEqual(rows["童子"]["description"], "")

        result = recommend_presets_for_project(project, [male_preset, child_preset, female_preset], backend="omnivoice", limit=2)
        result_rows = {row["character"]: row["top"] for row in result["recommendations"]}
        self.assertEqual(result_rows["书生"][0]["preset_id"], "p1")
        self.assertEqual(result_rows["童子"][0]["preset_id"], "p2")

    def test_parse_content_recommendations_filters_unknown_preset(self) -> None:
        characters = [{"name": "阿青"}, {"name": "旁白"}]
        raw = json.dumps(
            {
                "recommendations": [
                    {
                        "character": "阿青",
                        "top": [
                            {"preset_id": "p1", "score": 91, "reasons": ["语气温和"]},
                            {"preset_id": "unknown", "score": 99, "reasons": ["应被过滤"]},
                        ],
                    },
                    {
                        "character": "旁白",
                        "top": [{"preset_id": "p2", "score": 88, "reasons": ["叙述感"]}],
                    },
                ]
            },
            ensure_ascii=False,
        )
        rows, warnings = parse_content_recommendations(
            raw,
            characters=characters,
            preset_ids={"p1", "p2"},
            limit=2,
        )

        row_map = {row["character"]: row["top"] for row in rows}
        self.assertEqual(len(row_map["阿青"]), 1)
        self.assertEqual(row_map["阿青"][0]["preset_id"], "p1")
        self.assertEqual(row_map["旁白"][0]["preset_id"], "p2")
        self.assertTrue(any("unknown" in warning for warning in warnings))

    def test_recommendation_uses_source_context_for_role_identity(self) -> None:
        source_text = (
            "晨雾未散，城门外已经排起了长队。差役来回踅行，嘴里不断催促，谁也不敢高声。\n"
            "老周朝前挪了两步，又回头对儿子说道：“把包袱扎紧，别散了。”\n"
            "儿子应道：“我省得。”\n"
            "旁边卖粥的汉子吆喝道：“热粥！新熬的热粥！”"
        )
        project = Project(
            name="source-context-demo",
            script=Script(
                source_text=source_text,
                segments=[
                    Segment(id="s1", index=0, speaker="narrator", type="narration", text="晨雾未散，城门外已经排起了长队。"),
                    Segment(id="s2", index=1, speaker="老周", type="dialogue", text="把包袱扎紧，别散了。"),
                    Segment(id="s3", index=2, speaker="儿子", type="dialogue", text="我省得。"),
                    Segment(id="s4", index=3, speaker="汉子", type="dialogue", text="热粥！新熬的热粥！"),
                ],
                characters=[
                    Character(name="老周", description="老周 的角色档案"),
                    Character(name="儿子", description="儿子 的角色档案"),
                    Character(name="汉子", description="汉子 的角色档案"),
                ],
            ),
        )
        old_male = VoicePreset(id="p1", name="沉稳男声", description="Male, old, reliable, professional")
        child_voice = VoicePreset(id="p2", name="少年童声", description="Child, young, cartoon, lively")
        narrator_voice = VoicePreset(id="p3", name="旁白声", description="Narrator, narration, calm, novel")

        payload = build_content_recommendation_payload(project, [old_male, child_voice, narrator_voice], backend="omnivoice", limit=2)
        rows = {row["name"]: row for row in payload["characters"]}
        self.assertIn("老周朝前挪了两步", rows["老周"]["source_context"])
        self.assertIn("儿子应道", rows["儿子"]["source_context"])

        result = recommend_presets_for_project(project, [old_male, child_voice, narrator_voice], backend="omnivoice", limit=2)
        top_by_character = {row["character"]: row["top"] for row in result["recommendations"]}
        self.assertEqual(top_by_character["老周"][0]["preset_id"], "p1")
        self.assertEqual(top_by_character["儿子"][0]["preset_id"], "p2")
        self.assertNotEqual(top_by_character["老周"][0]["preset_id"], top_by_character["儿子"][0]["preset_id"])


if __name__ == "__main__":
    unittest.main()
