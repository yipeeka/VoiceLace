from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from backend.engine import OrchestratorConfig


def load_runtime_config(config_path: Path) -> OrchestratorConfig:
    if not config_path.exists():
        return OrchestratorConfig()
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return OrchestratorConfig()
        defaults = asdict(OrchestratorConfig())
        merged: dict[str, Any] = {**defaults, **payload}
        return OrchestratorConfig(**merged)
    except Exception:
        return OrchestratorConfig()


def save_runtime_config(config_path: Path, config: OrchestratorConfig) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(asdict(config), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def load_runtime_default_config(config_path: Path) -> OrchestratorConfig | None:
    if not config_path.exists():
        return None
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            return None
        defaults = asdict(OrchestratorConfig())
        merged: dict[str, Any] = {**defaults, **payload}
        return OrchestratorConfig(**merged)
    except Exception:
        return None


def save_runtime_default_config(config_path: Path, config: OrchestratorConfig) -> None:
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        json.dumps(asdict(config), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
