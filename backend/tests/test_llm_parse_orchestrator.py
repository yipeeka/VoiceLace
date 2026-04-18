from __future__ import annotations

import asyncio
import logging
import unittest
from uuid import uuid4

from backend.engine.llm_parse_orchestrator import run_chunked_parse_flow
from backend.models import Character, Script, Segment


class LlmParseOrchestratorTest(unittest.TestCase):
    def test_single_mode_stats(self) -> None:
        async def fake_parse_single(text, prompt, on_chunk, llm_options):
            if on_chunk is not None:
                await on_chunk("x")
            script = Script(
                title="t",
                source_text=text,
                segments=[Segment(id=str(uuid4()), index=0, type="narration", speaker="narrator", text=text)],
                characters=[Character(name="narrator", appearance_count=1, description="n")],
            )
            return script, {"attempts": 1, "repair_used": False, "fallback": False}

        script, stats = asyncio.run(
            run_chunked_parse_flow(
                text="hello world",
                prompt="p",
                on_chunk=None,
                on_chunk_progress=None,
                on_chunk_start=None,
                llm_options={},
                max_chunk_chars=9999,
                backend_name="mock",
                parse_single_with_stats=fake_parse_single,
                logger=logging.getLogger(__name__),
            )
        )
        self.assertEqual(stats["mode"], "single")
        self.assertEqual(stats["total_chunks"], 1)
        self.assertEqual(len(script.segments), 1)

    def test_chunked_mode_stats(self) -> None:
        async def fake_parse_single(text, prompt, on_chunk, llm_options):
            if on_chunk is not None:
                await on_chunk("x")
            script = Script(
                title="t",
                source_text=text,
                segments=[Segment(id=str(uuid4()), index=0, type="dialogue", speaker="A", text=text)],
                characters=[Character(name="A", appearance_count=1, description="A desc")],
            )
            return script, {"attempts": 1, "repair_used": False, "fallback": False}

        script, stats = asyncio.run(
            run_chunked_parse_flow(
                text="段落一。\n\n段落二。",
                prompt="p",
                on_chunk=None,
                on_chunk_progress=None,
                on_chunk_start=None,
                llm_options={},
                max_chunk_chars=3,
                backend_name="llama-cpp-python",
                parse_single_with_stats=fake_parse_single,
                logger=logging.getLogger(__name__),
            )
        )
        self.assertEqual(stats["mode"], "chunked")
        self.assertGreaterEqual(stats["total_chunks"], 2)
        self.assertEqual(len(stats["chunk_stats"]), stats["total_chunks"])
        self.assertGreaterEqual(len(script.segments), 2)


if __name__ == "__main__":
    unittest.main()
