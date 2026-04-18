from __future__ import annotations

import tempfile
import types
import unittest
from pathlib import Path
from uuid import uuid4

from backend.services.tts_runtime_service import emit_task_event, normalize_segment_tts_overrides


class _FakeRealtime:
    def __init__(self) -> None:
        self.published: list[tuple[str, str, dict]] = []

    async def publish(self, channel: str, task_id: str, message: dict) -> None:
        self.published.append((channel, task_id, message))


class TtsRuntimeServiceTest(unittest.IsolatedAsyncioTestCase):
    def test_normalize_segment_tts_overrides_strict_and_nonstrict(self) -> None:
        segment = types.SimpleNamespace(index=0, id="s1", tts_overrides={"speed": 1.1})
        self.assertEqual(normalize_segment_tts_overrides(segment, strict=True), {"speed": 1.1})

        bad_segment = types.SimpleNamespace(index=1, id="s2", tts_overrides={"unknown": 1})
        with self.assertRaises(RuntimeError):
            normalize_segment_tts_overrides(bad_segment, strict=True)
        self.assertEqual(normalize_segment_tts_overrides(bad_segment, strict=False), {})

    async def test_emit_task_event_appends_and_publishes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            realtime = _FakeRealtime()
            state = types.SimpleNamespace(
                settings=types.SimpleNamespace(projects_dir=Path(tmp_dir)),
                realtime=realtime,
            )
            task = {"project_id": str(uuid4()), "events": [], "status": "running"}
            message = {"type": "progress", "current": 1, "total": 2}

            await emit_task_event(state=state, task=task, task_id="task-1", message=message)

            self.assertEqual(task["events"], [message])
            self.assertEqual(len(realtime.published), 1)
            self.assertEqual(realtime.published[0][0], "tts")
            self.assertEqual(realtime.published[0][1], "task-1")
            self.assertEqual(realtime.published[0][2], message)


if __name__ == "__main__":
    unittest.main()
