from __future__ import annotations

import unittest

from backend.engine.llm_clients import (
    _build_gemini_generate_url,
    _normalize_gemini_model_name,
)


class LlmClientsTest(unittest.TestCase):
    def test_normalize_gemini_model_name_strips_models_prefix(self) -> None:
        self.assertEqual(_normalize_gemini_model_name("models/gemini-2.5-flash"), "gemini-2.5-flash")
        self.assertEqual(_normalize_gemini_model_name("gemini-2.5-flash"), "gemini-2.5-flash")

    def test_build_gemini_url_defaults_to_v1beta(self) -> None:
        url = _build_gemini_generate_url(
            base_url="https://generativelanguage.googleapis.com",
            model="models/gemini-2.5-flash",
            api_key="k",
        )
        self.assertIn("/v1beta/models/gemini-2.5-flash:generateContent?key=k", url)

    def test_build_gemini_url_respects_existing_api_version_prefix(self) -> None:
        url_v1beta = _build_gemini_generate_url(
            base_url="https://generativelanguage.googleapis.com/v1beta",
            model="gemini-2.5-flash",
            api_key="k",
        )
        self.assertEqual(
            url_v1beta,
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=k",
        )

        url_v1 = _build_gemini_generate_url(
            base_url="https://generativelanguage.googleapis.com/v1",
            model="gemini-2.5-flash",
            api_key="k",
        )
        self.assertEqual(
            url_v1,
            "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=k",
        )

if __name__ == "__main__":
    unittest.main()
