from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from backend.state import get_app_state

router = APIRouter()


@router.websocket("/llm-stream/{task_id}")
async def llm_stream_endpoint(websocket: WebSocket, task_id: str, state=Depends(get_app_state)):
    await websocket.accept()
    await state.realtime.subscribe("llm", task_id, websocket)
    task = state.llm_tasks.get(task_id)
    if task:
        for event in task.get("events", []):
            await websocket.send_json(event)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await state.realtime.unsubscribe("llm", task_id, websocket)


@router.websocket("/tts-progress/{task_id}")
async def tts_progress_endpoint(websocket: WebSocket, task_id: str, state=Depends(get_app_state)):
    await websocket.accept()
    await state.realtime.subscribe("tts", task_id, websocket)
    task = state.tts_tasks.get(task_id)
    if task:
        for event in task.get("events", []):
            await websocket.send_json(event)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await state.realtime.unsubscribe("tts", task_id, websocket)


@router.websocket("/system-events")
async def system_events_endpoint(websocket: WebSocket, state=Depends(get_app_state)):
    await websocket.accept()
    await state.realtime.subscribe("system", "events", websocket)
    await websocket.send_json({"type": "heartbeat", "message": "System event channel connected."})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await state.realtime.unsubscribe("system", "events", websocket)


@router.websocket("/system/gpu-realtime")
async def system_gpu_realtime_endpoint(websocket: WebSocket, state=Depends(get_app_state)):
    await websocket.accept()
    try:
        while True:
            status = await state.orchestrator.get_status()
            await websocket.send_json(
                {
                    "type": "gpu_realtime",
                    "gpu": status.get("gpu", {}),
                    "state": status.get("state", "idle"),
                    "llm_loaded": status.get("llm_loaded", False),
                    "tts_loaded": status.get("tts_loaded", False),
                }
            )
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        return
