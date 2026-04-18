from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project, SegmentAsset
from backend.services.tts_finalize_service import (
    resolve_partial_final_format,
    update_project_audio_assets_after_synthesis,
)


class TtsFinalizeServiceTest(unittest.TestCase):
    def test_resolve_partial_final_format_prefers_existing_mp3_when_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="finalize-partial")
            mp3_rel = f"projects/{project.id}/full/mix.mp3"
            wav_rel = f"projects/{project.id}/full/mix.wav"
            project.audio_assets.full_mp3_relpath = mp3_rel
            project.audio_assets.full_wav_relpath = wav_rel
            mp3_path = output_dir / mp3_rel
            mp3_path.parent.mkdir(parents=True, exist_ok=True)
            mp3_path.write_bytes(b"ID3")

            fmt = resolve_partial_final_format(output_dir=output_dir, project=project, output_format="mp3")
            self.assertEqual(fmt, "mp3")

    def test_update_project_audio_assets_after_synthesis_updates_full_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="finalize-update")
            wav_export = output_dir / "projects" / project.id / "full" / "mix.wav"
            mp3_export = output_dir / "projects" / project.id / "full" / "mix.mp3"
            srt_path = output_dir / "projects" / project.id / "subtitles" / "book.srt"
            lrc_path = output_dir / "projects" / project.id / "subtitles" / "book.lrc"
            full_peaks = output_dir / "projects" / project.id / "waveforms" / "full.peaks.json"
            for p, content in [
                (wav_export, b"RIFF"),
                (mp3_export, b"ID3"),
                (srt_path, b"1\n"),
                (lrc_path, b"[00:00]\n"),
                (full_peaks, b"{}"),
            ]:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(content)

            seg_asset = SegmentAsset(segment_id="seg-1", audio_relpath=f"projects/{project.id}/segments/seg-1.wav")
            update_project_audio_assets_after_synthesis(
                project=project,
                task_id="task-1",
                rebuild_full=True,
                segment_assets={"seg-1": seg_asset},
                output_dir=output_dir,
                wav_export_path=wav_export,
                mp3_export_path=mp3_export,
                srt_path=srt_path,
                lrc_path=lrc_path,
                full_peaks_path=full_peaks,
            )

            self.assertEqual(project.audio_assets.latest_task_id, "task-1")
            self.assertEqual(project.audio_assets.full_wav_relpath, f"projects/{project.id}/full/mix.wav")
            self.assertEqual(project.audio_assets.full_mp3_relpath, f"projects/{project.id}/full/mix.mp3")
            self.assertEqual(project.audio_assets.subtitle_srt_relpath, f"projects/{project.id}/subtitles/book.srt")
            self.assertEqual(project.audio_assets.subtitle_lrc_relpath, f"projects/{project.id}/subtitles/book.lrc")
            self.assertEqual(project.audio_assets.full_peaks_relpath, f"projects/{project.id}/waveforms/full.peaks.json")
            self.assertEqual(project.audio_assets.segments["seg-1"].segment_id, "seg-1")
            self.assertEqual(project.audio_assets.archive_schema_version, 2)


if __name__ == "__main__":
    unittest.main()
