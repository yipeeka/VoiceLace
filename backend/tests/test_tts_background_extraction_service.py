from __future__ import annotations

import asyncio
from pathlib import Path
import shutil
from types import SimpleNamespace
import unittest
import uuid
from unittest.mock import patch

from fastapi import HTTPException

from backend.models import Project
from backend.persistence import load_project, save_project
from backend.services.audio_vocal_separation_service import VocalSeparationResult
from backend.services.tts_background_extraction_service import (
    resolve_project_background_source_audio,
    run_background_extraction_task,
)
from backend.services.tts_lifecycle_service import create_tts_task_record


TEST_OUTPUT_ROOT = Path(__file__).resolve().parents[2] / "tmp_test_outputs"


class _Realtime:
    async def publish(self, *_args, **_kwargs) -> None:
        return None


class TtsBackgroundExtractionServiceTest(unittest.TestCase):
    def test_resolve_source_audio_prefers_wav_and_falls_back_to_mp3(self) -> None:
        root = TEST_OUTPUT_ROOT / f"bg-resolve-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        try:
            output_dir = root / "output"
            output_dir.mkdir(parents=True, exist_ok=True)
            wav = output_dir / "projects" / "demo" / "source_audio" / "source.wav"
            mp3 = output_dir / "projects" / "demo" / "source_audio" / "source.mp3"
            wav.parent.mkdir(parents=True, exist_ok=True)
            wav.write_bytes(b"RIFFdemo")
            mp3.write_bytes(b"ID3demo")
            project = Project(name="demo")
            project.audio_assets.source_audio_wav_relpath = "projects/demo/source_audio/source.wav"
            project.audio_assets.source_audio_mp3_relpath = "projects/demo/source_audio/source.mp3"

            source, warnings = resolve_project_background_source_audio(output_dir=output_dir, project=project)
            self.assertEqual(source, wav)
            self.assertEqual(warnings, [])

            project.audio_assets.source_audio_wav_relpath = None
            source, warnings = resolve_project_background_source_audio(output_dir=output_dir, project=project)
            self.assertEqual(source, mp3)
            self.assertTrue(warnings)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_resolve_source_audio_rejects_missing_source(self) -> None:
        project = Project(name="demo")
        with self.assertRaises(HTTPException):
            resolve_project_background_source_audio(output_dir=Path("missing"), project=project)

    def test_run_background_extraction_binds_ambience_track(self) -> None:
        root = TEST_OUTPUT_ROOT / f"bg-run-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        try:
            output_dir = root / "output"
            projects_dir = root / "projects"
            output_dir.mkdir(parents=True, exist_ok=True)
            projects_dir.mkdir(parents=True, exist_ok=True)

            project = Project(name="demo")
            source = output_dir / "projects" / project.id / "source_audio" / "source.wav"
            source.parent.mkdir(parents=True, exist_ok=True)
            source.write_bytes(b"RIFFdemo")
            project.audio_assets.source_audio_wav_relpath = f"projects/{project.id}/source_audio/source.wav"
            save_project(projects_dir, project)

            state = SimpleNamespace(
                settings=SimpleNamespace(projects_dir=projects_dir, output_dir=output_dir),
                tts_tasks={},
                realtime=_Realtime(),
                orchestrator=SimpleNamespace(
                    config=SimpleNamespace(
                        asr_vocal_separation_model="htdemucs",
                        asr_vocal_separation_repo_dir=str(root),
                        asr_vocal_separation_device="cpu",
                        asr_device="cpu",
                    )
                ),
            )
            task_id = "task-bg"
            state.tts_tasks[task_id] = create_tts_task_record(task_id=task_id, project_id=project.id, kind="extract_background")

            async def fake_prepare(audio_path, *, enabled, model, repo_dir, device, work_dir):
                self.assertEqual(Path(audio_path), source)
                background = Path(work_dir) / "no_vocals.wav"
                background.write_bytes(b"RIFFbackground")
                return VocalSeparationResult(
                    audio_path=background,
                    enabled=enabled,
                    used=True,
                    model=model,
                    repo_dir=repo_dir,
                    warnings=[],
                    background_path=background,
                )

            with patch("backend.services.tts_background_extraction_service.prepare_background_audio_for_remix", side_effect=fake_prepare):
                asyncio.run(run_background_extraction_task(task_id=task_id, project_id=project.id, state=state, logger=SimpleNamespace(exception=lambda *a, **k: None)))

            task = state.tts_tasks[task_id]
            self.assertEqual(task["status"], "done")
            reloaded = load_project(projects_dir, project.id)
            self.assertTrue(reloaded.synthesis_config.postprocess_enabled)
            self.assertTrue(reloaded.synthesis_config.ambience_track.relpath.endswith("ambience_from_source.wav"))
            self.assertFalse(reloaded.synthesis_config.ambience_track.loop)
            self.assertEqual(reloaded.synthesis_config.ambience_track.gain_db, -8.0)
            self.assertTrue((output_dir / reloaded.synthesis_config.ambience_track.relpath).exists())
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
