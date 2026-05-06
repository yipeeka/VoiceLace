from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.models import Project
from backend.services.tts_query_service import (
    build_project_waveform_response,
    resolve_export_audio_path,
    resolve_subtitle_path,
)


class TtsQueryServiceTest(unittest.TestCase):
    def test_resolve_export_audio_path_prefers_mp3_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="export-query")
            project.audio_assets.full_mp3_relpath = f"projects/{project.id}/full/full.mp3"
            project.audio_assets.full_wav_relpath = f"projects/{project.id}/full/full.wav"

            path, media_type = resolve_export_audio_path(output_dir=output_dir, project=project, req_format="mp3")

            self.assertTrue(str(path).endswith("full.mp3"))
            self.assertEqual(media_type, "audio/mpeg")

    def test_resolve_export_audio_path_supports_processed_variant(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="export-processed")
            project.audio_assets.processed.full_wav_relpath = f"projects/{project.id}/processed/processed.wav"
            path, media_type = resolve_export_audio_path(
                output_dir=output_dir,
                project=project,
                req_format="wav",
                variant="processed",
            )
            self.assertTrue(str(path).endswith("processed.wav"))
            self.assertEqual(media_type, "audio/wav")

    def test_resolve_subtitle_path_prefers_relpath(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="subtitle-query")
            project.audio_assets.subtitle_srt_relpath = f"projects/{project.id}/subtitles/full.srt"

            path = resolve_subtitle_path(output_dir=output_dir, project_id=project.id, project=project, fmt="srt")

            self.assertTrue(str(path).endswith("full.srt"))

    def test_build_project_waveform_response_uses_requested_level_or_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="wave-query")
            peaks_rel = f"projects/{project.id}/waveforms/full.peaks.json"
            project.audio_assets.full_peaks_relpath = peaks_rel

            peaks_path = output_dir / peaks_rel
            peaks_path.parent.mkdir(parents=True, exist_ok=True)
            peaks_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "format": "minmax_i16",
                        "duration_ms": 1000,
                        "sample_rate": 24000,
                        "channels": 1,
                        "bins": 256,
                        "levels": {"256": [1, 2], "512": [3, 4]},
                    }
                ),
                encoding="utf-8",
            )

            payload = build_project_waveform_response(
                output_dir=output_dir,
                project_id=project.id,
                project=project,
                level=512,
            )
            self.assertEqual(payload["level"], 512)
            self.assertEqual(payload["data"], [3, 4])
            self.assertEqual(payload["levels"], [256, 512])

            fallback_payload = build_project_waveform_response(
                output_dir=output_dir,
                project_id=project.id,
                project=project,
                level=999,
            )
            self.assertEqual(fallback_payload["level"], 256)
            self.assertEqual(fallback_payload["data"], [1, 2])


if __name__ == "__main__":
    unittest.main()
