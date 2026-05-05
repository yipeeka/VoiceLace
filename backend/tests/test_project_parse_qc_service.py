from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project, Script, Segment
from backend.persistence import save_project
from backend.services.project_parse_qc_service import build_project_parse_qc_report


class ProjectParseQcServiceTest(unittest.TestCase):
    def test_qc_report_contains_expected_issue_categories(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc",
                script=Script(
                    source_text="旁白：开场。小王：你好。小王：你好。",
                    segments=[
                        Segment(id="s1", index=0, speaker="narrator", type="dialogue", text="“开场”"),
                        Segment(id="s2", index=1, speaker="小 王", type="narration", text="你好。"),
                        Segment(id="s3", index=2, speaker="小王", type="dialogue", text="你好。"),
                        Segment(id="s4", index=3, speaker="角色@异常", type="dialogue", text="这是一段很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长的文本。"),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)

            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            self.assertIn("summary", report)
            self.assertIn("metrics", report)
            self.assertIn("issues", report)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertIn("character_inconsistent", issue_types)
            self.assertIn("character_abnormal", issue_types)
            self.assertIn("type_suspect", issue_types)
            self.assertIn("segment_too_long", issue_types)
            self.assertIn("segment_duplicate", issue_types)
            self.assertGreaterEqual(report["summary"]["issue_count"], 1)
            self.assertIn("coverage_ratio", report["summary"])

    def test_qc_coverage_ignores_non_verbal_prefix_for_dialogue(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc-nonverbal",
                script=Script(
                    source_text="书生长叹道：“走吧。”",
                    segments=[
                        Segment(id="s1", index=0, speaker="narrator", type="narration", text="书生长叹道："),
                        Segment(id="s2", index=1, speaker="书生", type="dialogue", text="[sigh] 走吧。"),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)
            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertNotIn("coverage_missing", issue_types)


if __name__ == "__main__":
    unittest.main()
