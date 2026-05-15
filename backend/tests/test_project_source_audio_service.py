from __future__ import annotations

import shutil
import unittest
import uuid
from pathlib import Path

from backend.models import Project, Segment
from backend.persistence import load_project, save_project
import backend.services.project_source_audio_service as service


class ProjectSourceAudioServiceTest(unittest.TestCase):
    def test_compute_source_audio_window_uses_current_script_segments(self) -> None:
        segments = [
            Segment(id="deleted-head", index=0, text="", source_start_ms=0, source_end_ms=1000),
            Segment(id="s1", index=1, text="保留第一段", source_start_ms=2200, source_end_ms=3500),
            Segment(id="s2", index=2, text="保留第二段", source_start_ms=4200, source_end_ms=5500),
            Segment(id="invalid", index=3, text="无效", source_start_ms=6500, source_end_ms=6500),
        ]

        self.assertEqual(service.compute_source_audio_window_from_segments(segments), (2200, 5500))

    def test_compute_source_audio_window_rejects_missing_source_timeline(self) -> None:
        with self.assertRaises(ValueError):
            service.compute_source_audio_window_from_segments([
                Segment(id="s1", index=0, text="没有时间轴"),
            ])

    def test_save_project_source_audio_mp3_updates_assets(self) -> None:
        root = Path("E:/softs/VoiceLace/tmp_test_outputs") / f"source-audio-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        try:
            output_dir = root / "output"
            projects_dir = root / "projects"
            output_dir.mkdir(parents=True, exist_ok=True)
            projects_dir.mkdir(parents=True, exist_ok=True)
            input_audio = root / "input.wav"
            input_audio.write_bytes(b"RIFFdemo")
            project = Project(name="demo")
            project.script.segments = [
                Segment(id="s1", index=0, text="你好", source_start_ms=1000, source_end_ms=2000),
                Segment(id="s2", index=1, text="世界", source_start_ms=2500, source_end_ms=4200),
            ]

            calls = []
            original_runner = service._run_ffmpeg_trim_to_mp3

            def fake_runner(input_path: Path, output_path: Path, *, start_ms: int, end_ms: int) -> None:
                calls.append((input_path, output_path, start_ms, end_ms))
                output_path.write_bytes(b"ID3demo")

            service._run_ffmpeg_trim_to_mp3 = fake_runner  # type: ignore[assignment]
            try:
                saved = service.save_project_source_audio_mp3(
                    project=project,
                    input_path=input_audio,
                    audio_name="input.wav",
                    output_dir=output_dir,
                )
            finally:
                service._run_ffmpeg_trim_to_mp3 = original_runner  # type: ignore[assignment]

            self.assertEqual(calls[0][2:], (1000, 4200))
            self.assertEqual(saved.audio_assets.source_audio_name, "input.wav")
            self.assertEqual(saved.audio_assets.source_audio_start_ms, 1000)
            self.assertEqual(saved.audio_assets.source_audio_end_ms, 4200)
            self.assertEqual(saved.audio_assets.source_audio_duration_ms, 3200)
            self.assertTrue((output_dir / saved.audio_assets.source_audio_mp3_relpath).exists())

            save_project(projects_dir, saved)
            reloaded = load_project(projects_dir, saved.id)
            self.assertEqual(reloaded.audio_assets.source_audio_mp3_relpath, saved.audio_assets.source_audio_mp3_relpath)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_old_project_audio_assets_are_compatible(self) -> None:
        project = Project.model_validate({"name": "legacy", "audio_assets": {}})
        self.assertIsNone(project.audio_assets.source_audio_mp3_relpath)
        self.assertIsNone(project.audio_assets.source_audio_start_ms)


if __name__ == "__main__":
    unittest.main()
