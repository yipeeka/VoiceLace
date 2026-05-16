from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from backend.engine.voice_manager import VoiceManager
from backend.models import OmniVoicePresetProfile, VoiceBackendProfiles, VoicePreset, VoxCpm2PresetProfile


class VoiceManagerTest(unittest.TestCase):
    def test_save_presets_stores_project_audio_paths_as_relative(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            voices_dir = root / "backend" / "data" / "voices"
            manager = VoiceManager(voices_dir, project_root=root)
            preset = VoicePreset(
                name="clone",
                voice_mode="clone",
                ref_audio_path=str(root / "samples" / "legacy.wav"),
                sample_audio_path=str(root / "samples" / "sample.wav"),
                backend_profiles=VoiceBackendProfiles(
                    omnivoice=OmniVoicePresetProfile(
                        voice_mode="clone",
                        ref_audio_path=str(root / "samples" / "omni.wav"),
                    ),
                    voxcpm2=VoxCpm2PresetProfile(
                        voice_mode="clone",
                        ref_audio_path=str(root / "backend" / "data" / "voices" / "vox.wav"),
                    ),
                ),
            )

            manager.save_presets([preset])

            raw = json.loads(manager.presets_file.read_text(encoding="utf-8"))[0]
            self.assertEqual(raw["ref_audio_path"], "samples/legacy.wav")
            self.assertEqual(raw["sample_audio_path"], "samples/sample.wav")
            self.assertEqual(raw["backend_profiles"]["omnivoice"]["ref_audio_path"], "samples/omni.wav")
            self.assertEqual(raw["backend_profiles"]["voxcpm2"]["ref_audio_path"], "backend/data/voices/vox.wav")

    def test_external_absolute_path_is_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            manager = VoiceManager(root / "backend" / "data" / "voices", project_root=root)
            external_path = str(Path(root.anchor or "/") / "external" / "ref.wav")

            manager.save_presets([VoicePreset(name="external", voice_mode="clone", ref_audio_path=external_path)])

            raw = json.loads(manager.presets_file.read_text(encoding="utf-8"))[0]
            self.assertEqual(raw["ref_audio_path"], external_path)


if __name__ == "__main__":
    unittest.main()
