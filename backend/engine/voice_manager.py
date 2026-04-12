from __future__ import annotations

import json
import logging
from pathlib import Path

from backend.models import VoicePreset

logger = logging.getLogger(__name__)


class VoiceManager:
    def __init__(self, storage_dir: Path) -> None:
        self.storage_dir = storage_dir
        self.storage_dir.mkdir(parents=True, exist_ok=True)
        self.presets_file = self.storage_dir / "presets.json"

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
                presets.append(VoicePreset.model_validate(item))
            except Exception as exc:
                logger.warning("Skip invalid voice preset entry: %s", exc)
        return presets

    def save_presets(self, presets: list[VoicePreset]) -> None:
        self.presets_file.write_text(
            json.dumps([preset.model_dump(mode="json") for preset in presets], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
