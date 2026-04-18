from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import wave

from backend.models import Project, Segment
from backend.services.tts_segment_service import process_synthesis_segment


def _write_sine_like_wav(path: Path, *, frames: int = 2400, sample_rate: int = 24000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b"\x01\x00" * frames)


class _FakeTTSEngine:
    def __init__(self) -> None:
        self.calls = 0

    async def synthesize_to_file(self, text, output, preset, config, tts_overrides=None):
        self.calls += 1
        _write_sine_like_wav(Path(output))


class TtsSegmentServiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_process_segment_generates_and_writes_assets(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "output"
            cache_dir = Path(tmp_dir) / "cache"
            temp_dir = Path(tmp_dir) / "temp"
            project_segments_dir = output_dir / "projects" / "p1" / "segments"
            project_segment_waveforms_dir = output_dir / "projects" / "p1" / "waveforms" / "segments"
            output_dir.mkdir(parents=True, exist_ok=True)
            cache_dir.mkdir(parents=True, exist_ok=True)
            temp_dir.mkdir(parents=True, exist_ok=True)

            segment = Segment(id="seg-1", index=0, type="narration", speaker="narrator", text="hello")
            segment_path = temp_dir / "seg-1.wav"
            cached_path = cache_dir / "cache-key.wav"
            engine = _FakeTTSEngine()
            combined = bytearray()
            project = Project(name="segment-test")

            result = await process_synthesis_segment(
                tts_engine=engine,
                segment=segment,
                segment_path=segment_path,
                preset=None,
                config=project.synthesis_config,
                normalized_overrides={},
                cached_path=cached_path,
                cache_hit=False,
                can_reuse=False,
                project_asset_path=None,
                rebuild_full=True,
                index=0,
                total=2,
                combined_frames=combined,
                sample_rate=24000,
                project_segments_dir=project_segments_dir,
                project_segment_waveforms_dir=project_segment_waveforms_dir,
                output_dir=output_dir,
                fingerprint="fp-1",
                preset_id=None,
                preset_hash="",
                config_hash="cfg",
                tts_backend="mock",
                tts_model_path="",
                task_id="task-1",
                gap_duration_ms=500,
            )

            self.assertEqual(engine.calls, 1)
            self.assertEqual(result["generated_count_delta"], 1)
            self.assertTrue(cached_path.exists())
            self.assertTrue((project_segments_dir / "seg-1.wav").exists())
            self.assertTrue((project_segment_waveforms_dir / "seg-1.peaks.json").exists())
            self.assertGreater(len(combined), 0)

    async def test_process_segment_reuses_project_audio_without_generation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "output"
            cache_dir = Path(tmp_dir) / "cache"
            temp_dir = Path(tmp_dir) / "temp"
            project_segments_dir = output_dir / "projects" / "p1" / "segments"
            project_segment_waveforms_dir = output_dir / "projects" / "p1" / "waveforms" / "segments"
            output_dir.mkdir(parents=True, exist_ok=True)
            cache_dir.mkdir(parents=True, exist_ok=True)
            temp_dir.mkdir(parents=True, exist_ok=True)

            segment = Segment(id="seg-2", index=0, type="narration", speaker="narrator", text="reuse")
            project_asset_path = output_dir / "projects" / "p1" / "segments" / "existing.wav"
            _write_sine_like_wav(project_asset_path)
            segment_path = temp_dir / "seg-2.wav"
            cached_path = cache_dir / "cache-key-2.wav"
            engine = _FakeTTSEngine()
            combined = bytearray()
            project = Project(name="segment-test")

            result = await process_synthesis_segment(
                tts_engine=engine,
                segment=segment,
                segment_path=segment_path,
                preset=None,
                config=project.synthesis_config,
                normalized_overrides={},
                cached_path=cached_path,
                cache_hit=False,
                can_reuse=True,
                project_asset_path=project_asset_path,
                rebuild_full=False,
                index=0,
                total=1,
                combined_frames=combined,
                sample_rate=24000,
                project_segments_dir=project_segments_dir,
                project_segment_waveforms_dir=project_segment_waveforms_dir,
                output_dir=output_dir,
                fingerprint="fp-2",
                preset_id=None,
                preset_hash="",
                config_hash="cfg",
                tts_backend="mock",
                tts_model_path="",
                task_id="task-1",
                gap_duration_ms=500,
            )

            self.assertEqual(engine.calls, 0)
            self.assertEqual(result["generated_count_delta"], 0)
            self.assertTrue(result["reused"])
            self.assertTrue((project_segments_dir / "seg-2.wav").exists())


if __name__ == "__main__":
    unittest.main()
