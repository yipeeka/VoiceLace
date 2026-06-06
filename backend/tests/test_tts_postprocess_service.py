from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from backend.models import Project, SegmentAsset
from backend.persistence import load_project, save_project
from backend.services.tts_postprocess_service import (
    _refresh_segment_source_config_hashes_if_generation_config_unchanged,
    bind_postprocess_asset_to_project,
)
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

    def test_bind_postprocess_asset_appends_music_and_effect_tracks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            projects_dir = root / "projects"
            output_dir = root / "output"
            source_dir = root / "source"
            source_dir.mkdir(parents=True)
            project = Project(name="multi-track-bind")
            save_project(projects_dir, project)

            music_source = source_dir / "theme.wav"
            effect_source = source_dir / "forest.wav"
            music_source.write_bytes(b"music")
            effect_source.write_bytes(b"effect")

            music_result = bind_postprocess_asset_to_project(
                projects_dir=projects_dir,
                output_dir=output_dir,
                project_id=project.id,
                asset_type="music",
                source_path=music_source,
            )
            effect_result = bind_postprocess_asset_to_project(
                projects_dir=projects_dir,
                output_dir=output_dir,
                project_id=project.id,
                asset_type="effect",
                source_path=effect_source,
            )

            reloaded = load_project(projects_dir, project.id)
            self.assertEqual(music_result["asset_type"], "music")
            self.assertEqual(effect_result["asset_type"], "effect")
            self.assertEqual(len(reloaded.synthesis_config.music_tracks), 1)
            self.assertEqual(len(reloaded.synthesis_config.effect_tracks), 1)
            self.assertTrue(reloaded.synthesis_config.music_tracks[0].id.startswith("music-"))
            self.assertTrue(reloaded.synthesis_config.effect_tracks[0].id.startswith("effect-"))
            self.assertTrue(reloaded.synthesis_config.music_tracks[0].relpath.endswith(".wav"))
            self.assertTrue(reloaded.synthesis_config.effect_tracks[0].relpath.endswith(".wav"))


if __name__ == "__main__":
    unittest.main()
