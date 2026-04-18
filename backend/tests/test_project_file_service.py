from __future__ import annotations

import json
import unittest

from backend.models import Project, SynthesisConfig
from backend.services.project_file_service import (
    build_project_file_payload,
    compute_payload_fingerprint,
    normalize_synthesis_config,
    parse_project_file_payload,
)


class ProjectFileServiceTest(unittest.TestCase):
    def test_build_payload_copies_core_fields(self) -> None:
        project = Project(name="P2-Service-Test")
        project.script.source_text = "hello"
        project.voice_assignments = {"narrator": "preset-1"}

        payload = build_project_file_payload(project)

        self.assertEqual(payload.project.name, "P2-Service-Test")
        self.assertEqual(payload.script.source_text, "hello")
        self.assertEqual(payload.voice_assignments.get("narrator"), "preset-1")
        self.assertEqual(payload.source_project_id, project.id)
        self.assertEqual(payload.metadata.get("format"), "lightweight")

    def test_parse_payload_returns_fingerprint(self) -> None:
        project = Project(name="Parse-Test")
        payload = build_project_file_payload(project).model_dump(mode="json")
        raw_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")

        parsed, fingerprint = parse_project_file_payload(raw_bytes)

        self.assertEqual(parsed.project.name, "Parse-Test")
        self.assertEqual(fingerprint, compute_payload_fingerprint(raw_bytes))

    def test_normalize_synthesis_config_accepts_model_or_dict(self) -> None:
        from_dict = normalize_synthesis_config({"output_format": "mp3", "num_step": 24})
        from_model = normalize_synthesis_config(SynthesisConfig(output_format="wav", num_step=32))

        self.assertEqual(from_dict.output_format, "mp3")
        self.assertEqual(from_dict.num_step, 24)
        self.assertEqual(from_model.output_format, "wav")
        self.assertEqual(from_model.num_step, 32)


if __name__ == "__main__":
    unittest.main()
