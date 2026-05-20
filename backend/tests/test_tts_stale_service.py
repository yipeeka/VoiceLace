from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from backend.models import Project, Segment, SegmentAsset
from backend.services.tts_stale_service import (
    build_stale_report,
    resolve_segment_asset_path,
    resolve_segment_peaks_path,
)
from backend.services.tts_task_service import legacy_segment_cache_key_full_config, segment_cache_key


def _hash_payload(payload: dict) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


def _segment_cache_key(*, text: str, preset, config, tts_backend: str, tts_model_path: str, tts_overrides: dict | None = None) -> str:
    blob = json.dumps(
        {
            "text": text,
            "preset_id": getattr(preset, "id", None),
            "backend": tts_backend,
            "model": tts_model_path,
            "overrides": tts_overrides or {},
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


class TtsStaleServiceTest(unittest.TestCase):
    def test_resolve_segment_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="stale-paths")
            seg_audio_rel = f"projects/{project.id}/segments/a.wav"
            seg_peaks_rel = f"projects/{project.id}/waveforms/segments/a.peaks.json"
            project.audio_assets.segments["s1"] = SegmentAsset(
                segment_id="s1",
                audio_relpath=seg_audio_rel,
                peaks_relpath=seg_peaks_rel,
            )
            audio = output_dir / seg_audio_rel
            peaks = output_dir / seg_peaks_rel
            audio.parent.mkdir(parents=True, exist_ok=True)
            peaks.parent.mkdir(parents=True, exist_ok=True)
            audio.write_bytes(b"RIFF")
            peaks.write_text("{}", encoding="utf-8")

            self.assertIsNotNone(resolve_segment_asset_path(output_dir=output_dir, project=project, segment_id="s1"))
            self.assertIsNotNone(resolve_segment_peaks_path(output_dir=output_dir, project=project, segment_id="s1"))

    def test_build_stale_report_fingerprint_match_resolves_text_changed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="stale-report")
            project.script.segments = [
                Segment(id="seg-a", index=0, type="narration", speaker="narrator", text="新文本"),
                Segment(id="seg-b", index=1, type="narration", speaker="narrator", text="缺失音频"),
            ]
            audio_rel = f"projects/{project.id}/segments/seg-a.wav"
            audio_path = output_dir / audio_rel
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"RIFF-a")
            expected_fp = _segment_cache_key(
                text="新文本",
                preset=None,
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                tts_overrides={},
            )
            project.audio_assets.segments["seg-a"] = SegmentAsset(
                segment_id="seg-a",
                audio_relpath=audio_rel,
                source_text="旧文本",
                source_speaker="narrator",
                source_type="narration",
                source_emotion="neutral",
                source_tts_overrides={},
                source_config_hash=_hash_payload(project.synthesis_config.model_dump()),
                source_tts_backend="mock",
                source_tts_model_path="",
                fingerprint=expected_fp,
            )

            report = build_stale_report(
                output_dir=output_dir,
                project=project,
                presets=[],
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda segment, strict=False: segment.tts_overrides or {},
                segment_cache_key=_segment_cache_key,
                hash_payload=_hash_payload,
                debug_stale_report=False,
                logger=None,
            )

            self.assertEqual(report["total"], 2)
            self.assertIn("seg-b", report["missing_segment_ids"])
            by_id = {item["segment_id"]: item for item in report["items"]}
            self.assertEqual(by_id["seg-a"]["status"], "ready")
            self.assertEqual(by_id["seg-a"]["reasons"], [])
            self.assertEqual(by_id["seg-b"]["status"], "missing")

    def test_postprocess_config_changes_do_not_mark_segments_stale(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="postprocess-not-stale")
            project.script.segments = [
                Segment(id="seg-a", index=0, type="narration", speaker="narrator", text="片段文本"),
            ]
            audio_rel = f"projects/{project.id}/segments/seg-a.wav"
            audio_path = output_dir / audio_rel
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"RIFF-a")
            source_config_hash = _hash_payload({
                key: value
                for key, value in project.synthesis_config.model_dump().items()
                if key
                not in {
                    "postprocess_enabled",
                    "loudness_normalize",
                    "target_lufs",
                    "trim_silence_enabled",
                    "trim_threshold_db",
                    "trim_min_silence_ms",
                    "fade_in_ms",
                    "fade_out_ms",
                    "mp3_bitrate_kbps",
                    "chapter_markers",
                    "bgm_track",
                    "ambience_track",
                }
            })
            expected_fp = segment_cache_key(
                text="片段文本",
                preset=None,
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                tts_overrides={},
            )
            project.audio_assets.segments["seg-a"] = SegmentAsset(
                segment_id="seg-a",
                audio_relpath=audio_rel,
                source_text="片段文本",
                source_speaker="narrator",
                source_type="narration",
                source_emotion="neutral",
                source_tts_overrides={},
                source_config_hash=source_config_hash,
                source_tts_backend="mock",
                source_tts_model_path="",
                fingerprint=expected_fp,
            )

            project.synthesis_config.postprocess_enabled = True
            project.synthesis_config.fade_in_ms = 800
            project.synthesis_config.fade_out_ms = 1200
            project.synthesis_config.target_lufs = -14.0
            project.synthesis_config.bgm_track.relpath = "projects/demo/postprocess_assets/bgm.wav"
            project.synthesis_config.bgm_track.gain_db = -8.0

            report = build_stale_report(
                output_dir=output_dir,
                project=project,
                presets=[],
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda segment, strict=False: segment.tts_overrides or {},
                segment_cache_key=segment_cache_key,
                hash_payload=_hash_payload,
                debug_stale_report=False,
                logger=None,
            )

            self.assertEqual(report["stale_count"], 0)
            self.assertIn("seg-a", report["ready_segment_ids"])

    def test_legacy_full_config_fingerprint_remains_ready_after_postprocess_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="legacy-postprocess-not-stale")
            project.script.segments = [
                Segment(id="seg-a", index=0, type="narration", speaker="narrator", text="旧指纹片段"),
            ]
            audio_rel = f"projects/{project.id}/segments/seg-a.wav"
            audio_path = output_dir / audio_rel
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"RIFF-a")
            legacy_fp = legacy_segment_cache_key_full_config(
                text="旧指纹片段",
                preset=None,
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                tts_overrides={},
            )
            project.audio_assets.segments["seg-a"] = SegmentAsset(
                segment_id="seg-a",
                audio_relpath=audio_rel,
                source_text="旧指纹片段",
                source_speaker="narrator",
                source_type="narration",
                source_emotion="neutral",
                source_tts_overrides={},
                source_config_hash=_hash_payload(project.synthesis_config.model_dump()),
                source_tts_backend="mock",
                source_tts_model_path="",
                fingerprint=legacy_fp,
            )

            project.synthesis_config.postprocess_enabled = True
            project.synthesis_config.ambience_track.relpath = "projects/demo/postprocess_assets/amb.wav"

            report = build_stale_report(
                output_dir=output_dir,
                project=project,
                presets=[],
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda segment, strict=False: segment.tts_overrides or {},
                segment_cache_key=segment_cache_key,
                hash_payload=_hash_payload,
                debug_stale_report=False,
                logger=None,
            )

            self.assertEqual(report["stale_count"], 0)
            self.assertIn("seg-a", report["ready_segment_ids"])

    def test_dubbing_stale_ignores_timing_overrides_but_checks_target_duration(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="dubbing-stale")
            project.script.metadata = {"dubbing_source": True}
            project.synthesis_config.timeline_lock_enabled = True
            segment = Segment(
                id="seg-a",
                index=0,
                type="narration",
                speaker="narrator",
                text="配音片段",
                tts_overrides={"duration": 2.0, "speed": 0.9, "denoise": True},
                source_start_ms=0,
                source_end_ms=2000,
            )
            project.script.segments = [segment]
            audio_rel = f"projects/{project.id}/segments/seg-a.wav"
            audio_path = output_dir / audio_rel
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"RIFF-a")
            expected_fp = segment_cache_key(
                text=segment.text,
                preset=None,
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                tts_overrides={
                    "denoise": True,
                    "_timeline_target_duration_ms": 2000,
                    "_timeline_stretch_policy_version": 1,
                },
            )
            project.audio_assets.segments["seg-a"] = SegmentAsset(
                segment_id="seg-a",
                audio_relpath=audio_rel,
                duration_ms=1000,
                source_text="配音片段",
                source_speaker="narrator",
                source_type="narration",
                source_emotion="neutral",
                source_tts_overrides={"denoise": True},
                source_config_hash=_hash_payload(project.synthesis_config.model_dump()),
                source_tts_backend="mock",
                source_tts_model_path="",
                fingerprint=expected_fp,
            )

            report = build_stale_report(
                output_dir=output_dir,
                project=project,
                presets=[],
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda item, strict=False: item.tts_overrides or {},
                segment_cache_key=segment_cache_key,
                hash_payload=_hash_payload,
                debug_stale_report=False,
                logger=None,
            )

            self.assertEqual(report["stale_count"], 1)
            self.assertIn("timeline_target_changed", report["items"][0]["reasons"])

    def test_dubbing_stale_allows_tiny_timeline_duration_rounding(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="dubbing-rounding")
            project.script.metadata = {"dubbing_source": True}
            project.synthesis_config.timeline_lock_enabled = True
            segment = Segment(
                id="seg-a",
                index=0,
                type="narration",
                speaker="narrator",
                text="配音片段",
                source_start_ms=100,
                source_end_ms=1702,
            )
            project.script.segments = [segment]
            audio_rel = f"projects/{project.id}/segments/seg-a.wav"
            audio_path = output_dir / audio_rel
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"RIFF-a")
            expected_fp = segment_cache_key(
                text=segment.text,
                preset=None,
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                tts_overrides={
                    "_timeline_target_duration_ms": 1602,
                    "_timeline_stretch_policy_version": 1,
                },
            )
            project.audio_assets.segments["seg-a"] = SegmentAsset(
                segment_id="seg-a",
                audio_relpath=audio_rel,
                duration_ms=1600,
                source_text="配音片段",
                source_speaker="narrator",
                source_type="narration",
                source_emotion="neutral",
                source_tts_overrides={},
                source_config_hash=_hash_payload(project.synthesis_config.model_dump()),
                source_tts_backend="mock",
                source_tts_model_path="",
                fingerprint=expected_fp,
            )

            report = build_stale_report(
                output_dir=output_dir,
                project=project,
                presets=[],
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda item, strict=False: item.tts_overrides or {},
                segment_cache_key=segment_cache_key,
                hash_payload=_hash_payload,
                debug_stale_report=False,
                logger=None,
            )

            self.assertEqual(report["stale_count"], 0)
            self.assertIn("seg-a", report["ready_segment_ids"])

    def test_unlocked_dubbing_stale_uses_full_tts_overrides(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir)
            project = Project(name="dubbing-unlocked")
            project.script.metadata = {"dubbing_source": True}
            project.synthesis_config.timeline_lock_enabled = False
            overrides = {
                "duration": 2.0,
                "speed": 0.9,
                "denoise": True,
                "num_step": 24,
                "guidance_scale": 1.8,
                "custom": "keep",
            }
            segment = Segment(
                id="seg-a",
                index=0,
                type="narration",
                speaker="narrator",
                text="配音片段",
                tts_overrides=overrides,
                source_start_ms=100,
                source_end_ms=1702,
            )
            project.script.segments = [segment]
            audio_rel = f"projects/{project.id}/segments/seg-a.wav"
            audio_path = output_dir / audio_rel
            audio_path.parent.mkdir(parents=True, exist_ok=True)
            audio_path.write_bytes(b"RIFF-a")
            expected_fp = segment_cache_key(
                text=segment.text,
                preset=None,
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                tts_overrides=overrides,
            )
            project.audio_assets.segments["seg-a"] = SegmentAsset(
                segment_id="seg-a",
                audio_relpath=audio_rel,
                duration_ms=1600,
                source_text="配音片段",
                source_speaker="narrator",
                source_type="narration",
                source_emotion="neutral",
                source_tts_overrides=overrides,
                source_config_hash=_hash_payload(project.synthesis_config.model_dump()),
                source_tts_backend="mock",
                source_tts_model_path="",
                fingerprint=expected_fp,
            )

            report = build_stale_report(
                output_dir=output_dir,
                project=project,
                presets=[],
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda item, strict=False: item.tts_overrides or {},
                segment_cache_key=segment_cache_key,
                hash_payload=_hash_payload,
                debug_stale_report=False,
                logger=None,
            )

            self.assertEqual(report["stale_count"], 0)
            self.assertIn("seg-a", report["ready_segment_ids"])


if __name__ == "__main__":
    unittest.main()
