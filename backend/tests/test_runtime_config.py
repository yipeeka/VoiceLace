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
                mcp_enabled=True,
                mcp_mount_path="/voice-mcp",
                secondary_llm_model_path="E:/models/qwen2.5-1.5b.gguf",
                secondary_llm_n_ctx=3072,
                secondary_llm_max_tokens=900,
                tts_model_path="omnivoice",
                voxcpm_tts_model_path="openbmb/VoxCPM2",
                music_enabled=True,
                music_turbo_model_dir="D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers",
                music_base_model_dir="D:/AIModels/ACE-Step/acestep-v15-xl-base-diffusers",
                music_model_variant="base",
                music_model_dir="D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers",
                music_device_mode="cpu_offload",
                asr_backend="qwen3_crispasr",
                asr_model_path="faster-whisper-large-v3",
                asr_device="cuda:1",
                qwen3_asr_crispasr_exe="D:/tools/CrispASR/crispasr.exe",
                qwen3_asr_model_path="D:/models/qwen3-asr-0.6b-q4_k.gguf",
                qwen3_asr_forced_aligner_model_path="D:/models/qwen3-forced-aligner-0.6b-q4_k.gguf",
                qwen3_asr_threads=4,
                qwen3_asr_language="auto",
                qwen3_asr_enable_timestamps=True,
            )
            save_runtime_config(path, cfg)
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.assertFalse(raw["enable_llama_cpp_think_mode"])
            self.assertEqual(raw["llm_backend"], "gemini")
            self.assertTrue(raw["mcp_enabled"])
            self.assertEqual(raw["mcp_mount_path"], "/voice-mcp")
            self.assertEqual(raw["voxcpm_tts_model_path"], "openbmb/VoxCPM2")
            self.assertTrue(raw["music_enabled"])
            self.assertEqual(raw["music_turbo_model_dir"], "D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers")
            self.assertEqual(raw["music_base_model_dir"], "D:/AIModels/ACE-Step/acestep-v15-xl-base-diffusers")
            self.assertEqual(raw["music_model_variant"], "base")
            self.assertEqual(raw["music_model_dir"], "D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers")
            self.assertEqual(raw["music_device_mode"], "cpu_offload")
            self.assertEqual(raw["asr_backend"], "qwen3_crispasr")
            self.assertEqual(raw["qwen3_asr_crispasr_exe"], "D:/tools/CrispASR/crispasr.exe")
            self.assertEqual(raw["qwen3_asr_model_path"], "D:/models/qwen3-asr-0.6b-q4_k.gguf")
            self.assertEqual(raw["qwen3_asr_forced_aligner_model_path"], "D:/models/qwen3-forced-aligner-0.6b-q4_k.gguf")
            self.assertEqual(raw["qwen3_asr_threads"], 4)
            self.assertTrue(raw["qwen3_asr_enable_timestamps"])
            self.assertEqual(raw["secondary_llm_model_path"], "E:/models/qwen2.5-1.5b.gguf")
            loaded = load_runtime_config(path)
            self.assertFalse(loaded.enable_llama_cpp_think_mode)
            self.assertEqual(loaded.llm_backend, "gemini")
            self.assertTrue(loaded.mcp_enabled)
            self.assertEqual(loaded.mcp_mount_path, "/voice-mcp")
            self.assertEqual(loaded.asr_device, "cuda:1")
            self.assertEqual(loaded.llm_threads, 4)
            self.assertEqual(loaded.voxcpm_tts_model_path, "openbmb/VoxCPM2")
            self.assertTrue(loaded.music_enabled)
            self.assertEqual(loaded.music_turbo_model_dir, "D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers")
            self.assertEqual(loaded.music_base_model_dir, "D:/AIModels/ACE-Step/acestep-v15-xl-base-diffusers")
            self.assertEqual(loaded.music_model_variant, "base")
            self.assertEqual(loaded.music_model_dir, "D:/AIModels/ACE-Step/acestep-v15-xl-turbo-diffusers")
            self.assertEqual(loaded.music_device_mode, "cpu_offload")
            self.assertEqual(loaded.asr_backend, "qwen3_crispasr")
            self.assertEqual(loaded.qwen3_asr_crispasr_exe, "D:/tools/CrispASR/crispasr.exe")
            self.assertEqual(loaded.qwen3_asr_model_path, "D:/models/qwen3-asr-0.6b-q4_k.gguf")
            self.assertEqual(loaded.qwen3_asr_forced_aligner_model_path, "D:/models/qwen3-forced-aligner-0.6b-q4_k.gguf")
            self.assertEqual(loaded.qwen3_asr_threads, 4)
            self.assertEqual(loaded.qwen3_asr_language, "auto")
            self.assertTrue(loaded.qwen3_asr_enable_timestamps)
            self.assertEqual(loaded.secondary_llm_n_ctx, 3072)
            self.assertEqual(loaded.secondary_llm_max_tokens, 900)
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

    def test_load_runtime_config_ignores_removed_fields(self) -> None:
        tmp_dir = settings.data_dir / "tmp-tests" / f"runtime-config-compat-{uuid.uuid4().hex[:8]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        try:
            path = tmp_dir / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "llm_backend": "openai",
                        "qwen3_asr_gguf_model_dir": "E:/legacy/qwen3",
                        "asr_device": "cuda:0",
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            loaded = load_runtime_config(path)
            self.assertEqual(loaded.llm_backend, "openai")
            self.assertEqual(loaded.asr_device, "cuda:0")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
