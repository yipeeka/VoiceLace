from __future__ import annotations

import asyncio
import io
import time
import unittest
import uuid
import wave
from pathlib import Path
from unittest.mock import AsyncMock, patch
import zipfile

from fastapi.testclient import TestClient

from backend.main import app
from backend.models import Script, Segment
from backend.state import get_app_state_from_app


class TaskFlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._client_ctx = TestClient(app)
        cls.client = cls._client_ctx.__enter__()
        cls.app_state = get_app_state_from_app(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._client_ctx.__exit__(None, None, None)

    def _create_project(self, name_prefix: str = "task-flow") -> str:
        name = f"{name_prefix}-{uuid.uuid4().hex[:8]}"
        created = self.client.post("/api/v1/projects", json={"name": name})
        self.assertEqual(created.status_code, 200)
        return created.json()["id"]

    def _update_script(self, project_id: str, script_payload: dict) -> None:
        response = self.client.put(f"/api/v1/projects/{project_id}/script", json=script_payload)
        self.assertEqual(response.status_code, 200)

    def _wait_for_parse(self, task_id: str, timeout_s: float = 6.0) -> tuple[int, dict]:
        end = time.time() + timeout_s
        while time.time() < end:
            response = self.client.get(f"/api/v1/llm/parse/{task_id}")
            if response.status_code in {200, 500}:
                return response.status_code, response.json()
            time.sleep(0.05)
        response = self.client.get(f"/api/v1/llm/parse/{task_id}")
        return response.status_code, response.json()

    def _wait_for_tts(self, task_id: str, timeout_s: float = 8.0) -> tuple[int, dict]:
        end = time.time() + timeout_s
        while time.time() < end:
            response = self.client.get(f"/api/v1/tts/synthesize/{task_id}")
            body = response.json()
            if response.status_code == 200 and body.get("status") == "done":
                return response.status_code, body
            if response.status_code == 500:
                return response.status_code, body
            time.sleep(0.05)
        response = self.client.get(f"/api/v1/tts/synthesize/{task_id}")
        return response.status_code, response.json()

    def test_llm_parse_task_completes_and_persists(self) -> None:
        project_id = self._create_project("parse")
        parsed_script = Script(
            title="测试标题",
            source_text="输入文本",
            segments=[
                Segment(id="seg-1", index=0, type="narration", speaker="narrator", text="第一段"),
                Segment(id="seg-2", index=1, type="dialogue", speaker="A", text="第二段"),
            ],
        )

        parse_mock = AsyncMock(return_value=parsed_script)
        with (
            patch.object(self.app_state.orchestrator, "ensure_llm_ready", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.orchestrator, "unload_llm", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.llm_engine, "parse_text_chunked_stream", new=parse_mock),
        ):
            started = self.client.post(
                "/api/v1/llm/parse",
                json={"text": "输入文本", "project_id": project_id, "parse_mode": "legacy_single_pass"},
            )
            self.assertEqual(started.status_code, 200)
            task_id = started.json()["task_id"]

            status_code, body = self._wait_for_parse(task_id)
            self.assertEqual(status_code, 200)
            self.assertEqual(len(body["segments"]), 2)
            self.assertEqual(body["segments"][0]["text"], "第一段")
            self.assertTrue(parse_mock.await_count >= 1)
            parse_call = parse_mock.await_args_list[0]
            self.assertEqual(parse_call.kwargs.get("parse_mode"), "legacy_single_pass")
            self.assertIn("on_stage", parse_call.kwargs)

        fetched_script = self.client.get(f"/api/v1/projects/{project_id}/script")
        self.assertEqual(fetched_script.status_code, 200)
        self.assertEqual(len(fetched_script.json()["segments"]), 2)

    def test_llm_parse_cancel(self) -> None:
        project_id = self._create_project("cancel-parse")

        async def slow_parse(*args, **kwargs):
            await asyncio.sleep(1.2)
            return Script(
                title="slow",
                source_text="slow",
                segments=[Segment(id="s-1", index=0, type="narration", speaker="narrator", text="slow")],
            )

        with (
            patch.object(self.app_state.orchestrator, "ensure_llm_ready", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.orchestrator, "unload_llm", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.llm_engine, "parse_text_chunked_stream", new=AsyncMock(side_effect=slow_parse)),
        ):
            started = self.client.post(
                "/api/v1/llm/parse",
                json={"text": "will cancel", "project_id": project_id},
            )
            self.assertEqual(started.status_code, 200)
            task_id = started.json()["task_id"]

            canceled = self.client.post(f"/api/v1/llm/parse/{task_id}/cancel", json={})
            self.assertEqual(canceled.status_code, 200)
            self.assertIn(canceled.json()["status"], {"cancel_requested", "canceled"})

            time.sleep(0.2)
            check = self.client.get(f"/api/v1/llm/parse/{task_id}")
            self.assertEqual(check.status_code, 202)
            self.assertIn(check.json()["status"], {"cancel_requested", "canceled"})

    def test_tts_synthesis_task_completes(self) -> None:
        project_id = self._create_project("tts")
        self._update_script(
            project_id,
            {
                "title": "tts-test",
                "source_text": "tts",
                "segments": [
                    {"id": "seg-a", "index": 0, "type": "narration", "speaker": "narrator", "text": "A"},
                    {"id": "seg-b", "index": 1, "type": "dialogue", "speaker": "B", "text": "B"},
                ],
                "characters": [],
                "metadata": {},
            },
        )

        async def fake_synthesize(text, output_path: Path, preset=None, config=None, tts_overrides=None):
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(output_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\x00\x00" * 2205)
            return output_path

        with (
            patch.object(self.app_state.orchestrator, "ensure_tts_ready", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.tts_engine, "synthesize_to_file", new=AsyncMock(side_effect=fake_synthesize)),
        ):
            started = self.client.post(
                "/api/v1/tts/synthesize",
                json={"project_id": project_id},
            )
            self.assertEqual(started.status_code, 200)
            task_id = started.json()["task_id"]

            status_code, body = self._wait_for_tts(task_id)
            self.assertEqual(status_code, 200)
            self.assertEqual(body["status"], "done")
            self.assertEqual(body["progress"]["total"], 2)
            self.assertEqual(len(body["segments"]), 2)
            self.assertTrue(body["export_url"])

            export_resp = self.client.get(body["export_url"])
            self.assertEqual(export_resp.status_code, 200)
            self.assertIn(export_resp.headers.get("content-type", ""), {"audio/wav", "audio/x-wav"})

            subtitle_resp = self.client.get(f"/api/v1/tts/subtitle?project_id={project_id}&format=srt")
            self.assertEqual(subtitle_resp.status_code, 200)
            self.assertIn("text/plain", subtitle_resp.headers.get("content-type", ""))

            archive_resp = self.client.get(f"/api/v1/tts/export/{project_id}/archive")
            self.assertEqual(archive_resp.status_code, 200)
            self.assertIn("application/zip", archive_resp.headers.get("content-type", ""))

            project_resp = self.client.get(f"/api/v1/projects/{project_id}")
            self.assertEqual(project_resp.status_code, 200)
            project = project_resp.json()
            self.assertTrue(project["audio_assets"].get("full_peaks_relpath"))
            self.assertEqual(project["audio_assets"].get("full_peaks_levels"), [1024, 2048, 4096])
            seg_asset = project["audio_assets"]["segments"]["seg-a"]
            self.assertTrue(seg_asset.get("peaks_relpath"))
            self.assertGreater(seg_asset.get("peaks_bins", 0), 0)
            self.assertTrue(seg_asset.get("audio_sha256"))

            seg_peaks_resp = self.client.get(f"/api/v1/tts/projects/{project_id}/segments/seg-a/peaks")
            self.assertEqual(seg_peaks_resp.status_code, 200)
            seg_peaks = seg_peaks_resp.json()
            self.assertEqual(seg_peaks["segment_id"], "seg-a")
            self.assertEqual(seg_peaks["format"], "minmax_i16")
            self.assertGreater(seg_peaks["bins"], 0)
            self.assertTrue(seg_peaks["levels"])

            full_waveform_resp = self.client.get(f"/api/v1/tts/projects/{project_id}/waveform?level=1024")
            self.assertEqual(full_waveform_resp.status_code, 200)
            full_waveform = full_waveform_resp.json()
            self.assertEqual(full_waveform["project_id"], project_id)
            self.assertEqual(full_waveform["format"], "minmax_i16")
            self.assertGreaterEqual(full_waveform["level"], 1024)
            self.assertTrue(full_waveform["data"])

            with zipfile.ZipFile(io.BytesIO(archive_resp.content), "r") as zf:
                names = set(zf.namelist())
            self.assertIn("waveforms/full.peaks.json", names)
            self.assertIn("waveforms/segments/seg-a.peaks.json", names)
            self.assertIn("waveforms/segments/seg-b.peaks.json", names)

    def test_partial_synthesis_single_segment_without_rebuild_full(self) -> None:
        project_id = self._create_project("tts-partial-single")
        self._update_script(
            project_id,
            {
                "title": "tts-partial",
                "source_text": "tts-partial",
                "segments": [
                    {"id": "seg-a", "index": 0, "type": "narration", "speaker": "narrator", "text": "A"},
                    {"id": "seg-b", "index": 1, "type": "dialogue", "speaker": "B", "text": "B"},
                ],
                "characters": [],
                "metadata": {},
            },
        )

        async def fake_synthesize(text, output_path: Path, preset=None, config=None, tts_overrides=None):
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(output_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\x00\x00" * 2205)
            return output_path

        with (
            patch.object(self.app_state.orchestrator, "ensure_tts_ready", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.tts_engine, "synthesize_to_file", new=AsyncMock(side_effect=fake_synthesize)),
        ):
            started = self.client.post(
                "/api/v1/tts/synthesize/segments",
                json={"project_id": project_id, "segment_ids": ["seg-a"], "rebuild_full": False},
            )
            self.assertEqual(started.status_code, 200)
            task_id = started.json()["task_id"]

            status_code, body = self._wait_for_tts(task_id)
            self.assertEqual(status_code, 200)
            self.assertEqual(body["status"], "done")
            self.assertEqual(body["progress"]["total"], 1)
            self.assertIn("seg-a", body["segments"])
            self.assertNotIn("seg-b", body["segments"])

    def test_tts_overrides_are_forwarded_to_engine(self) -> None:
        project_id = self._create_project("tts-overrides-pass")
        unique_text = f"A-{uuid.uuid4().hex[:8]}"
        self._update_script(
            project_id,
            {
                "title": "tts-overrides",
                "source_text": "tts-overrides",
                "segments": [
                    {
                        "id": "seg-o1",
                        "index": 0,
                        "type": "narration",
                        "speaker": "narrator",
                        "text": unique_text,
                        "tts_overrides": {
                            "speed": 1,
                            "duration": 3.5,
                            "denoise": False,
                            "num_step": 24,
                            "guidance_scale": 2,
                        },
                    },
                ],
                "characters": [],
                "metadata": {},
            },
        )

        captured_overrides: list[dict] = []

        async def fake_synthesize(text, output_path: Path, preset=None, config=None, tts_overrides=None):
            captured_overrides.append(tts_overrides or {})
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(output_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\x00\x00" * 2205)
            return output_path

        with (
            patch.object(self.app_state.orchestrator, "ensure_tts_ready", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.tts_engine, "synthesize_to_file", new=AsyncMock(side_effect=fake_synthesize)),
        ):
            started = self.client.post("/api/v1/tts/synthesize", json={"project_id": project_id})
            self.assertEqual(started.status_code, 200)
            status_code, body = self._wait_for_tts(started.json()["task_id"])
            self.assertEqual(status_code, 200)
            self.assertEqual(body["status"], "done")

        self.assertEqual(len(captured_overrides), 1)
        self.assertEqual(
            captured_overrides[0],
            {
                "speed": 1.0,
                "duration": 3.5,
                "denoise": False,
                "num_step": 24,
                "guidance_scale": 2.0,
            },
        )

    def test_tts_overrides_unknown_field_fails_task(self) -> None:
        project_id = self._create_project("tts-overrides-invalid")
        self._update_script(
            project_id,
            {
                "title": "tts-overrides-invalid",
                "source_text": "tts-overrides-invalid",
                "segments": [
                    {
                        "id": "seg-invalid",
                        "index": 0,
                        "type": "narration",
                        "speaker": "narrator",
                        "text": "A",
                        "tts_overrides": {"temperature": 0.3},
                    },
                ],
                "characters": [],
                "metadata": {},
            },
        )

        with patch.object(self.app_state.orchestrator, "ensure_tts_ready", new=AsyncMock(return_value=None)):
            started = self.client.post("/api/v1/tts/synthesize", json={"project_id": project_id})
            self.assertEqual(started.status_code, 200)
            status_code, body = self._wait_for_tts(started.json()["task_id"])
            self.assertEqual(status_code, 500)
            self.assertIn("invalid tts_overrides", body["detail"])

    def test_transcribe_success_with_mocked_asr(self) -> None:
        audio_path = self.app_state.settings.voices_dir / f"asr-{uuid.uuid4().hex[:8]}.wav"
        with wave.open(str(audio_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(16000)
            wav_file.writeframes(b"\x00\x00" * 16000)

        with (
            patch.object(self.app_state.asr_engine, "transcribe", new=AsyncMock(return_value="hello world")),
            patch.object(self.app_state.asr_engine, "backend_name", "test-asr"),
        ):
            response = self.client.post(
                "/api/v1/voices/transcribe",
                json={"audio_path": str(audio_path)},
            )
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body["text"], "hello world")
            self.assertEqual(body["backend"], "test-asr")

    def test_delete_project_cleans_outputs_and_logs(self) -> None:
        project_id = self._create_project("delete-cleanup")
        self._update_script(
            project_id,
            {
                "title": "cleanup-test",
                "source_text": "cleanup",
                "segments": [
                    {"id": "seg-clean-1", "index": 0, "type": "narration", "speaker": "narrator", "text": "A"},
                ],
                "characters": [],
                "metadata": {},
            },
        )

        async def fake_synthesize(text, output_path: Path, preset=None, config=None, tts_overrides=None):
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with wave.open(str(output_path), "wb") as wav_file:
                wav_file.setnchannels(1)
                wav_file.setsampwidth(2)
                wav_file.setframerate(22050)
                wav_file.writeframes(b"\x00\x00" * 1102)
            return output_path

        with (
            patch.object(self.app_state.orchestrator, "ensure_tts_ready", new=AsyncMock(return_value=None)),
            patch.object(self.app_state.tts_engine, "synthesize_to_file", new=AsyncMock(side_effect=fake_synthesize)),
        ):
            started = self.client.post("/api/v1/tts/synthesize", json={"project_id": project_id})
            self.assertEqual(started.status_code, 200)
            task_id = started.json()["task_id"]
            status_code, body = self._wait_for_tts(task_id)
            self.assertEqual(status_code, 200)
            self.assertEqual(body["status"], "done")

        project_file = self.app_state.settings.projects_dir / f"{project_id}.json"
        event_file = self.app_state.settings.projects_dir / f"{project_id}.events.jsonl"
        task_dir = self.app_state.settings.output_dir / task_id
        wav_file = self.app_state.settings.output_dir / f"{project_id}.wav"
        srt_file = self.app_state.settings.output_dir / f"{project_id}.srt"
        lrc_file = self.app_state.settings.output_dir / f"{project_id}.lrc"

        self.assertTrue(project_file.exists())
        self.assertTrue(event_file.exists())
        self.assertTrue(task_dir.exists())
        self.assertTrue(wav_file.exists())
        self.assertTrue(srt_file.exists())
        self.assertTrue(lrc_file.exists())

        deleted = self.client.delete(f"/api/v1/projects/{project_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.json()["status"], "deleted")

        self.assertFalse(project_file.exists())
        self.assertFalse(event_file.exists())
        self.assertFalse(task_dir.exists())
        self.assertFalse(wav_file.exists())
        self.assertFalse(srt_file.exists())
        self.assertFalse(lrc_file.exists())


if __name__ == "__main__":
    unittest.main()
