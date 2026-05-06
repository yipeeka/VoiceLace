from __future__ import annotations

import unittest

from backend.services.tts_lifecycle_service import build_tts_status_response, create_tts_task_record


class TtsLifecycleServiceTest(unittest.TestCase):
    def test_create_tts_task_record_defaults(self) -> None:
        task = create_tts_task_record(task_id="t1", project_id="p1")
        self.assertEqual(task["task_id"], "t1")
        self.assertEqual(task["project_id"], "p1")
        self.assertEqual(task["kind"], "synthesis")
        self.assertEqual(task["status"], "queued")
        self.assertEqual(task["progress"], {"current": 0, "total": 0})
        self.assertEqual(task["events"], [{"type": "task_status", "status": "queued", "kind": "synthesis"}])

    def test_build_tts_status_response_error(self) -> None:
        code, payload = build_tts_status_response(
            "t2",
            {
                "status": "error",
                "error": "boom",
                "task_id": "t2",
                "segments": {},
                "project_id": "p1",
                "progress": {"current": 0, "total": 0},
                "export_url": "",
            },
        )
        self.assertEqual(code, 500)
        self.assertEqual(payload["code"], "tts_task_error")
        self.assertEqual(payload["message"], "boom")

    def test_build_tts_status_response_non_done(self) -> None:
        code, payload = build_tts_status_response(
            "t3",
            {
                "status": "running",
                "error": "",
                "segments": {},
                "project_id": "p1",
                "progress": {"current": 1, "total": 2},
                "export_url": "",
                "task_id": "t3",
            },
        )
        self.assertEqual(code, 202)
        self.assertEqual(payload["status"], "running")

    def test_build_tts_status_response_done(self) -> None:
        code, payload = build_tts_status_response(
            "t4",
            {
                "status": "done",
                "error": "",
                "segments": {},
                "project_id": "p1",
                "progress": {"current": 2, "total": 2},
                "export_url": "/x",
                "task_id": "t4",
            },
        )
        self.assertEqual(code, 200)
        self.assertEqual(payload["status"], "done")


if __name__ == "__main__":
    unittest.main()
