from __future__ import annotations

import asyncio
import unittest

from backend.engine.llm_parser import (
    decode_json_payload_with_meta,
    gemini_response_schema,
    strip_json_fences,
)


class LlmParserServiceTest(unittest.TestCase):
    def test_strip_json_fences(self) -> None:
        self.assertEqual(strip_json_fences("```json\n{\"segments\":[]}\n```"), '{"segments":[]}')
        self.assertEqual(strip_json_fences("```{\"segments\":[]}```"), '{"segments":[]}')

    def test_decode_with_meta_extracted(self) -> None:
        payload, meta = asyncio.run(
            decode_json_payload_with_meta(
                content='prefix {"segments":[{"speaker":"n","text":"x"}]} suffix',
                llm_options={},
                provider="openai",
            )
        )
        self.assertEqual(len(payload["segments"]), 1)
        self.assertEqual(meta["strategy"], "extracted")
        self.assertFalse(meta["repair_used"])

    def test_decode_with_meta_repaired_gemini(self) -> None:
        async def fake_repair(_broken: str, _opts: dict) -> str:
            return '{"segments":[{"speaker":"n","text":"fixed"}]}'

        payload, meta = asyncio.run(
            decode_json_payload_with_meta(
                content='{"segments":[{"speaker":"n","text":"broken"',
                llm_options={"enable_json_repair": True},
                provider="gemini",
                repair_gemini=fake_repair,
            )
        )
        self.assertEqual(payload["segments"][0]["text"], "fixed")
        self.assertEqual(meta["strategy"], "repaired_gemini")
        self.assertTrue(meta["repair_used"])

    def test_decode_missing_segments_raises(self) -> None:
        with self.assertRaises(ValueError):
            asyncio.run(
                decode_json_payload_with_meta(
                    content='{"title":"x"}',
                    llm_options={},
                    provider="openai",
                )
            )

    def test_gemini_schema_type(self) -> None:
        schema = gemini_response_schema()
        self.assertEqual(schema.get("type"), "OBJECT")
        self.assertEqual(schema.get("properties", {}).get("segments", {}).get("type"), "ARRAY")


if __name__ == "__main__":
    unittest.main()
