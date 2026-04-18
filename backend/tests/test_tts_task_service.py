from __future__ import annotations

import unittest

from backend.models import Project
from backend.services.tts_task_service import hash_payload, public_task, segment_cache_key


class TtsTaskServiceTest(unittest.TestCase):
    def test_hash_payload_stable(self) -> None:
        self.assertEqual(hash_payload({"b": 1, "a": 2}), hash_payload({"a": 2, "b": 1}))

    def test_segment_cache_key_changes_on_overrides(self) -> None:
        project = Project(name="task-service")
        key1 = segment_cache_key(
            text="hello",
            preset=None,
            config=project.synthesis_config,
            tts_backend="mock",
            tts_model_path="m1",
            tts_overrides={},
        )
        key2 = segment_cache_key(
            text="hello",
            preset=None,
            config=project.synthesis_config,
            tts_backend="mock",
            tts_model_path="m1",
            tts_overrides={"speed": 1.1},
        )
        self.assertNotEqual(key1, key2)

    def test_public_task_shape(self) -> None:
        payload = public_task(
            {
                "task_id": "t1",
                "status": "running",
                "segments": {},
                "project_id": "p1",
                "progress": {"current": 1, "total": 2},
                "export_url": "",
                "error": "",
            }
        )
        self.assertEqual(payload["task_id"], "t1")
        self.assertEqual(payload["scope"], "full")
        self.assertEqual(payload["target_segment_ids"], [])
        self.assertEqual(payload["generated_count"], 0)
        self.assertEqual(payload["reused_count"], 0)


if __name__ == "__main__":
    unittest.main()
