from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.models import Project, Segment, SegmentAsset
from backend.services.tts_extended_export_service import build_extended_export_bytes, write_extended_export_file


class TtsExtendedExportServiceTest(unittest.TestCase):
    def _build_project(self) -> Project:
        project = Project(name="extended-export-test")
        project.script.title = "扩展导出测试"
        project.script.segments = [
            Segment(id="seg-1", index=0, type="narration", speaker="旁白", text="第一段", emotion="neutral"),
            Segment(id="seg-2", index=1, type="dialogue", speaker="甲", text="第二段", emotion="sad"),
        ]
        project.audio_assets.segments["seg-1"] = SegmentAsset(
            segment_id="seg-1",
            audio_relpath=f"projects/{project.id}/segments/seg-1.wav",
            duration_ms=1200,
        )
        project.audio_assets.segments["seg-2"] = SegmentAsset(
            segment_id="seg-2",
            audio_relpath=f"projects/{project.id}/segments/seg-2.wav",
            duration_ms=800,
        )
        project.synthesis_config.chapter_markers = []
        return project

    def test_build_timestamp_manifest_json_contains_expected_fields(self) -> None:
        project = self._build_project()
        content, media_type, filename = build_extended_export_bytes(
            project=project,
            kind="timestamp_manifest",
            fmt="json",
            variant="raw",
        )
        self.assertEqual(filename, "timestamp_manifest.json")
        self.assertIn("application/json", media_type)
        payload = json.loads(content.decode("utf-8"))
        self.assertEqual(payload["project_id"], project.id)
        self.assertEqual(payload["variant"], "raw")
        self.assertEqual(len(payload["items"]), 2)
        self.assertEqual(payload["items"][0]["start_ms"], 0)
        self.assertEqual(payload["items"][0]["end_ms"], 1200)
        self.assertGreater(payload["items"][1]["start_ms"], payload["items"][0]["end_ms"])

    def test_write_capcut_csv_and_ffmetadata(self) -> None:
        project = self._build_project()
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            capcut_path, capcut_media = write_extended_export_file(
                output_dir=output_dir,
                project=project,
                kind="capcut",
                fmt="csv",
                variant="raw",
            )
            self.assertTrue(capcut_path.exists())
            self.assertIn("text/csv", capcut_media)
            text = capcut_path.read_text(encoding="utf-8-sig")
            self.assertIn("segment_id", text)
            self.assertIn("seg-1", text)

            ffmeta_path, ffmeta_media = write_extended_export_file(
                output_dir=output_dir,
                project=project,
                kind="ffmetadata",
                fmt="txt",
                variant="raw",
            )
            self.assertTrue(ffmeta_path.exists())
            self.assertIn("text/plain", ffmeta_media)
            ffmeta_text = ffmeta_path.read_text(encoding="utf-8")
            self.assertIn(";FFMETADATA1", ffmeta_text)
            self.assertIn("title=", ffmeta_text)


if __name__ == "__main__":
    unittest.main()
