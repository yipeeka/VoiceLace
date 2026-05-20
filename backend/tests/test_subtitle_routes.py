from __future__ import annotations

import unittest
import time

from fastapi.testclient import TestClient

from backend.main import app
from backend.state import get_app_state_from_app


class _FakeTranslationEngine:
    is_loaded = True
    backend_name = "fake"

    async def generate_text(self, *, text, system_prompt, llm_options):
        return f"{text}译"


class SubtitleRoutesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._client_ctx = TestClient(app)
        cls.client = cls._client_ctx.__enter__()
        cls.app_state = get_app_state_from_app(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._client_ctx.__exit__(None, None, None)

    def test_preview_srt_endpoint(self) -> None:
        content = b"1\n00:00:00,000 --> 00:00:01,000\nNarrator: hello\n"
        response = self.client.post(
            "/api/v1/subtitles/preview",
            data={"mode": "original", "line_policy": "auto"},
            files={"file": ("demo.srt", content, "text/plain")},
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["format"], "srt")
        self.assertEqual(body["segment_count"], 1)
        self.assertEqual(body["cues"][0]["speaker"], "Narrator")

    def test_preview_accepts_subtitle_text_without_file(self) -> None:
        response = self.client.post(
            "/api/v1/subtitles/preview",
            data={
                "mode": "original",
                "line_policy": "auto",
                "subtitle_text": "1\n00:00:00,000 --> 00:00:01,000\nEdited: hello\n",
            },
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["format"], "srt")
        self.assertEqual(body["cues"][0]["speaker"], "Edited")

    def test_preview_rejects_missing_file_and_text(self) -> None:
        response = self.client.post(
            "/api/v1/subtitles/preview",
            data={"mode": "original", "line_policy": "auto"},
        )
        self.assertEqual(response.status_code, 400)

    def test_create_original_subtitle_dubbing_project_endpoint(self) -> None:
        project_id = ""
        content = b"1\n00:00:00,000 --> 00:00:01,200\nhello\n"
        try:
            response = self.client.post(
                "/api/v1/subtitles/create-dubbing-project",
                data={
                    "project_name": "subtitle-api",
                    "mode": "original",
                    "target_language": "中文",
                    "translation_source": "secondary_local",
                    "line_policy": "auto",
                },
                files={"file": ("demo.srt", content, "text/plain")},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            project_id = body["project_id"]
            project = body["project"]
            self.assertTrue(project["synthesis_config"]["timeline_lock_enabled"])
            self.assertTrue(project["script"]["metadata"]["subtitle_source"])
            self.assertEqual(project["script"]["segments"][0]["source_end_ms"], 1200)
        finally:
            if project_id:
                self.client.delete(f"/api/v1/projects/{project_id}")

    def test_create_original_project_uses_subtitle_text(self) -> None:
        project_id = ""
        try:
            response = self.client.post(
                "/api/v1/subtitles/create-dubbing-project",
                data={
                    "project_name": "subtitle-text-api",
                    "mode": "original",
                    "target_language": "中文",
                    "translation_source": "secondary_local",
                    "line_policy": "auto",
                    "subtitle_text": "1\n00:00:00,000 --> 00:00:01,200\nedited line\n",
                },
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            project_id = body["project_id"]
            segment = body["project"]["script"]["segments"][0]
            self.assertEqual(segment["text"], "edited line")
            self.assertEqual(segment["source_text"], "edited line")
        finally:
            if project_id:
                self.client.delete(f"/api/v1/projects/{project_id}")

    def test_create_translated_requires_loaded_translation_engine(self) -> None:
        content = b"1\n00:00:00,000 --> 00:00:01,200\nhello\n"
        previous_source = self.app_state.translation_engine_source
        try:
            self.app_state.translation_engine_source = ""
            response = self.client.post(
                "/api/v1/subtitles/create-dubbing-project",
                data={
                    "project_name": "subtitle-api-translated",
                    "mode": "translated",
                    "target_language": "中文",
                    "translation_source": "secondary_local",
                    "line_policy": "auto",
                },
                files={"file": ("demo.srt", content, "text/plain")},
            )
            self.assertEqual(response.status_code, 400)
            self.assertIn("Translation engine", response.text)
        finally:
            self.app_state.translation_engine_source = previous_source

    def test_translate_preview_endpoint_returns_translated_segments(self) -> None:
        content = b"1\n00:00:00,000 --> 00:00:01,200\nhello\n"
        previous_engine = self.app_state.translation_llm_engine
        previous_source = self.app_state.translation_engine_source
        try:
            self.app_state.translation_llm_engine = _FakeTranslationEngine()
            self.app_state.translation_engine_source = "secondary_local"
            response = self.client.post(
                "/api/v1/subtitles/translate-preview",
                data={
                    "target_language": "中文",
                    "translation_source": "secondary_local",
                    "line_policy": "auto",
                    "max_concurrency": "2",
                },
                files={"file": ("demo.srt", content, "text/plain")},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["mode"], "translated")
            self.assertEqual(body["translated_segments"][0]["text"], "hello译")
            self.assertEqual(body["cues"][0]["translated_text"], "hello译")
        finally:
            self.app_state.translation_llm_engine = previous_engine
            self.app_state.translation_engine_source = previous_source

    def test_translate_preview_task_endpoint_returns_translated_segments(self) -> None:
        content = b"1\n00:00:00,000 --> 00:00:01,200\nhello\n"
        previous_engine = self.app_state.translation_llm_engine
        previous_source = self.app_state.translation_engine_source
        try:
            self.app_state.translation_llm_engine = _FakeTranslationEngine()
            self.app_state.translation_engine_source = "secondary_local"
            response = self.client.post(
                "/api/v1/subtitles/translate-preview/task",
                data={
                    "target_language": "中文",
                    "translation_source": "secondary_local",
                    "line_policy": "auto",
                    "max_concurrency": "1",
                    "subtitle_text": content.decode("utf-8"),
                },
            )
            self.assertEqual(response.status_code, 200)
            task_id = response.json()["task_id"]
            body = {}
            for _ in range(30):
                poll = self.client.get(f"/api/v1/subtitles/translate-preview/task/{task_id}")
                self.assertIn(poll.status_code, {200, 202})
                body = poll.json()
                if body.get("status") == "done":
                    break
                time.sleep(0.02)
            self.assertEqual(body.get("status"), "done")
            result = body["result"]
            self.assertEqual(result["mode"], "translated")
            self.assertEqual(result["translated_segments"][0]["text"], "hello译")
        finally:
            self.app_state.translation_llm_engine = previous_engine
            self.app_state.translation_engine_source = previous_source

    def test_create_translated_project_can_reuse_preview_payload(self) -> None:
        project_id = ""
        content = b"1\n00:00:00,000 --> 00:00:01,200\nhello\n"
        try:
            response = self.client.post(
                "/api/v1/subtitles/create-dubbing-project",
                data={
                    "project_name": "subtitle-translated-reuse",
                    "mode": "translated",
                    "target_language": "中文",
                    "translation_source": "secondary_local",
                    "line_policy": "auto",
                    "translated_segments": '[{"id":"sub-0001","text":"你好","tts_overrides":{"duration":1.2,"speed":0.9,"denoise":true}}]',
                },
                files={"file": ("demo.srt", content, "text/plain")},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            project_id = body["project_id"]
            segment = body["project"]["script"]["segments"][0]
            self.assertEqual(segment["text"], "你好")
            self.assertEqual(segment["source_text"], "hello")
            self.assertEqual(segment["tts_overrides"], {"duration": 1.2, "speed": 0.9, "denoise": True})
        finally:
            if project_id:
                self.client.delete(f"/api/v1/projects/{project_id}")


if __name__ == "__main__":
    unittest.main()
