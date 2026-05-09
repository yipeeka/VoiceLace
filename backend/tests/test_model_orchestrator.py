from __future__ import annotations

import unittest

from backend.engine.model_orchestrator import ModelOrchestrator, OrchestratorConfig


class _FakeLlmEngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.last_error = ""
        self.backend_name = "llama-cpp-python"
        self.enable_llama_cpp_think_mode = True
        self.loaded_args = None
        self.unload_called = False

    def needs_reload(self, **kwargs) -> bool:
        return False

    async def load_model(self, *args, **kwargs) -> None:
        self.is_loaded = True
        self.loaded_args = (args, kwargs)

    async def unload_model(self) -> None:
        self.is_loaded = False
        self.unload_called = True


class _FakeTtsEngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.last_error = ""
        self.backend_name = "mock"
        self.loaded_args = None
        self.unload_called = False

    async def load_model(self, *args, **kwargs) -> None:
        self.is_loaded = True
        self.loaded_args = (args, kwargs)

    async def unload_model(self) -> None:
        self.is_loaded = False
        self.unload_called = True


class _FakeMusicEngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.last_error = ""
        self.backend_name = "unloaded"
        self.model_dir = ""
        self.device_mode = "cpu_offload"
        self.loaded_args = None
        self.unload_called = False

    def needs_reload(self, **kwargs) -> bool:
        return False

    async def load_model(self, *args, **kwargs) -> None:
        self.is_loaded = True
        self.backend_name = "acestep_diffusers"
        self.loaded_args = (args, kwargs)

    async def unload_model(self) -> None:
        self.is_loaded = False
        self.backend_name = "unloaded"
        self.unload_called = True


class ModelOrchestratorTest(unittest.IsolatedAsyncioTestCase):
    async def test_status_marks_llm_fallback_active(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        orch = ModelOrchestrator(llm, tts)
        orch.set_config(OrchestratorConfig(llm_backend="llama_cpp"))

        llm.is_loaded = True
        llm.backend_name = "mock"
        llm.last_error = "failed to load gguf"

        status = await orch.get_status()
        self.assertTrue(status["llm_fallback_active"])
        self.assertEqual(status["llm_status"], "ready")
        self.assertEqual(status["llm_backend"], "mock")
        self.assertIn("llm_think_mode_effective", status)
        self.assertIn("llm_think_mode_support", status)

    async def test_status_no_fallback_when_config_is_mock(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        orch = ModelOrchestrator(llm, tts)
        orch.set_config(OrchestratorConfig(llm_backend="mock"))

        llm.is_loaded = True
        llm.backend_name = "mock"
        llm.last_error = "none"

        status = await orch.get_status()
        self.assertFalse(status["llm_fallback_active"])

    async def test_set_config_updates_think_mode_flag(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        orch = ModelOrchestrator(llm, tts)
        self.assertTrue(llm.enable_llama_cpp_think_mode)
        orch.set_config(OrchestratorConfig(enable_llama_cpp_think_mode=False))
        self.assertFalse(llm.enable_llama_cpp_think_mode)

    async def test_ensure_llm_ready_unloads_tts_when_auto_serial_enabled(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        tts.is_loaded = True

        orch = ModelOrchestrator(llm, tts)
        orch.set_config(
            OrchestratorConfig(
                auto_serial=True,
                llm_model_path="E:/models/test.gguf",
                llm_clip_model_path="E:/models/test.mmproj",
            )
        )

        await orch.ensure_llm_ready()
        self.assertTrue(llm.is_loaded)
        self.assertTrue(tts.unload_called)
        _args, kwargs = llm.loaded_args
        self.assertEqual(kwargs.get("clip_model_path"), "E:/models/test.mmproj")

    async def test_ensure_tts_ready_unloads_music_when_auto_serial_enabled(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        music = _FakeMusicEngine()
        music.is_loaded = True
        music.backend_name = "acestep_diffusers"

        orch = ModelOrchestrator(llm, tts, music)
        orch.set_config(OrchestratorConfig(auto_serial=True, tts_model_path="E:/models/omnivoice"))

        await orch.ensure_tts_ready()
        self.assertTrue(tts.is_loaded)
        self.assertTrue(music.unload_called)

    async def test_get_status_exposes_music_fields(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        music = _FakeMusicEngine()
        music.is_loaded = True
        music.backend_name = "acestep_diffusers"

        orch = ModelOrchestrator(llm, tts, music)
        status = await orch.get_status()
        self.assertIn("music_loaded", status)
        self.assertIn("music_status", status)
        self.assertIn("music_backend", status)
        self.assertTrue(status["music_loaded"])

    async def test_ensure_music_ready_uses_selected_music_variant_dir(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        music = _FakeMusicEngine()
        orch = ModelOrchestrator(llm, tts, music)
        orch.set_config(
            OrchestratorConfig(
                music_enabled=True,
                music_model_variant="base",
                music_turbo_model_dir="E:/models/acestep-turbo",
                music_base_model_dir="E:/models/acestep-base",
                music_model_dir="E:/legacy/music-model",
                music_device_mode="cpu_offload",
            )
        )

        await orch.ensure_music_ready()
        self.assertTrue(music.is_loaded)
        args, _kwargs = music.loaded_args
        self.assertEqual(args[0], "E:/models/acestep-base")

    async def test_unload_tts_runs_when_engine_only_has_error(self) -> None:
        llm = _FakeLlmEngine()
        tts = _FakeTtsEngine()
        tts.is_loaded = False
        tts.last_error = "load failed"

        orch = ModelOrchestrator(llm, tts)
        await orch.unload_tts()

        self.assertTrue(tts.unload_called)
        self.assertEqual(orch.state.value, "idle")


if __name__ == "__main__":
    unittest.main()
