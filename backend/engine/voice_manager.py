from __future__ import annotations

import json
import logging
from pathlib import Path

from backend.models import VoicePreset

logger = logging.getLogger(__name__)


class VoiceManager:
    def __init__(self, storage_dir: Path, project_root: Path | None = None) -> None:
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.presets_file = self.storage_dir / "presets.json"
        self.project_root = (project_root or self.storage_dir.parents[2]).resolve()

    def to_storage_path(self, value: str | Path | None) -> str | None:
        if value is None:
            return None
        raw_value = str(value).strip()
        if not raw_value:
            return ""
        path = Path(raw_value).expanduser()
        if not path.is_absolute():
            return raw_value
        try:
            return path.resolve().relative_to(self.project_root).as_posix()
        except ValueError:
            return raw_value

    def normalize_preset_paths(self, preset: VoicePreset) -> VoicePreset:
        updates = {
            "ref_audio_path": self.to_storage_path(preset.ref_audio_path),
            "sample_audio_path": self.to_storage_path(preset.sample_audio_path),
        }
        profiles = preset.backend_profiles
        profile_updates = {}
        if profiles and profiles.omnivoice is not None:
            profile_updates["omnivoice"] = profiles.omnivoice.model_copy(
                update={"ref_audio_path": self.to_storage_path(profiles.omnivoice.ref_audio_path)}
            )
        if profiles and profiles.voxcpm2 is not None:
            profile_updates["voxcpm2"] = profiles.voxcpm2.model_copy(
                update={"ref_audio_path": self.to_storage_path(profiles.voxcpm2.ref_audio_path)}
            )
        if profile_updates:
            updates["backend_profiles"] = profiles.model_copy(update=profile_updates)
        return preset.model_copy(update=updates)

    def list_presets(self) -> list[VoicePreset]:
        if not self.presets_file.exists():
            return []
        try:
            data = json.loads(self.presets_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to load voice presets JSON: %s", exc)
            return []

        if not isinstance(data, list):
            logger.warning("Voice presets file is not a list, got %s", type(data).__name__)
            return []

        presets: list[VoicePreset] = []
        for item in data:
            try:
                presets.append(self.normalize_preset_paths(VoicePreset.model_validate(item)))
            except Exception as exc:
                logger.warning("Skip invalid voice preset entry: %s", exc)
        return presets

    def save_presets(self, presets: list[VoicePreset]) -> None:
        normalized_presets = [self.normalize_preset_paths(preset) for preset in presets]
        self.presets_file.write_text(
            json.dumps([preset.model_dump(mode="json") for preset in normalized_presets], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
