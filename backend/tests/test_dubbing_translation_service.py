from __future__ import annotations

import unittest
import json
from types import SimpleNamespace

from backend.services.dubbing_translation_service import (
    _CONTEXT_HINTS_CACHE,
    _SEGMENT_TRANSLATION_CACHE,
    translate_dubbing_segments_for_state,
)


class _FakeTranslationEngine:
    is_loaded = True
    backend_name = "fake"

    async def generate_text(self, *, text, system_prompt, llm_options):
        prompt = str(system_prompt or "")
        if "配音预处理助手" in prompt:
            return "术语：城门外=outside the city gate"
        if "压缩编辑" in prompt:
            return "短句版"
        return f"{text}译"


def _build_state() -> SimpleNamespace:
    cfg = SimpleNamespace(
        secondary_llm_model_path="fake.gguf",
        secondary_llm_clip_model_path="",
        secondary_llm_n_ctx=4096,
        secondary_llm_n_gpu_layers=-1,
        secondary_llm_threads=0,
        secondary_enable_llama_cpp_think_mode=False,
        llm_api_model="",
        secondary_llm_temperature=0.2,
        secondary_llm_top_p=0.9,
        secondary_llm_top_k=40,
        secondary_llm_min_p=0.0,
        secondary_llm_presence_penalty=0.0,
        secondary_llm_repeat_penalty=1.0,
        secondary_llm_max_tokens=1024,
        llm_model_path="fake-primary.gguf",
        llm_clip_model_path="",
        llm_n_ctx=8192,
        llm_n_gpu_layers=-1,
        llm_threads=0,
        enable_llama_cpp_think_mode=False,
        llm_temperature=0.2,
        llm_top_p=0.9,
        llm_top_k=40,
        llm_min_p=0.0,
        llm_presence_penalty=0.0,
        llm_repeat_penalty=1.0,
        llm_max_tokens=1024,
    )
    return SimpleNamespace(
        orchestrator=SimpleNamespace(config=cfg),
        translation_llm_engine=_FakeTranslationEngine(),
        translation_engine_source="secondary_local",
        translation_engine_error="",
    )


class DubbingTranslationServiceTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        _CONTEXT_HINTS_CACHE.clear()
        _SEGMENT_TRANSLATION_CACHE.clear()

    async def test_normalizes_segments_without_timing_overrides(self) -> None:
        state = _build_state()
        result = await translate_dubbing_segments_for_state(
            state=state,
            source="secondary_local",
            target_language="中文",
            segments=[
                {"id": "a", "speaker": "旁白", "text": "  雾未散  ", "start_ms": 0, "end_ms": 2000},
                {"id": "b", "speaker": "旁白", "text": "   ", "start_ms": 2100, "end_ms": 3000},
            ],
            max_concurrency=4,
        )
        self.assertEqual(result["normalized_segment_count"], 1)
        self.assertEqual(result["dropped_empty_segment_count"], 1)
        self.assertEqual(result["max_concurrency"], 1)  # llama_cpp source keeps serial mode
        self.assertTrue(result["context_hints"])
        row = result["segments"][0]
        self.assertEqual(row["source_text"], "雾未散")
        self.assertEqual(row["tts_overrides"], {})
        self.assertAlmostEqual(float(row["target_duration_sec"]), 1.9, places=3)

    async def test_passthrough_mode_skips_llm_and_keeps_source_text(self) -> None:
        state = _build_state()
        state.translation_llm_engine.is_loaded = False
        result = await translate_dubbing_segments_for_state(
            state=state,
            source="secondary_local",
            mode="passthrough",
            target_language="中文",
            segments=[{"id": "a", "speaker": "旁白", "text": "雾未散", "start_ms": 0, "end_ms": 2000}],
        )
        self.assertEqual(result["mode"], "passthrough")
        self.assertEqual(result["backend"], "passthrough")
        self.assertEqual(result["segments"][0]["text"], "雾未散")
        self.assertEqual(result["segments"][0]["source_text"], "雾未散")
        self.assertEqual(result["segments"][0]["tts_overrides"], {})
        self.assertAlmostEqual(float(result["segments"][0]["target_duration_sec"]), 1.9, places=3)

    async def test_legacy_speed_window_does_not_emit_speed_override(self) -> None:
        state = _build_state()
        result = await translate_dubbing_segments_for_state(
            state=state,
            source="secondary_local",
            target_language="中文",
            segments=[{"id": "a", "speaker": "narrator", "text": "hello", "start_ms": 0, "end_ms": 800}],
            min_speed=0.1,
            max_speed=2.0,
        )
        self.assertEqual(result["segments"][0]["tts_overrides"], {})

    async def test_batch_json_output_maps_segments(self) -> None:
        class BatchEngine(_FakeTranslationEngine):
            async def generate_text(self, *, text, system_prompt, llm_options):
                prompt = str(system_prompt or "")
                if "配音预处理助手" in prompt:
                    return "术语：hello=你好"
                if "JSON 数组" in prompt:
                    rows = json.loads(text)
                    return json.dumps([{"id": row["id"], "text": f"{row['text']}译"} for row in rows], ensure_ascii=False)
                return f"{text}逐段译"

        state = _build_state()
        state.translation_llm_engine = BatchEngine()
        result = await translate_dubbing_segments_for_state(
            state=state,
            source="secondary_local",
            target_language="中文",
            segments=[
                {"id": "a", "speaker": "narrator", "text": "hello", "start_ms": 0, "end_ms": 1500},
                {"id": "b", "speaker": "narrator", "text": "world", "start_ms": 1600, "end_ms": 3000},
            ],
        )
        self.assertEqual(result["chunk_count"], 1)
        self.assertEqual(result["fallback_chunk_count"], 0)
        self.assertEqual([row["text"] for row in result["segments"]], ["hello译", "world译"])

    async def test_batch_parse_failure_falls_back_to_per_segment(self) -> None:
        class BrokenBatchEngine(_FakeTranslationEngine):
            async def generate_text(self, *, text, system_prompt, llm_options):
                prompt = str(system_prompt or "")
                if "配音预处理助手" in prompt:
                    return "术语"
                if "JSON 数组" in prompt:
                    return "not json"
                return f"fallback:{text}"

        state = _build_state()
        state.translation_llm_engine = BrokenBatchEngine()
        result = await translate_dubbing_segments_for_state(
            state=state,
            source="secondary_local",
            target_language="中文",
            segments=[{"id": "a", "speaker": "narrator", "text": "hello", "start_ms": 0, "end_ms": 1500}],
        )
        self.assertEqual(result["fallback_chunk_count"], 1)
        self.assertEqual(result["segments"][0]["text"], "fallback:hello")

    async def test_cache_hit_skips_second_translation(self) -> None:
        class CountingBatchEngine(_FakeTranslationEngine):
            def __init__(self):
                self.batch_calls = 0

            async def generate_text(self, *, text, system_prompt, llm_options):
                prompt = str(system_prompt or "")
                if "配音预处理助手" in prompt:
                    return "术语"
                if "JSON 数组" in prompt:
                    self.batch_calls += 1
                    rows = json.loads(text)
                    return json.dumps([{"id": row["id"], "text": f"{row['text']}译"} for row in rows], ensure_ascii=False)
                return f"{text}译"

        engine = CountingBatchEngine()
        state = _build_state()
        state.translation_llm_engine = engine
        payload = [{"id": "a", "speaker": "narrator", "text": "hello", "start_ms": 0, "end_ms": 1500}]
        first = await translate_dubbing_segments_for_state(
            state=state,
            source="secondary_local",
            target_language="中文",
            segments=payload,
        )
        second = await translate_dubbing_segments_for_state(
            state=state,
            source="secondary_local",
            target_language="中文",
            segments=payload,
        )
        self.assertEqual(engine.batch_calls, 1)
        self.assertEqual(second["cache_hits"], 1)
        self.assertEqual(first["segments"][0]["text"], second["segments"][0]["text"])


if __name__ == "__main__":
    unittest.main()
