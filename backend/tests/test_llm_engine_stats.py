from __future__ import annotations

import asyncio
import unittest

from backend.engine.llm_engine import LLMEngine


class LlmEngineStatsTest(unittest.TestCase):
    def test_parse_stats_contains_observability_fields(self) -> None:
        engine = LLMEngine()
        engine.backend_name = "mock"
        engine.model_name = "mock-model"
        script = asyncio.run(
            engine.parse_text_chunked_stream(
                "第一行\n第二行",
                prompt=None,
                llm_options={
                    "enable_structured_output": False,
                    "enable_json_repair": False,
                    "n_ctx": 4096,
                    "max_tokens": 1024,
                },
            )
        )
        self.assertGreaterEqual(len(script.segments), 1)
        stats = engine.last_parse_stats
        self.assertEqual(stats.get("model_name"), "mock-model")
        self.assertFalse(stats.get("structured_output_enabled"))
        self.assertFalse(stats.get("json_repair_enabled"))
        self.assertEqual(stats.get("n_ctx"), 4096)
        self.assertEqual(stats.get("max_tokens"), 1024)
        self.assertIn("think_mode_enabled", stats)


if __name__ == "__main__":
    unittest.main()
