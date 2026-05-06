from __future__ import annotations

import asyncio
import unittest
import uuid
import shutil
from pathlib import Path
from types import SimpleNamespace

from backend.models import LlmParseRequest
from backend.persistence import load_project, read_project_events
from backend.services.asr_project_service import create_project_from_audio


class _FakeAsrEngine:
    def __init__(self, fail_chunk_name: str | None = None, fail_all: bool = False) -> None:
        self._fail_chunk_name = fail_chunk_name
        self._fail_all = fail_all

    async def transcribe(self, audio_path: str, *, backend: str = "whisper", speaker_labels: bool = False):
        if self._fail_all:
            raise RuntimeError("chunk failed")
        if self._fail_chunk_name and Path(audio_path).stem == self._fail_chunk_name:
            raise RuntimeError("chunk failed")
        return {
            "text": "你好",
            "labeled_text": "说话人1：你好",
            "alignments": [
                {
                    "id": "seg-1",
                    "start_ms": 0,
                    "end_ms": 1200,
                    "text": "你好",
                    "speaker": "说话人1" if speaker_labels else "",
                }
            ],
            "warnings": [],
        }


class AsrProjectServiceTest(unittest.TestCase):
    def test_partial_failed_still_creates_project_and_events(self) -> None:
        root = Path("E:/softs/BeautyVoiceTTS/tmp_test_outputs") / f"asr-project-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        try:
            projects_dir = root / "projects"
            output_dir = root / "output"
            projects_dir.mkdir(parents=True, exist_ok=True)
            output_dir.mkdir(parents=True, exist_ok=True)
            state = SimpleNamespace(
                settings=SimpleNamespace(projects_dir=projects_dir, output_dir=output_dir),
                asr_engine=_FakeAsrEngine(fail_chunk_name="chunk_0001"),
            )
            audio = output_dir / "sample.wav"
            audio.write_bytes(b"RIFFdemo")
            queued: list[LlmParseRequest] = []

            def enqueue(_state, payload: LlmParseRequest) -> str:
                queued.append(payload)
                return "parse-task-1"

            from backend.services import asr_project_service as service

            async def run() -> dict:
                return await create_project_from_audio(
                    state=state,
                    audio_path=audio,
                    audio_name="sample.wav",
                    project_name="",
                    speaker_labels=True,
                    parse_mode="verified_five_step_pipeline",
                    auto_parse=True,
                    speaker_map={"说话人1": "主讲人"},
                    enqueue_parse_task=enqueue,
                )

            original_probe = service._probe_audio_duration_ms
            original_extract = service._extract_chunk
            service._probe_audio_duration_ms = lambda _path: 2 * service.CHUNK_DURATION_MS + 5000  # type: ignore[assignment]
            service._extract_chunk = lambda _in, _out, _s, _e: None  # type: ignore[assignment]
            try:
                payload = asyncio.run(run())
            finally:
                service._probe_audio_duration_ms = original_probe  # type: ignore[assignment]
                service._extract_chunk = original_extract  # type: ignore[assignment]

            self.assertEqual(payload["status"], "partial_failed")
            self.assertEqual(payload["parse_task_id"], "parse-task-1")
            self.assertEqual(payload["speaker_map"], {"主讲人": "主讲人"})
            self.assertGreaterEqual(len(payload["failed_chunks"]), 1)
            self.assertEqual(len(queued), 1)
            self.assertEqual(queued[0].project_id, payload["project_id"])
            self.assertEqual(queued[0].text.strip(), payload["labeled_text"].strip())

            project = load_project(projects_dir, payload["project_id"])
            self.assertTrue(project.script.metadata.get("asr_source"))
            self.assertEqual(project.script.metadata.get("asr_failed_chunk_count"), len(payload["failed_chunks"]))
            events = read_project_events(projects_dir, payload["project_id"], limit=50)
            event_types = {((row.get("event") or {}).get("type")) for row in events}
            self.assertIn("asr_project_created", event_types)
            self.assertIn("asr_chunk_failed", event_types)
            self.assertIn("asr_parse_queued", event_types)
        finally:
            shutil.rmtree(root, ignore_errors=True)

    def test_all_chunks_failed_raises_error(self) -> None:
        root = Path("E:/softs/BeautyVoiceTTS/tmp_test_outputs") / f"asr-project-{uuid.uuid4().hex[:8]}"
        shutil.rmtree(root, ignore_errors=True)
        try:
            projects_dir = root / "projects"
            output_dir = root / "output"
            projects_dir.mkdir(parents=True, exist_ok=True)
            output_dir.mkdir(parents=True, exist_ok=True)
            state = SimpleNamespace(
                settings=SimpleNamespace(projects_dir=projects_dir, output_dir=output_dir),
                asr_engine=_FakeAsrEngine(fail_all=True),
            )
            audio = output_dir / "sample.wav"
            audio.write_bytes(b"RIFFdemo")

            async def run() -> dict:
                return await create_project_from_audio(
                    state=state,
                    audio_path=audio,
                    audio_name="sample.wav",
                    project_name="",
                    speaker_labels=False,
                    parse_mode="verified_five_step_pipeline",
                    auto_parse=False,
                    speaker_map=None,
                    enqueue_parse_task=None,
                )

            from backend.services import asr_project_service as service

            original_probe = service._probe_audio_duration_ms
            original_extract = service._extract_chunk
            service._probe_audio_duration_ms = lambda _path: service.CHUNK_DURATION_MS + 5000  # type: ignore[assignment]
            service._extract_chunk = lambda _in, _out, _s, _e: None  # type: ignore[assignment]
            try:
                with self.assertRaises(RuntimeError):
                    asyncio.run(run())
            finally:
                service._probe_audio_duration_ms = original_probe  # type: ignore[assignment]
                service._extract_chunk = original_extract  # type: ignore[assignment]

            project_files = list(projects_dir.glob("*.json"))
            self.assertEqual(project_files, [])
        finally:
            shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
