from __future__ import annotations

import json
import asyncio
import time
import unittest

from fastapi.testclient import TestClient

from backend.main import app
from backend.state import get_app_state_from_app


class DubbingTranslationTaskRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._client_ctx = TestClient(app)
        cls.client = cls._client_ctx.__enter__()
        cls.app_state = get_app_state_from_app(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._client_ctx.__exit__(None, None, None)

    def test_translate_dubbing_task_completes_and_can_be_polled(self) -> None:
        state = self.app_state
        engine = state.translation_llm_engine
        original_generate_text = engine.generate_text
        original_source = state.translation_engine_source
        original_is_loaded = engine.is_loaded
        original_backend_name = engine.backend_name
        try:
            engine.is_loaded = True
            engine.backend_name = "mock"
            state.translation_engine_source = "secondary_local"

            async def fake_generate_text(*, text: str, system_prompt: str, llm_options: dict | None = None):
                prompt = str(system_prompt or "")
                if "配音预处理助手" in prompt:
                    return "术语"
                if "JSON 数组" in prompt:
                    rows = json.loads(text)
                    return json.dumps([{"id": row["id"], "text": f"{row['text']}译"} for row in rows], ensure_ascii=False)
                return f"{text}译"

            engine.generate_text = fake_generate_text
            response = self.client.post(
                "/api/v1/llm/translate-dubbing-segments/task",
                json={
                    "source": "secondary_local",
                    "target_language": "中文",
                    "segments": [
                        {"id": "seg-1", "speaker": "说话人1", "text": "hello", "start_ms": 0, "end_ms": 1600}
                    ],
                },
            )
            self.assertEqual(response.status_code, 200)
            task_id = response.json()["task_id"]
            body = {}
            for _ in range(40):
                poll = self.client.get(f"/api/v1/llm/translate-dubbing-segments/task/{task_id}")
                self.assertIn(poll.status_code, {200, 202})
                body = poll.json()
                if body.get("status") == "done":
                    break
                time.sleep(0.05)
            self.assertEqual(body.get("status"), "done")
            result = body.get("result") or {}
            self.assertEqual(result["segments"][0]["text"], "hello译")
        finally:
            engine.generate_text = original_generate_text
            state.translation_engine_source = original_source
            engine.is_loaded = original_is_loaded
            engine.backend_name = original_backend_name

    def test_translate_dubbing_task_cancel_endpoint(self) -> None:
        state = self.app_state
        engine = state.translation_llm_engine
        original_generate_text = engine.generate_text
        original_source = state.translation_engine_source
        original_is_loaded = engine.is_loaded
        original_backend_name = engine.backend_name
        try:
            engine.is_loaded = True
            engine.backend_name = "mock"
            state.translation_engine_source = "secondary_local"

            async def fake_generate_text(*, text: str, system_prompt: str, llm_options: dict | None = None):
                await asyncio.sleep(0.2)
                return "[]"

            engine.generate_text = fake_generate_text
            response = self.client.post(
                "/api/v1/llm/translate-dubbing-segments/task",
                json={
                    "source": "secondary_local",
                    "target_language": "中文",
                    "segments": [
                        {"id": "seg-1", "speaker": "说话人1", "text": "hello", "start_ms": 0, "end_ms": 1600}
                    ],
                },
            )
            self.assertEqual(response.status_code, 200)
            task_id = response.json()["task_id"]
            cancel = self.client.post(f"/api/v1/llm/translate-dubbing-segments/task/{task_id}/cancel")
            self.assertEqual(cancel.status_code, 200)
            self.assertIn(cancel.json().get("status"), {"cancel_requested", "canceled"})
        finally:
            engine.generate_text = original_generate_text
            state.translation_engine_source = original_source
            engine.is_loaded = original_is_loaded
            engine.backend_name = original_backend_name


if __name__ == "__main__":
    unittest.main()
