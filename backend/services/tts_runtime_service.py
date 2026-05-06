from __future__ import annotations

from backend.engine.tts_overrides import normalize_tts_overrides
from backend.persistence import append_project_event


def normalize_segment_tts_overrides(segment, *, strict: bool = True) -> dict:
    try:
        return normalize_tts_overrides(segment.tts_overrides)
    except ValueError as exc:
        if strict:
            raise RuntimeError(
                f"segment #{segment.index + 1} ({segment.id}) has invalid tts_overrides: {exc}"
            ) from exc
        return {}


async def emit_task_event(*, state, task: dict, task_id: str, message: dict) -> None:
    task["events"].append(message)
    if task.get("project_id"):
        append_project_event(
            state.settings.projects_dir,
            task["project_id"],
            {
                "source": "tts",
                "kind": task.get("kind", "synthesis"),
                "task_id": task_id,
                "status": task.get("status", ""),
                "event": message,
            },
        )
    await state.realtime.publish("tts", task_id, message)
