from __future__ import annotations

from backend.services.tts_task_service import public_task


def create_tts_task_record(*, task_id: str, project_id: str, kind: str = "synthesis") -> dict:
    return {
        "task_id": task_id,
        "kind": kind,
        "status": "queued",
        "segments": {},
        "project_id": project_id,
        "progress": {"current": 0, "total": 0},
        "export_url": "",
        "processed_export_url": "",
        "chapter_exports": [],
        "subtitle_srt_url": "",
        "subtitle_lrc_url": "",
        "error": "",
        "events": [{"type": "task_status", "status": "queued", "kind": kind}],
    }


def build_tts_status_response(task_id: str, status: dict) -> tuple[int, dict]:
    if status["status"] == "error":
        return (
            500,
            {
                "detail": status["error"],
                "message": status["error"],
                "code": "tts_task_error",
                "task_id": task_id,
            },
        )
    payload = public_task(status)
    if status["status"] != "done":
        return 202, payload
    return 200, payload
