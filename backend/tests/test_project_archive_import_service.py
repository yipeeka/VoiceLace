from __future__ import annotations

import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from backend.models import Project
from backend.services.project_archive_import_service import import_project_archive_bytes


class _DummyVoiceManager:
    def __init__(self) -> None:
        self._presets = []
        self.saved_payload = None

    def list_presets(self):
        return list(self._presets)

    def save_presets(self, presets):
        self.saved_payload = list(presets)
        self._presets = list(presets)


class _DummySettings:
    def __init__(self, root: Path) -> None:
        self.projects_dir = root / "projects"
        self.output_dir = root / "output"
        self.voices_dir = root / "voices"
        self.projects_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.voices_dir.mkdir(parents=True, exist_ok=True)


def _build_zip(entries: dict[str, bytes | str]) -> bytes:
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, payload in entries.items():
            data = payload.encode("utf-8") if isinstance(payload, str) else payload
            zf.writestr(path, data)
    return out.getvalue()


class ProjectArchiveImportServiceTest(unittest.TestCase):
    def test_invalid_archive_raises_value_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            settings = _DummySettings(Path(tmp_dir))
            voice_manager = _DummyVoiceManager()
            with self.assertRaises(ValueError):
                import_project_archive_bytes(b"not-a-zip", settings=settings, voice_manager=voice_manager)

    def test_missing_project_json_raises_value_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            settings = _DummySettings(Path(tmp_dir))
            voice_manager = _DummyVoiceManager()
            archive = _build_zip({"voices/presets.json": "[]"})
            with self.assertRaises(ValueError):
                import_project_archive_bytes(archive, settings=settings, voice_manager=voice_manager)

    def test_minimal_archive_import_creates_project(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            settings = _DummySettings(Path(tmp_dir))
            voice_manager = _DummyVoiceManager()
            source = Project(name="archive-demo")
            payload = source.model_dump(mode="json")
            archive = _build_zip(
                {
                    "project/project.json": json.dumps(payload, ensure_ascii=False),
                    "voices/presets.json": "[]",
                }
            )

            result = import_project_archive_bytes(archive, settings=settings, voice_manager=voice_manager)

            self.assertEqual(result["import_source"], "archive_import")
            self.assertEqual(result["project_name"], "archive-demo")
            self.assertEqual(result["processed_presets"], 0)
            self.assertEqual(result["created_presets"], 0)
            self.assertTrue((settings.projects_dir / f"{result['project_id']}.json").exists())


if __name__ == "__main__":
    unittest.main()
