from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json

from backend.models import Project, ProjectFilePayload, SynthesisConfig


def compute_payload_fingerprint(raw_bytes: bytes) -> str:
    return hashlib.sha256(raw_bytes).hexdigest()


def build_project_file_payload(project: Project) -> ProjectFilePayload:
    return ProjectFilePayload(
        project={
            "name": project.name,
            "status": project.status,
        },
        script=project.script.model_copy(deep=True),
        voice_assignments=dict(project.voice_assignments or {}),
        synthesis_config=project.synthesis_config,
        source_project_id=project.id,
        exported_at=datetime.now(timezone.utc),
        metadata={
            "format": "lightweight",
            "includes_audio_assets": False,
        },
    )


def parse_project_file_payload(raw_bytes: bytes) -> tuple[ProjectFilePayload, str]:
    raw_payload = json.loads(raw_bytes.decode("utf-8"))
    payload = ProjectFilePayload.model_validate(raw_payload)
    fingerprint = compute_payload_fingerprint(raw_bytes)
    return payload, fingerprint


def normalize_synthesis_config(config_like: object) -> SynthesisConfig:
    return SynthesisConfig.model_validate(config_like or {})
