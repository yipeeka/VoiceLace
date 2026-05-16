from __future__ import annotations

import unittest

from backend.config import settings
from backend.engine.llm_engine import LLMEngine


class LlmOpenAiCompatibleTest(unittest.IsolatedAsyncioTestCase):
    def test_normalize_backend_accepts_openai_compatible_aliases(self) -> None:
        self.assertEqual(LLMEngine._normalize_backend("openai_compatible"), "openai_compatible")
        self.assertEqual(LLMEngine._normalize_backend("openai-compatible"), "openai_compatible")
        self.assertEqual(LLMEngine._normalize_backend("compatible_openai"), "openai_compatible")

    async def test_openai_compatible_requires_key_base_url_and_model(self) -> None:
        engine = LLMEngine()
        original_allow_mock = settings.allow_mock_fallback
        settings.allow_mock_fallback = False
        try:
            with self.assertRaisesRegex(RuntimeError, "API Key"):
                await engine.load_model(backend="openai_compatible", model_path="")
            with self.assertRaisesRegex(RuntimeError, "Base URL"):
                await engine.load_model(
                    backend="openai_compatible",
                    model_path="",
                    api_key="sk-test",
                )
            with self.assertRaisesRegex(RuntimeError, "模型名"):
                await engine.load_model(
                    backend="openai_compatible",
                    model_path="",
                    api_key="sk-test",
                    api_base_url="http://localhost:11434/v1",
                )
        finally:
            settings.allow_mock_fallback = original_allow_mock

    async def test_openai_compatible_loads_sdk_client_with_custom_base_url(self) -> None:
        try:
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("openai SDK is not installed")

        engine = LLMEngine()
        await engine.load_model(
            backend="openai_compatible",
            model_path="",
            api_key="sk-test",
            api_base_url="http://localhost:11434/v1/",
            api_model="qwen-test",
        )

        self.assertTrue(engine.is_loaded)
        self.assertEqual(engine.backend_name, "openai_compatible")
        self.assertEqual(engine.model_name, "qwen-test")
        self.assertIsNotNone(engine._openai_client)
        self.assertEqual(str(engine._openai_client.base_url).rstrip("/"), "http://localhost:11434/v1")

    async def test_openai_uses_runtime_api_settings(self) -> None:
        try:
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("openai SDK is not installed")

        engine = LLMEngine()
        await engine.load_model(
            backend="openai",
            model_path="",
            api_key="sk-openai",
            api_base_url="https://api.example.test/v1/",
            api_model="gpt-test",
        )

        self.assertTrue(engine.is_loaded)
        self.assertEqual(engine.backend_name, "openai")
        self.assertEqual(engine.model_name, "gpt-test")
        self.assertIsNotNone(engine._openai_client)
        self.assertEqual(str(engine._openai_client.base_url).rstrip("/"), "https://api.example.test/v1")
        self.assertTrue(
            engine.needs_reload(
                model_path="",
                n_ctx=8192,
                n_gpu_layers=-1,
                backend="openai",
                api_key="sk-openai",
                api_base_url="https://api.changed.test/v1",
                api_model="gpt-test",
            )
        )

    async def test_gemini_uses_runtime_api_settings(self) -> None:
        engine = LLMEngine()
        await engine.load_model(
            backend="gemini",
            model_path="",
            api_key="gemini-key",
            api_base_url="https://gemini.example.test",
            api_model="gemini-test",
        )

        self.assertTrue(engine.is_loaded)
        self.assertEqual(engine.backend_name, "gemini")
        self.assertEqual(engine.model_name, "gemini-test")
        opts = engine._gemini_options_for_backend({})
        self.assertEqual(opts["api_key"], "gemini-key")
        self.assertEqual(opts["api_base_url"], "https://gemini.example.test")
        self.assertEqual(opts["api_model"], "gemini-test")
        self.assertTrue(
            engine.needs_reload(
                model_path="",
                n_ctx=8192,
                n_gpu_layers=-1,
                backend="gemini",
                api_key="gemini-key-2",
                api_base_url="https://gemini.example.test",
                api_model="gemini-test",
            )
        )

    async def test_openai_compatible_needs_reload_when_api_settings_change(self) -> None:
        try:
            import openai  # noqa: F401
        except ImportError:
            self.skipTest("openai SDK is not installed")

        engine = LLMEngine()
        await engine.load_model(
            backend="openai_compatible",
            model_path="",
            api_key="sk-test",
            api_base_url="http://localhost:11434/v1",
            api_model="qwen-test",
        )

        self.assertFalse(
            engine.needs_reload(
                model_path="",
                n_ctx=8192,
                n_gpu_layers=-1,
                backend="openai_compatible",
                api_key="sk-test",
                api_base_url="http://localhost:11434/v1/",
                api_model="qwen-test",
            )
        )
        self.assertTrue(
            engine.needs_reload(
                model_path="",
                n_ctx=8192,
                n_gpu_layers=-1,
                backend="openai_compatible",
                api_key="sk-test",
                api_base_url="http://localhost:8000/v1",
                api_model="qwen-test",
            )
        )
        self.assertTrue(
            engine.needs_reload(
                model_path="",
                n_ctx=8192,
                n_gpu_layers=-1,
                backend="openai_compatible",
                api_key="sk-test-2",
                api_base_url="http://localhost:11434/v1",
                api_model="qwen-test",
            )
        )
        self.assertTrue(
            engine.needs_reload(
                model_path="",
                n_ctx=8192,
                n_gpu_layers=-1,
                backend="openai_compatible",
                api_key="sk-test",
                api_base_url="http://localhost:11434/v1",
                api_model="other-model",
            )
        )


if __name__ == "__main__":
    unittest.main()
