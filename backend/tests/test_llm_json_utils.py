from __future__ import annotations

import asyncio
import json
import unittest

from backend.engine.llm_engine import LLMEngine
from backend.engine.llm_parser import extract_json_object, gemini_response_schema, should_attempt_repair


class LlmJsonUtilsTest(unittest.TestCase):
    def test_extract_json_object_with_wrapper_text(self) -> None:
        text = 'prefix {"title":"x","segments":[]} suffix'
        extracted = extract_json_object(text)
        self.assertEqual(extracted, '{"title":"x","segments":[]}')

    def test_extract_json_object_truncated(self) -> None:
        text = '{"title":"x","segments":[{"speaker":"a","text":"incomplete"'
        extracted = extract_json_object(text)
        self.assertTrue(extracted.startswith('{"title":"x"'))

    def test_should_attempt_repair_false_for_large_payload(self) -> None:
        err = json.JSONDecodeError("Unterminated string", "{}", 1)
        content = "{" + ("x" * 25000)
        self.assertFalse(should_attempt_repair(content, err, {}))

    def test_should_attempt_repair_false_when_disabled(self) -> None:
        err = json.JSONDecodeError("Unterminated string", "{}", 1)
        self.assertFalse(should_attempt_repair('{"a":', err, {"enable_json_repair": False}))

    def test_decode_json_payload_with_meta_extracted_strategy(self) -> None:
        engine = LLMEngine()
        payload, meta = asyncio.run(
            engine._decode_json_payload_with_meta(
                'prefix {"title":"x","segments":[]} suffix',
                {},
                provider="openai",
            )
        )
        self.assertEqual(payload["title"], "x")
        self.assertEqual(meta["strategy"], "extracted")
        self.assertFalse(meta["repair_used"])

    def test_decode_json_payload_rejects_missing_segments(self) -> None:
        engine = LLMEngine()
        with self.assertRaises(ValueError):
            asyncio.run(
                engine._decode_json_payload_with_meta(
                    '{"title":"x"}',
                    {},
                    provider="openai",
                )
            )

    def test_gemini_schema_type_uppercase(self) -> None:
        schema = gemini_response_schema()
        self.assertEqual(schema.get("type"), "OBJECT")
        self.assertEqual(schema.get("properties", {}).get("segments", {}).get("type"), "ARRAY")


if __name__ == "__main__":
    unittest.main()
