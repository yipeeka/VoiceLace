from __future__ import annotations

from backend.persistence import load_project, read_project_events
from backend.services.project_snapshot_service import list_project_snapshots


def _history_label_for_project_event(event_type: str) -> str:
    labels = {
        "project_created": "项目已创建",
        "project_updated": "项目已更新",
        "project_renamed": "项目已改名",
        "script_saved": "剧本已保存",
        "script_segment_updated": "片段已保存",
        "script_segment_added": "片段已新增",
        "script_segment_deleted": "片段已删除",
        "script_reordered": "片段已重排",
        "voice_assignments_saved": "角色分配已保存",
        "snapshot_restored": "已回滚到快照",
    }
    return labels.get(event_type, event_type or "项目事件")


def _history_label_for_llm_event(event_type: str) -> str | None:
    labels = {
        "complete": "解析完成",
        "error": "解析失败",
        "canceled": "解析已取消",
    }
    return labels.get(event_type)


def _history_label_for_tts_event(event_type: str) -> str | None:
    labels = {
        "complete": "合成完成",
        "error": "合成失败",
        "canceled": "合成已取消",
        "segment_error": "片段合成失败",
    }
    return labels.get(event_type)


def _to_snapshot_history_items(project_id: str, snapshots: list[dict]) -> list[dict]:
    items: list[dict] = []
    for snapshot in snapshots:
        items.append(
            {
                "kind": "snapshot",
                "id": f"snapshot:{snapshot.get('id', '')}",
                "project_id": project_id,
                "timestamp": snapshot.get("created_at", ""),
                "title": "自动快照",
                "description": f"{snapshot.get('reason', 'manual')} · {snapshot.get('segment_count', 0)} 段",
                "snapshot": snapshot,
                "event": None,
            }
        )
    return items


def _to_event_history_items(project_id: str, rows: list[dict]) -> list[dict]:
    items: list[dict] = []
    for index, row in enumerate(rows):
        source = str(row.get("source") or "")
        event = row.get("event") if isinstance(row.get("event"), dict) else {}
        event_type = str(event.get("type") or "")
        title = ""
        if source == "project":
            title = _history_label_for_project_event(event_type)
        elif source == "llm":
            title = _history_label_for_llm_event(event_type) or ""
        elif source == "tts":
            title = _history_label_for_tts_event(event_type) or ""
        if not title:
            continue
        message = str(event.get("message") or "").strip()
        description = message or f"task={row.get('task_id', '-')}"
        items.append(
            {
                "kind": "event",
                "id": f"event:{index}:{row.get('timestamp', '')}",
                "project_id": project_id,
                "timestamp": row.get("timestamp", ""),
                "title": title,
                "description": description,
                "snapshot": None,
                "event": {
                    "source": source,
                    "task_id": row.get("task_id", ""),
                    "status": row.get("status", ""),
                    "type": event_type,
                },
            }
        )
    return items


def get_project_history(project_id: str, *, projects_dir, limit: int = 200) -> list[dict]:
    _ = load_project(projects_dir, project_id)
    snapshots = list_project_snapshots(projects_dir, project_id, limit=limit)
    events = read_project_events(projects_dir, project_id, limit=max(limit * 3, 500))
    items = _to_snapshot_history_items(project_id, snapshots) + _to_event_history_items(project_id, events)
    items.sort(key=lambda item: item.get("timestamp", ""), reverse=True)
    if limit > 0:
        items = items[:limit]
    return items
