from __future__ import annotations

import unittest
from pathlib import Path

from backend.models import Character, Project, Script, Segment, VoicePreset
from backend.services.voice_preset_service import analyze_reference_audio, recommend_presets_for_project


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
        self.assertGreater(top[0]["score"], top[1]["score"])


if __name__ == "__main__":
    unittest.main()
