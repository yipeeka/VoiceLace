from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.models import Project
from backend.persistence import save_project
from backend.services.tts_delivery_service import (
    load_project_segment_peaks_payload,
    resolve_export_audio_response_path,
)


class TtsDeliveryServiceTest(unittest.TestCase):
    def test_resolve_export_audio_response_path_falls_back_to_generated_silence(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output_dir = root / "output"
            projects_dir = root / "projects"
            output_dir.mkdir(parents=True, exist_ok=True)
            projects_dir.mkdir(parents=True, exist_ok=True)
            project = save_project(projects_dir, Project(name="tts"))

            def _resolve_export_audio_path(*, output_dir, project, req_format):
                return output_dir / f"{project.id}.{req_format}", "audio/mpeg"

            path, media_type = resolve_export_audio_response_path(
                output_dir=output_dir,
                projects_dir=projects_dir,
                project_id=project.id,
                req_format="mp3",
                resolve_export_audio_path=_resolve_export_audio_path,
            )

            self.assertTrue(path.exists())
            self.assertEqual(path.suffix, ".wav")
            self.assertEqual(media_type, "audio/wav")

    def test_load_project_segment_peaks_payload_reads_json(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            output_dir = root / "output"
            projects_dir = root / "projects"
            output_dir.mkdir(parents=True, exist_ok=True)
            projects_dir.mkdir(parents=True, exist_ok=True)
            project = save_project(projects_dir, Project(name="tts"))
            peaks_path = output_dir / "p.json"
            peaks_path.write_text(json.dumps({"version": 1, "bins": 8}), encoding="utf-8")

            def _resolve_segment_peaks_path(*, output_dir, project, segment_id):
                return peaks_path if segment_id == "seg-1" else None

            payload = load_project_segment_peaks_payload(
                output_dir=output_dir,
                projects_dir=projects_dir,
                project_id=project.id,
                segment_id="seg-1",
                resolve_segment_peaks_path=_resolve_segment_peaks_path,
            )

            self.assertIsNotNone(payload)
            self.assertEqual(payload["project_id"], project.id)
            self.assertEqual(payload["segment_id"], "seg-1")
            self.assertEqual(payload["bins"], 8)


if __name__ == "__main__":
    unittest.main()
