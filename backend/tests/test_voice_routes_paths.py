from __future__ import annotations

import asyncio
import io
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException, UploadFile

from backend.api.voice_routes import get_reference_audio, upload_reference_audio
from backend.engine.voice_manager import VoiceManager


def _wav_bytes() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        wav_file.writeframes(b"\x00\x00" * 160)
    return buffer.getvalue()


class VoiceRoutePathTest(unittest.TestCase):
    def _state(self, root: Path) -> SimpleNamespace:
        backend_dir = root / "backend"
        voices_dir = backend_dir / "data" / "voices"
        voices_dir.mkdir(parents=True, exist_ok=True)
        return SimpleNamespace(
            settings=SimpleNamespace(
                base_dir=backend_dir,
                voices_dir=voices_dir,
                output_dir=backend_dir / "data" / "output",
            ),
            voice_manager=VoiceManager(voices_dir, project_root=root),
        )

    def test_upload_reference_audio_returns_project_relative_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            state = self._state(Path(tmp_dir))
            upload = UploadFile(file=io.BytesIO(_wav_bytes()), filename="ref.wav")

            result = asyncio.run(upload_reference_audio(upload, state=state))

            self.assertEqual(result["file_path"], "backend/data/voices/ref.wav")

    def test_reference_audio_allows_relative_samples_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            state = self._state(root)
            sample_path = root / "samples" / "ref.wav"
            sample_path.parent.mkdir(parents=True, exist_ok=True)
            sample_path.write_bytes(_wav_bytes())

            response = asyncio.run(get_reference_audio("samples/ref.wav", state=state))

            self.assertEqual(Path(response.path), sample_path.resolve())

    def test_reference_audio_rejects_relative_output_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            state = self._state(root)
            output_path = root / "backend" / "data" / "output" / "ref.wav"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_bytes(_wav_bytes())

            with self.assertRaises(HTTPException) as ctx:
                asyncio.run(get_reference_audio("backend/data/output/ref.wav", state=state))

            self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
