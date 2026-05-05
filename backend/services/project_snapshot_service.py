from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from backend.models import Project
from backend.persistence import load_project, save_project

SNAPSHOT_RETENTION_LIMIT = 20
_SAFE_REASON_PATTERN = re.compile(r"[^a-z0-9_-]+")


def _snapshot_dir(projects_dir: Path, project_id: str) -> Path:
    return projects_dir / "snapshots" / project_id


def _normalize_reason(reason: str) -> str:
    normalized = _SAFE_REASON_PATTERN.sub("-", (reason or "manual").strip().lower())
    normalized = normalized.strip("-")
    return normalized or "manual"


def _build_snapshot_payload(*, project: Project, snapshot_id: str, created_at: str, reason: str) -> dict:
    return {
        "snapshot_id": snapshot_id,
        "created_at": created_at,
        "reason": reason,
        "project_id": project.id,
        "project_name": project.name,
        "status": project.status,
        "segment_count": len(project.script.segments or []),
        "character_count": len(project.script.characters or []),
        "project": project.model_dump(mode="json"),
    }


def _to_summary(payload: dict) -> dict:
    return {
        "id": payload.get("snapshot_id", ""),
        "created_at": payload.get("created_at", ""),
        "reason": payload.get("reason", ""),
        "project_name": payload.get("project_name", ""),
        "status": payload.get("status", ""),
        "segment_count": int(payload.get("segment_count", 0) or 0),
        "character_count": int(payload.get("character_count", 0) or 0),
    }


def _resolve_snapshot_path(projects_dir: Path, project_id: str, snapshot_id: str) -> Path:
    root = _snapshot_dir(projects_dir, project_id)
    path = root / f"{snapshot_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return path


def _prune_snapshots(projects_dir: Path, project_id: str, limit: int = SNAPSHOT_RETENTION_LIMIT) -> None:
    root = _snapshot_dir(projects_dir, project_id)
    if not root.exists():
        return
    files = sorted(root.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
    for stale_file in files[limit:]:
        stale_file.unlink(missing_ok=True)


def create_project_snapshot(projects_dir: Path, project: Project, *, reason: str) -> dict:
    created_at = datetime.now(timezone.utc).isoformat()
    safe_reason = _normalize_reason(reason)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    snapshot_id = f"{stamp}_{uuid4().hex[:8]}_{safe_reason}"

    root = _snapshot_dir(projects_dir, project.id)
    root.mkdir(parents=True, exist_ok=True)
    payload = _build_snapshot_payload(
        project=project,
        snapshot_id=snapshot_id,
        created_at=created_at,
        reason=safe_reason,
    )
    snapshot_path = root / f"{snapshot_id}.json"
    snapshot_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _prune_snapshots(projects_dir, project.id)
    return _to_summary(payload)


def list_project_snapshots(projects_dir: Path, project_id: str, *, limit: int = 50) -> list[dict]:
    root = _snapshot_dir(projects_dir, project_id)
    if not root.exists():
        return []
    payloads: list[dict] = []
    for file in sorted(root.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True):
        try:
            payload = json.loads(file.read_text(encoding="utf-8"))
            payloads.append(payload)
        except json.JSONDecodeError:
            continue
    if limit > 0:
        payloads = payloads[:limit]
    return [_to_summary(payload) for payload in payloads]


def get_project_snapshot(projects_dir: Path, project_id: str, snapshot_id: str) -> dict:
    path = _resolve_snapshot_path(projects_dir, project_id, snapshot_id)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail="Snapshot payload is corrupted") from exc
    return payload


def restore_project_snapshot(projects_dir: Path, project_id: str, snapshot_id: str) -> tuple[Project, dict]:
    current_project = load_project(projects_dir, project_id)
    backup = create_project_snapshot(projects_dir, current_project, reason="before_snapshot_restore")
    payload = get_project_snapshot(projects_dir, project_id, snapshot_id)
    project_payload = payload.get("project")
    if not isinstance(project_payload, dict):
        raise HTTPException(status_code=500, detail="Snapshot payload missing project data")
    restored = Project.model_validate(project_payload)
    restored.id = project_id
    saved = save_project(projects_dir, restored)
    return saved, backup
