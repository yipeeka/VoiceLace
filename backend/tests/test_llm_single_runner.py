from __future__ import annotations

import asyncio
import unittest

from backend.engine.llm_single_runner import run_single_parse_with_stats


class _DummyLogger:
    def exception(self, *_args, **_kwargs):
        return None


class LlmSingleRunnerTest(unittest.TestCase):
    def test_mock_backend_path(self) -> None:
        chunks: list[str] = []
        last_error = {"value": ""}

        async def on_chunk(piece: str):
            chunks.append(piece)

        async def _never(*_args, **_kwargs):
            raise AssertionError("should not be called")

        async def _decode(*_args, **_kwargs):
            raise AssertionError("should not be called")

        def _set_last_error(msg: str):
            last_error["value"] = msg

        script, stats = asyncio.run(
            run_single_parse_with_stats(
                backend_name="mock",
                llm=None,
                text="a\nb",
                prompt=None,
                on_chunk=on_chunk,
                llm_options={},
                extraction_prompt="",
                run_openai_parse=_never,
                run_gemini_parse=_never,
                decode_json_payload_with_meta=_decode,
                build_llama_chat_kwargs=lambda **kwargs: kwargs,
                set_last_error=_set_last_error,
                logger=_DummyLogger(),
            )
        )
        self.assertEqual(stats["decode_strategy"], "mock")
        self.assertFalse(stats["fallback"])
        self.assertEqual(last_error["value"], "")
        self.assertGreaterEqual(len(chunks), 2)
        self.assertGreaterEqual(len(script.segments), 2)

    def test_openai_fallback_sets_error(self) -> None:
        last_error = {"value": ""}

        async def _openai_fail(*_args, **_kwargs):
            raise RuntimeError("openai boom")

        async def _never(*_args, **_kwargs):
            raise AssertionError("should not be called")

        def _set_last_error(msg: str):
            last_error["value"] = msg

        script, stats = asyncio.run(
            run_single_parse_with_stats(
                backend_name="openai",
                llm=None,
                text="hello",
                prompt="p",
                on_chunk=None,
                llm_options={},
                extraction_prompt="x",
                run_openai_parse=_openai_fail,
                run_gemini_parse=_never,
                decode_json_payload_with_meta=_never,
                build_llama_chat_kwargs=lambda **kwargs: kwargs,
                set_last_error=_set_last_error,
                logger=_DummyLogger(),
            )
        )
        self.assertTrue(stats["fallback"])
        self.assertEqual(stats["decode_strategy"], "fallback_openai")
        self.assertIn("openai boom", stats["error"])
        self.assertIn("openai boom", last_error["value"])
        self.assertGreaterEqual(len(script.segments), 1)


if __name__ == "__main__":
    unittest.main()
