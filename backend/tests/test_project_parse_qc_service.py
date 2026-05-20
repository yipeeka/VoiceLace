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
            self.assertEqual(report["profile"], "script_parse")
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

    def test_script_parse_project_still_reports_type_suspect(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc-script-type",
                script=Script(
                    source_text="旁白：开场。",
                    segments=[
                        Segment(id="s1", index=0, speaker="narrator", type="dialogue", text="旁白：开场。"),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)
            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertEqual(report["profile"], "script_parse")
            self.assertIn("type_suspect", issue_types)
            self.assertEqual(report["metrics"]["type_suspect_count"], 1)

    def test_dubbing_project_skips_type_suspect(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc-dubbing-type",
                script=Script(
                    source_text="narrator：Hello.",
                    metadata={"dubbing_source": True},
                    segments=[
                        Segment(
                            id="s1",
                            index=0,
                            speaker="narrator",
                            type="dialogue",
                            text="narrator：Hello.",
                            source_start_ms=0,
                            source_end_ms=3000,
                        ),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)
            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertEqual(report["profile"], "dubbing_timeline")
            self.assertNotIn("type_suspect", issue_types)
            self.assertEqual(report["metrics"]["type_suspect_count"], 0)
            self.assertIn("type_suspect", {item["check"] for item in report["skipped_checks"]})

    def test_dubbing_project_reports_missing_timeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc-dubbing-missing",
                script=Script(
                    metadata={"dubbing_source": True},
                    segments=[
                        Segment(id="s1", index=0, speaker="narrator", type="dialogue", text="第一句。"),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)
            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertIn("timeline_missing", issue_types)
            self.assertEqual(report["metrics"]["timeline_missing_count"], 1)

    def test_dubbing_project_reports_invalid_timeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc-dubbing-invalid",
                script=Script(
                    metadata={"dubbing_source": True},
                    segments=[
                        Segment(
                            id="s1",
                            index=0,
                            speaker="narrator",
                            type="dialogue",
                            text="第一句。",
                            source_start_ms=1000,
                            source_end_ms=1000,
                        ),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)
            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertIn("timeline_invalid", issue_types)
            self.assertEqual(report["metrics"]["timeline_invalid_count"], 1)

    def test_dubbing_project_reports_overlapping_timeline(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc-dubbing-overlap",
                script=Script(
                    metadata={"dubbing_source": True},
                    segments=[
                        Segment(
                            id="s1",
                            index=0,
                            speaker="narrator",
                            type="dialogue",
                            text="第一句。",
                            source_start_ms=0,
                            source_end_ms=2000,
                        ),
                        Segment(
                            id="s2",
                            index=1,
                            speaker="narrator",
                            type="dialogue",
                            text="第二句。",
                            source_start_ms=1500,
                            source_end_ms=3000,
                        ),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)
            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertIn("timeline_overlap", issue_types)
            self.assertEqual(report["metrics"]["timeline_overlap_count"], 1)

    def test_dubbing_project_reports_text_overrun(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            projects_dir = Path(tmp_dir)
            project = Project(
                name="qc-dubbing-overrun",
                script=Script(
                    metadata={"dubbing_source": True},
                    segments=[
                        Segment(
                            id="s1",
                            index=0,
                            speaker="narrator",
                            type="dialogue",
                            text="这是一段明显过长的配音文本，需要远远超过半秒才能说完。",
                            source_start_ms=0,
                            source_end_ms=500,
                        ),
                    ],
                ),
            )
            saved = save_project(projects_dir, project)
            report = build_project_parse_qc_report(saved.id, projects_dir=projects_dir)
            issue_types = {item.get("type") for item in report["issues"]}
            self.assertIn("timeline_text_overrun", issue_types)
            self.assertEqual(report["metrics"]["timeline_text_overrun_count"], 1)


if __name__ == "__main__":
    unittest.main()
