from __future__ import annotations

import unittest
import uuid
import wave

from fastapi.testclient import TestClient

from backend.main import app
from backend.state import get_app_state_from_app


class VoiceReferenceAudioRouteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._client_ctx = TestClient(app)
        cls.client = cls._client_ctx.__enter__()
        cls.app_state = get_app_state_from_app(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._client_ctx.__exit__(None, None, None)

    def test_reference_audio_serves_file_under_voices_dir(self) -> None:
        voices_dir = self.app_state.settings.voices_dir
        voices_dir.mkdir(parents=True, exist_ok=True)
        audio_path = voices_dir / f"ref-{uuid.uuid4().hex}.wav"

        try:
            with wave.open(str(audio_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(16000)
                wav_file.writeframes(b"\x00\x00" * 160)

            response = self.client.get("/api/v1/voices/reference-audio", params={"path": str(audio_path)})
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.headers["content-type"].startswith("audio/"))
            self.assertGreater(len(response.content), 0)
        finally:
            audio_path.unlink(missing_ok=True)

    def test_reference_audio_rejects_file_outside_voices_dir(self) -> None:
        outside_path = self.app_state.settings.output_dir / f"ref-{uuid.uuid4().hex}.wav"

        response = self.client.get("/api/v1/voices/reference-audio", params={"path": str(outside_path)})

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
