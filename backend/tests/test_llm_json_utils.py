from __future__ import annotations

import unittest

from backend.engine.llm_engine import LLMEngine


class LlmJsonUtilsTest(unittest.TestCase):
    def test_extract_json_object_with_wrapper_text(self) -> None:
        text = 'prefix {"title":"x","segments":[]} suffix'
        extracted = LLMEngine._extract_json_object(text)
        self.assertEqual(extracted, '{"title":"x","segments":[]}')

    def test_extract_json_object_truncated(self) -> None:
        text = '{"title":"x","segments":[{"speaker":"a","text":"incomplete"'
        extracted = LLMEngine._extract_json_object(text)
        self.assertTrue(extracted.startswith('{"title":"x"'))


if __name__ == "__main__":
    unittest.main()
