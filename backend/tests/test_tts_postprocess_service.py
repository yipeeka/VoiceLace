from __future__ import annotations

import unittest

from backend.models import Project, SegmentAsset
from backend.services.tts_postprocess_service import _refresh_segment_source_config_hashes_if_generation_config_unchanged
from backend.services.tts_task_service import config_payload_for_segment_cache, hash_payload


class TtsPostprocessServiceTest(unittest.TestCase):
    def test_refreshes_segment_config_hash_when_only_postprocess_config_changed(self) -> None:
        project = Project(name="postprocess-hash-refresh")
        project.audio_assets.segments["seg-a"] = SegmentAsset(
            segment_id="seg-a",
            audio_relpath=f"projects/{project.id}/segments/seg-a.wav",
            source_config_hash=hash_payload(project.synthesis_config.model_dump()),
        )
        next_config = project.synthesis_config.model_copy(deep=True)
        next_config.postprocess_enabled = True
        next_config.fade_in_ms = 500
        next_config.bgm_track.relpath = "projects/demo/postprocess_assets/bgm.wav"

        _refresh_segment_source_config_hashes_if_generation_config_unchanged(project=project, next_config=next_config)

        self.assertEqual(
            project.audio_assets.segments["seg-a"].source_config_hash,
            hash_payload(config_payload_for_segment_cache(next_config)),
        )

    def test_does_not_refresh_segment_config_hash_when_generation_config_changed(self) -> None:
        project = Project(name="postprocess-hash-keeps-real-config-change")
        original_hash = hash_payload(project.synthesis_config.model_dump())
        project.audio_assets.segments["seg-a"] = SegmentAsset(
            segment_id="seg-a",
            audio_relpath=f"projects/{project.id}/segments/seg-a.wav",
            source_config_hash=original_hash,
        )
        next_config = project.synthesis_config.model_copy(deep=True)
        next_config.postprocess_enabled = True
        next_config.omnivoice.num_step = 64
        next_config.num_step = 64

        _refresh_segment_source_config_hashes_if_generation_config_unchanged(project=project, next_config=next_config)

        self.assertEqual(project.audio_assets.segments["seg-a"].source_config_hash, original_hash)


if __name__ == "__main__":
    unittest.main()
