from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from backend.models import Project, Segment, SegmentAsset
from backend.services.tts_scan_service import build_synthesis_scan_plan
from backend.services.tts_stale_service import resolve_segment_asset_path


def _hash_payload(payload: dict) -> str:
    blob = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


def _segment_cache_key(*, text: str, preset, config, tts_backend: str, tts_model_path: str, tts_overrides: dict | None = None) -> str:
    blob = json.dumps(
        {
            "text": text,
            "preset": getattr(preset, "id", None),
            "backend": tts_backend,
            "model": tts_model_path,
            "overrides": tts_overrides or {},
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return hashlib.md5(blob.encode("utf-8")).hexdigest()


class TtsScanServiceTest(unittest.TestCase):
    def test_scan_plan_counts_reuse_cache_and_generate(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "output"
            cache_dir = Path(tmp_dir) / "cache"
            output_dir.mkdir(parents=True, exist_ok=True)
            cache_dir.mkdir(parents=True, exist_ok=True)

            project = Project(name="scan-test")
            seg_reuse = Segment(id="seg-reuse", index=0, type="narration", speaker="narrator", text="reuse")
            seg_cache = Segment(id="seg-cache", index=1, type="narration", speaker="narrator", text="cache")
            seg_gen = Segment(id="seg-gen", index=2, type="narration", speaker="narrator", text="generate")
            run_segments = [seg_reuse, seg_cache, seg_gen]

            reuse_rel = f"projects/{project.id}/segments/{seg_reuse.id}.wav"
            reuse_path = output_dir / reuse_rel
            reuse_path.parent.mkdir(parents=True, exist_ok=True)
            reuse_path.write_bytes(b"RIFF-reuse")
            project.audio_assets.segments[seg_reuse.id] = SegmentAsset(
                segment_id=seg_reuse.id,
                audio_relpath=reuse_rel,
                duration_ms=1000,
            )

            cache_key = _segment_cache_key(
                text=seg_cache.text,
                preset=None,
                config=project.synthesis_config,
                tts_backend="mock",
                tts_model_path="",
                tts_overrides={},
            )
            (cache_dir / f"{cache_key}.wav").write_bytes(b"RIFF-cache")

            scan = build_synthesis_scan_plan(
                run_segments=run_segments,
                voice_assignments=project.voice_assignments,
                presets_by_id={},
                config=project.synthesis_config,
                cache_dir=cache_dir,
                is_partial=True,
                rebuild_full=True,
                target_segment_ids={seg_cache.id, seg_gen.id},
                output_dir=output_dir,
                project=project,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda segment, strict=True: segment.tts_overrides or {},
                segment_cache_key=_segment_cache_key,
                hash_payload=_hash_payload,
                resolve_segment_asset_path=resolve_segment_asset_path,
            )

            self.assertEqual(scan["reused_count"], 1)
            self.assertEqual(scan["cached_count"], 1)
            self.assertEqual(scan["to_generate_count"], 1)
            self.assertEqual(scan["unresolved_non_target_ids"], [])
            self.assertEqual(len(scan["scan_items"]), 3)

    def test_scan_plan_flags_unresolved_non_target(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            output_dir = Path(tmp_dir) / "output"
            cache_dir = Path(tmp_dir) / "cache"
            output_dir.mkdir(parents=True, exist_ok=True)
            cache_dir.mkdir(parents=True, exist_ok=True)

            project = Project(name="scan-unresolved")
            seg_a = Segment(id="seg-a", index=0, type="narration", speaker="narrator", text="A")
            seg_b = Segment(id="seg-b", index=1, type="narration", speaker="narrator", text="B")
            run_segments = [seg_a, seg_b]

            scan = build_synthesis_scan_plan(
                run_segments=run_segments,
                voice_assignments=project.voice_assignments,
                presets_by_id={},
                config=project.synthesis_config,
                cache_dir=cache_dir,
                is_partial=True,
                rebuild_full=True,
                target_segment_ids={seg_a.id},
                output_dir=output_dir,
                project=project,
                tts_backend="mock",
                tts_model_path="",
                normalize_segment_tts_overrides=lambda segment, strict=True: segment.tts_overrides or {},
                segment_cache_key=_segment_cache_key,
                hash_payload=_hash_payload,
                resolve_segment_asset_path=resolve_segment_asset_path,
            )

            self.assertEqual(scan["unresolved_non_target_ids"], [seg_b.id])


if __name__ == "__main__":
    unittest.main()
