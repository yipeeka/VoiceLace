from __future__ import annotations

import json
import shutil
import unittest
import uuid

from backend.config import settings
from backend.engine import OrchestratorConfig
from backend.runtime_config import load_runtime_config, save_runtime_config


class RuntimeConfigTest(unittest.TestCase):
    def test_save_and_load_runtime_config(self) -> None:
        tmp_dir = settings.data_dir / "tmp-tests" / f"runtime-config-{uuid.uuid4().hex[:8]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            path = tmp_dir / "config.json"
            cfg = OrchestratorConfig(
                enable_llama_cpp_think_mode=False,
                llm_backend="gemini",
                llm_api_model="gemini-2.5-flash",
                llm_n_ctx=4096,
                llm_threads=4,
                tts_model_path="omnivoice",
                voxcpm_tts_model_path="openbmb/VoxCPM2",
                asr_model_path="faster-whisper-large-v3",
                asr_device="cuda:1",
            )
            save_runtime_config(path, cfg)
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertFalse(raw["enable_llama_cpp_think_mode"])
            self.assertEqual(raw["llm_backend"], "gemini")
            self.assertEqual(raw["voxcpm_tts_model_path"], "openbmb/VoxCPM2")
            loaded = load_runtime_config(path)
            self.assertFalse(loaded.enable_llama_cpp_think_mode)
            self.assertEqual(loaded.llm_backend, "gemini")
            self.assertEqual(loaded.asr_device, "cuda:1")
            self.assertEqual(loaded.llm_threads, 4)
            self.assertEqual(loaded.voxcpm_tts_model_path, "openbmb/VoxCPM2")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    def test_load_runtime_config_with_invalid_json_falls_back(self) -> None:
        tmp_dir = settings.data_dir / "tmp-tests" / f"runtime-config-invalid-{uuid.uuid4().hex[:8]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            path = tmp_dir / "config.json"
            path.write_text("{bad-json", encoding="utf-8")
            loaded = load_runtime_config(path)
            self.assertIsInstance(loaded, OrchestratorConfig)
            self.assertEqual(loaded.llm_n_ctx, OrchestratorConfig().llm_n_ctx)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
