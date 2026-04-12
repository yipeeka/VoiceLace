from __future__ import annotations

import uuid
import unittest
import json

from fastapi.testclient import TestClient

from backend.main import app
from backend.state import app_state


class ApiSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_root(self) -> None:
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("name", body)
        self.assertEqual(body.get("docs"), "/docs")

    def test_system_status_contains_backends(self) -> None:
        response = self.client.get("/api/v1/system/status")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("llm_backend", body)
        self.assertIn("tts_backend", body)
        self.assertIn("asr_backend", body)

    def test_default_prompt(self) -> None:
        response = self.client.get("/api/v1/llm/prompts/default")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body.get("prompt"))

    def test_update_orchestrator_llm_params(self) -> None:
        cfg_path = app_state.settings.runtime_config_path
        original_cfg = cfg_path.read_text(encoding="utf-8") if cfg_path.exists() else None
        payload = {
            "auto_serial": True,
            "auto_unload_llm_after_parse": True,
            "auto_load_tts_before_synth": True,
            "llm_backend": "openai",
            "llm_model_path": "unused-for-openai",
            "llm_api_model": "gpt-4.1-mini",
            "llm_n_ctx": 4096,
            "llm_n_gpu_layers": -1,
            "llm_threads": 8,
            "llm_temperature": 0.35,
            "llm_top_p": 0.92,
            "llm_top_k": 32,
            "llm_min_p": 0.05,
            "llm_presence_penalty": 0.1,
            "llm_repeat_penalty": 1.08,
            "llm_max_tokens": 1536,
            "tts_model_path": "k2-fsa/OmniVoice",
            "tts_device": "cuda:0",
            "asr_model_path": "E:/models/faster-whisper-large-v3",
            "asr_device": "cuda:0",
        }
        try:
            response = self.client.put("/api/v1/system/orchestrator/config", json=payload)
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["llm_backend"], "openai")
            self.assertEqual(body["llm_api_model"], "gpt-4.1-mini")
            self.assertEqual(body["llm_threads"], 8)
            self.assertEqual(body["asr_model_path"], "E:/models/faster-whisper-large-v3")
            self.assertAlmostEqual(body["llm_temperature"], 0.35, places=6)
            persisted = json.loads(cfg_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["llm_backend"], "openai")
            self.assertEqual(persisted["llm_threads"], 8)
        finally:
            if original_cfg is None:
                cfg_path.unlink(missing_ok=True)
            else:
                cfg_path.write_text(original_cfg, encoding="utf-8")

    def test_reset_orchestrator_config(self) -> None:
        response = self.client.post("/api/v1/system/orchestrator/config/reset", json={})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertIn("llm_backend", body)
        self.assertIn("llm_n_ctx", body)
        self.assertIn("tts_model_path", body)
        self.assertIn("asr_model_path", body)

    def test_project_crud(self) -> None:
        name = f"smoke-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": name})
        self.assertEqual(created.status_code, 200)
        project_id = created.json()["id"]

        fetched = self.client.get(f"/api/v1/projects/{project_id}")
        self.assertEqual(fetched.status_code, 200)
        self.assertEqual(fetched.json()["name"], name)

        deleted = self.client.delete(f"/api/v1/projects/{project_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["status"], "deleted")

    def test_transcribe_missing_file_returns_404(self) -> None:
        response = self.client.post(
            "/api/v1/voices/transcribe",
            json={"audio_path": "E:/softs/BeautyVoiceTTS/backend/data/voices/not_exists.wav"},
        )
        self.assertEqual(response.status_code, 404)
        body = response.json()
        self.assertEqual(body["code"], "http_404")
        self.assertIn("message", body)
        self.assertEqual(body["path"], "/api/v1/voices/transcribe")

    def test_validation_error_schema(self) -> None:
        response = self.client.post("/api/v1/voices/transcribe", json={})
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertEqual(body["code"], "validation_error")
        self.assertEqual(body["message"], "请求参数校验失败")
        self.assertIsInstance(body["details"], list)
        self.assertEqual(body["path"], "/api/v1/voices/transcribe")

    def test_create_preset_still_works_with_corrupted_preset_file(self) -> None:
        from backend.state import app_state

        original = ""
        existed = app_state.voice_manager.presets_file.exists()
        if existed:
            original = app_state.voice_manager.presets_file.read_text(encoding="utf-8")
        try:
            app_state.voice_manager.presets_file.write_text("{not-json", encoding="utf-8")
            response = self.client.post(
                "/api/v1/voices/presets",
                json={
                    "name": f"recover-{uuid.uuid4().hex[:6]}",
                    "voice_mode": "design",
                    "description": "recover from broken json",
                    "gender": "female",
                    "style": "calm",
                    "speed": 1.0,
                },
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["voice_mode"], "design")
            self.assertTrue(body["id"])
        finally:
            if existed:
                app_state.voice_manager.presets_file.write_text(original, encoding="utf-8")
            else:
                app_state.voice_manager.presets_file.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
