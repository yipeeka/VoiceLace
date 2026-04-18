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


if __name__ == "__main__":
    unittest.main()
