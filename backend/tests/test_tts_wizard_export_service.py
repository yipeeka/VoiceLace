from __future__ import annotations

import json
import unittest
import zipfile
from pathlib import Path
import shutil
from uuid import uuid4

from backend.models import Project, Segment, SegmentAsset
from backend.services.tts_extended_export_service import write_extended_export_file
from backend.services.tts_wizard_export_service import build_wizard_export_bundle


class TtsWizardExportServiceTest(unittest.TestCase):
    def _build_project(self, output_dir: Path) -> Project:
        project = Project(name="wizard-export-test")
        project.script.title = "Wizard Demo"
        project.script.segments = [
            Segment(id="seg-1", index=0, type="narration", speaker="narrator", text="A"),
            Segment(id="seg-2", index=1, type="dialogue", speaker="A", text="B"),
        ]
        project.audio_assets.full_wav_relpath = f"projects/{project.id}/full/full.wav"
        project.audio_assets.full_mp3_relpath = f"projects/{project.id}/full/full.mp3"
        project.audio_assets.subtitle_srt_relpath = f"projects/{project.id}/subtitles/full.srt"
        project.audio_assets.subtitle_lrc_relpath = f"projects/{project.id}/subtitles/full.lrc"
        project.audio_assets.segments["seg-1"] = SegmentAsset(
            segment_id="seg-1",
            audio_relpath=f"projects/{project.id}/segments/seg-1.wav",
            duration_ms=1000,
        )
        project.audio_assets.segments["seg-2"] = SegmentAsset(
            segment_id="seg-2",
            audio_relpath=f"projects/{project.id}/segments/seg-2.wav",
            duration_ms=800,
        )
        project.audio_assets.processed.full_wav_relpath = f"projects/{project.id}/processed/processed.wav"
        project.audio_assets.processed.full_mp3_relpath = f"projects/{project.id}/processed/processed.mp3"
        project.audio_assets.processed.chapters = [
            {
                "id": "ch1",
                "title": "章节 1",
                "start_segment_id": "seg-1",
                "end_segment_id": "seg-2",
                "start_ms": 0,
                "end_ms": 1800,
                "duration_ms": 1800,
                "wav_relpath": f"projects/{project.id}/processed/chapters/ch1.wav",
                "mp3_relpath": f"projects/{project.id}/processed/chapters/ch1.mp3",
            }
        ]

        fixtures = [
            project.audio_assets.full_wav_relpath,
            project.audio_assets.full_mp3_relpath,
            project.audio_assets.subtitle_srt_relpath,
            project.audio_assets.subtitle_lrc_relpath,
            project.audio_assets.processed.full_wav_relpath,
            project.audio_assets.processed.full_mp3_relpath,
            project.audio_assets.processed.chapters[0]["wav_relpath"],
            project.audio_assets.processed.chapters[0]["mp3_relpath"],
        ]
        for relpath in fixtures:
            file_path = output_dir / relpath
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_bytes(b"demo")
        return project

    def test_build_wizard_bundle_for_audiobook(self) -> None:
        tmp_root = Path.cwd() / ".tmp_test_outputs"
        output_dir = tmp_root / f"wizard-{uuid4().hex[:8]}"
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            project = self._build_project(output_dir)
            bundle_path, manifest = build_wizard_export_bundle(
                output_dir=output_dir,
                project=project,
                preset="audiobook",
                variant="processed",
                write_extended_export_file=write_extended_export_file,
            )
            self.assertTrue(bundle_path.exists())
            self.assertEqual(manifest["preset"], "audiobook")
            self.assertGreater(manifest["included_count"], 0)
            with zipfile.ZipFile(bundle_path, "r") as zf:
                names = set(zf.namelist())
                self.assertIn("audio/full.wav", names)
                self.assertIn("audio/full.mp3", names)
                self.assertIn("chapters/ch1.wav", names)
                self.assertIn("metadata/metadata.ffmetadata", names)
                self.assertIn("manifest.json", names)
                payload = json.loads(zf.read("manifest.json").decode("utf-8"))
                self.assertEqual(payload["preset"], "audiobook")
        finally:
            shutil.rmtree(output_dir, ignore_errors=True)

    def test_build_wizard_bundle_for_editing_and_data(self) -> None:
        tmp_root = Path.cwd() / ".tmp_test_outputs"
        output_dir = tmp_root / f"wizard-{uuid4().hex[:8]}"
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            project = self._build_project(output_dir)

            editing_bundle, editing_manifest = build_wizard_export_bundle(
                output_dir=output_dir,
                project=project,
                preset="editing",
                variant="raw",
                write_extended_export_file=write_extended_export_file,
            )
            self.assertTrue(editing_bundle.exists())
            self.assertEqual(editing_manifest["preset"], "editing")
            with zipfile.ZipFile(editing_bundle, "r") as zf:
                names = set(zf.namelist())
                self.assertIn("editing/capcut.csv", names)
                self.assertIn("editing/premiere_markers.csv", names)

            data_bundle, data_manifest = build_wizard_export_bundle(
                output_dir=output_dir,
                project=project,
                preset="data",
                variant="raw",
                write_extended_export_file=write_extended_export_file,
            )
            self.assertTrue(data_bundle.exists())
            self.assertEqual(data_manifest["preset"], "data")
            with zipfile.ZipFile(data_bundle, "r") as zf:
                names = set(zf.namelist())
                self.assertIn("data/script.json", names)
                self.assertIn("data/timestamp_manifest.csv", names)
        finally:
            shutil.rmtree(output_dir, ignore_errors=True)

    def test_timestamp_manifest_uses_source_timeline_for_dubbing_project(self) -> None:
        tmp_root = Path.cwd() / ".tmp_test_outputs"
        output_dir = tmp_root / f"wizard-{uuid4().hex[:8]}"
        output_dir.mkdir(parents=True, exist_ok=True)
        try:
            project = self._build_project(output_dir)
            project.script.metadata = {**(project.script.metadata or {}), "dubbing_source": True}
            project.script.segments[0].source_start_ms = 120
            project.script.segments[1].source_start_ms = 2500

            manifest_path, _ = write_extended_export_file(
                output_dir=output_dir,
                project=project,
                kind="timestamp_manifest",
                fmt="json",
                variant="raw",
                profile="podcast",
            )
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
            items = payload.get("items") or []
            self.assertEqual(len(items), 2)
            self.assertEqual(int(items[0]["start_ms"]), 120)
            self.assertEqual(int(items[1]["start_ms"]), 2500)
        finally:
            shutil.rmtree(output_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
