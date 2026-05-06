from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.models import Project, SegmentAsset, VoicePreset
from backend.services.tts_export_service import write_project_archive


class TtsExportServiceTest(unittest.TestCase):
    def test_write_project_archive_includes_expected_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output_dir = root / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            projects_dir = root / "projects"
            projects_dir.mkdir(parents=True, exist_ok=True)

            project = Project(name="archive-test")
            project.voice_assignments = {"narrator": "preset-1"}
            seg_audio_rel = f"projects/{project.id}/segments/seg-1.wav"
            seg_peaks_rel = f"projects/{project.id}/waveforms/segments/seg-1.peaks.json"
            full_wav_rel = f"projects/{project.id}/full/full.wav"
            full_peaks_rel = f"projects/{project.id}/waveforms/full.peaks.json"
            project.audio_assets.full_wav_relpath = full_wav_rel
            project.audio_assets.full_peaks_relpath = full_peaks_rel
            project.audio_assets.segments["seg-1"] = SegmentAsset(
                segment_id="seg-1",
                audio_relpath=seg_audio_rel,
                peaks_relpath=seg_peaks_rel,
                duration_ms=1200,
            )

            full_wav = output_dir / full_wav_rel
            full_wav.parent.mkdir(parents=True, exist_ok=True)
            full_wav.write_bytes(b"RIFFdemo-full")
            full_peaks = output_dir / full_peaks_rel
            full_peaks.parent.mkdir(parents=True, exist_ok=True)
            full_peaks.write_text(json.dumps({"version": 1, "levels": {"256": [1, 2]}}), encoding="utf-8")
            seg_audio = output_dir / seg_audio_rel
            seg_audio.parent.mkdir(parents=True, exist_ok=True)
            seg_audio.write_bytes(b"RIFFdemo-seg")
            seg_peaks = output_dir / seg_peaks_rel
            seg_peaks.parent.mkdir(parents=True, exist_ok=True)
            seg_peaks.write_text(json.dumps({"version": 1, "levels": {"256": [3, 4]}}), encoding="utf-8")

            project_json = projects_dir / f"{project.id}.json"
            project_json.write_text(json.dumps({"id": project.id, "name": project.name}), encoding="utf-8")

            ref_audio = root / "ref.wav"
            ref_audio.write_bytes(b"RIFFref")
            presets = [VoicePreset(id="preset-1", name="preset-1", ref_audio_path=str(ref_audio))]
            events = [
                {"source": "tts", "event": {"type": "progress"}, "task_id": "task-old"},
                {"source": "tts", "event": {"type": "complete"}, "task_id": "task-new"},
            ]

            archive_path = output_dir / f"{project.id}.archive.zip"
            write_project_archive(
                output_dir=output_dir,
                project=project,
                events=events,
                presets=presets,
                project_json_path=project_json,
                archive_path=archive_path,
            )

            self.assertTrue(archive_path.exists())
            with zipfile.ZipFile(archive_path, "r") as zf:
                names = set(zf.namelist())
                self.assertIn("audio/full/full.wav", names)
                self.assertIn("audio/segments/seg-1.wav", names)
                self.assertIn("waveforms/full.peaks.json", names)
                self.assertIn("waveforms/segments/seg-1.peaks.json", names)
                self.assertIn("project/project.json", names)
                self.assertIn("voices/presets.json", names)
                self.assertIn("voices/ref/ref.wav", names)
                self.assertIn("manifest.json", names)
                self.assertIn("exports/script.json", names)
                self.assertIn("exports/script.csv", names)
                self.assertIn("exports/timestamp_manifest.json", names)
                self.assertIn("exports/premiere_markers.csv", names)

                manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
                self.assertEqual(manifest["latest_tts_task_id"], "task-new")
                self.assertEqual(manifest["segment_count"], 1)
                self.assertEqual(manifest["preset_count"], 1)
                self.assertTrue(manifest["has_reference_audio"])
                self.assertIn("extended_export_files", manifest)


if __name__ == "__main__":
    unittest.main()
