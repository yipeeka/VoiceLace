from __future__ import annotations

import unittest

from fastapi import FastAPI

from backend.state import create_app_state, get_app_state_from_app


class StateFactoryTest(unittest.TestCase):
    def test_create_app_state_returns_isolated_instances(self) -> None:
        state_a = create_app_state()
        state_b = create_app_state()
        self.assertIsNot(state_a, state_b)
        self.assertIsNot(state_a.llm_tasks, state_b.llm_tasks)
        self.assertIsNot(state_a.tts_tasks, state_b.tts_tasks)

    def test_get_app_state_from_app_caches_instance(self) -> None:
        app = FastAPI()
        first = get_app_state_from_app(app)
        second = get_app_state_from_app(app)
        self.assertIs(first, second)
        self.assertTrue(hasattr(app.state, "app_state"))


if __name__ == "__main__":
    unittest.main()
