from __future__ import annotations

import unittest
import uuid

from fastapi.testclient import TestClient

from backend.main import app


class TtsDubbingBackendGuardTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._client_ctx = TestClient(app)
        cls.client = cls._client_ctx.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls._client_ctx.__exit__(None, None, None)

    def test_dubbing_project_allows_voxcpm2_backend(self) -> None:
        project_id = ""
        try:
            create_resp = self.client.post("/api/v1/projects", json={"name": f"dub-guard-{uuid.uuid4().hex[:8]}"})
            self.assertEqual(create_resp.status_code, 200)
            project_id = create_resp.json()["id"]

            update_resp = self.client.put(
                f"/api/v1/projects/{project_id}/script",
                json={
                    "title": "dub-guard",
                    "source_text": "测试",
                    "metadata": {"dubbing_source": True},
                    "segments": [
                        {
                            "id": "seg-1",
                            "index": 0,
                            "type": "dialogue",
                            "speaker": "说话人1",
                            "text": "测试台词",
                            "emotion": "neutral",
                            "non_verbal": [],
                            "tts_overrides": {},
                        }
                    ],
                    "characters": [],
                },
            )
            self.assertEqual(update_resp.status_code, 200)

            synth_resp = self.client.post(
                "/api/v1/tts/synthesize",
                json={
                    "project_id": project_id,
                    "config": {
                        "tts_backend": "voxcpm2",
                    },
                },
            )
            self.assertEqual(synth_resp.status_code, 200)
            self.assertTrue(synth_resp.json().get("task_id"))
        finally:
            if project_id:
                self.client.delete(f"/api/v1/projects/{project_id}")


if __name__ == "__main__":
    unittest.main()
