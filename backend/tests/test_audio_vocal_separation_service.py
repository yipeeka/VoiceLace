from __future__ import annotations

import asyncio
import shutil
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from backend.services.audio_vocal_separation_service import (
    build_vocal_separation_status,
    normalize_demucs_model,
    prepare_background_audio_for_remix,
    prepare_vocal_audio_for_asr,
)


TEST_OUTPUT_ROOT = Path(__file__).resolve().parents[2] / "tmp_test_outputs"


class AudioVocalSeparationServiceTest(unittest.TestCase):
    def test_normalize_demucs_model_falls_back_to_htdemucs(self) -> None:
        self.assertEqual(normalize_demucs_model("htdemucs_ft"), "htdemucs_ft")
        self.assertEqual(normalize_demucs_model("bad-model"), "htdemucs")

    def test_repo_missing_returns_original_audio_without_running_demucs(self) -> None:
        root = TEST_OUTPUT_ROOT / f"vocal-sep-missing-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True, exist_ok=True)
        try:
            audio = root / "sample.wav"
            audio.write_bytes(b"RIFFdemo")
            with patch("backend.services.audio_vocal_separation_service.subprocess.run") as run_mock:
                result = asyncio.run(
                    prepare_vocal_audio_for_asr(
                        audio,
                        enabled=True,
                        model="htdemucs",
                        repo_dir=str(root / "missing"),
                        device="cpu",
                        work_dir=root / "work",
                    )
                )
            self.assertEqual(result.audio_path, audio)
            self.assertFalse(result.used)
            self.assertTrue(result.warnings)
            run_mock.assert_not_called()
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_demucs_success_returns_vocals_path(self) -> None:
        root = TEST_OUTPUT_ROOT / f"vocal-sep-success-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True, exist_ok=True)
        try:
            audio = root / "sample.wav"
            audio.write_bytes(b"RIFFdemo")
            repo = root / "repo"
            repo.mkdir()

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and "-m" in cmd and "demucs.separate" in cmd:
                    env = kwargs.get("env") or {}
                    self.assertEqual(env.get("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"), "1")
                    self.assertNotIn("TORCH_FORCE_WEIGHTS_ONLY_LOAD", env)
                    vocals = root / "work" / "demucs" / "htdemucs" / "input" / "vocals.wav"
                    vocals.parent.mkdir(parents=True, exist_ok=True)
                    vocals.write_bytes(b"vocals")
                    (vocals.parent / "no_vocals.wav").write_bytes(b"background")
                    return _Proc(returncode=0)
                return _Proc(returncode=0)

            with patch("backend.services.audio_vocal_separation_service.subprocess.run", side_effect=fake_run):
                result = asyncio.run(
                    prepare_vocal_audio_for_asr(
                        audio,
                        enabled=True,
                        model="htdemucs_ft",
                        repo_dir=str(repo),
                        device="cpu",
                        work_dir=root / "work",
                    )
                )
            self.assertTrue(result.used)
            self.assertEqual(result.model, "htdemucs_ft")
            self.assertEqual(result.audio_path.name, "vocals.wav")
            self.assertEqual(result.background_path.name, "no_vocals.wav")
            self.assertFalse(result.warnings)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_background_success_returns_no_vocals_path(self) -> None:
        root = TEST_OUTPUT_ROOT / f"background-sep-success-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True, exist_ok=True)
        try:
            audio = root / "sample.wav"
            audio.write_bytes(b"RIFFdemo")
            repo = root / "repo"
            repo.mkdir()

            class _Proc:
                def __init__(self, returncode=0, stdout="", stderr=""):
                    self.returncode = returncode
                    self.stdout = stdout
                    self.stderr = stderr

            def fake_run(cmd, *args, **kwargs):
                if isinstance(cmd, list) and "-m" in cmd and "demucs.separate" in cmd:
                    out_dir = root / "work" / "demucs" / "htdemucs" / "input"
                    out_dir.mkdir(parents=True, exist_ok=True)
                    (out_dir / "vocals.wav").write_bytes(b"vocals")
                    (out_dir / "no_vocals.wav").write_bytes(b"background")
                    return _Proc(returncode=0)
                return _Proc(returncode=0)

            with patch("backend.services.audio_vocal_separation_service.subprocess.run", side_effect=fake_run):
                result = asyncio.run(
                    prepare_background_audio_for_remix(
                        audio,
                        enabled=True,
                        model="htdemucs",
                        repo_dir=str(repo),
                        device="cpu",
                        work_dir=root / "work",
                    )
                )
            self.assertTrue(result.used)
            self.assertEqual(result.audio_path.name, "no_vocals.wav")
            self.assertEqual(result.background_path.name, "no_vocals.wav")
            self.assertFalse(result.warnings)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_status_reports_repo_availability(self) -> None:
        root = TEST_OUTPUT_ROOT / f"vocal-sep-status-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        root.mkdir(parents=True, exist_ok=True)
        try:
            status = build_vocal_separation_status(
                enabled=True,
                model="htdemucs",
                repo_dir=str(root),
                device="cuda:0",
            )
            self.assertTrue(status["available"])
            self.assertTrue(status["repo_dir_exists"])
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
