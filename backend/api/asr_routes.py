from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError

from backend.api.llm_routes import enqueue_parse_task
from backend.services import create_project_from_audio, parse_speaker_map_form
from backend.state import get_app_state

router = APIRouter()


def _parse_bool_form(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    normalized = str(val).strip().lower()
    return normalized in {"1", "true", "yes", "on"}


async def _emit_asr_event(state, task: dict, task_id: str, event: dict) -> None:
    task["events"].append(event)
    await state.realtime.publish("asr", task_id, event)


async def _run_project_from_audio_task(task_id: str, task_input: dict, state) -> None:
    task = state.asr_tasks[task_id]
    task["status"] = "running"
    await _emit_asr_event(state, task, task_id, {"type": "task_status", "status": "running"})
    tmp_path = Path(task_input["tmp_path"])
    try:
        async def on_progress(event: dict) -> None:
            await _emit_asr_event(state, task, task_id, event)

        result = await create_project_from_audio(
            state=state,
            audio_path=tmp_path,
            audio_name=task_input.get("audio_name"),
            project_name=task_input.get("project_name"),
            speaker_labels=bool(task_input.get("speaker_labels")),
            parse_mode=task_input.get("parse_mode") or "verified_five_step_pipeline",
            auto_parse=bool(task_input.get("auto_parse")),
            speaker_map=task_input.get("speaker_map") or {},
            enqueue_parse_task=enqueue_parse_task,
            on_progress=on_progress,
        )
        task["status"] = "done"
        task["result"] = result
        await _emit_asr_event(state, task, task_id, {"type": "task_status", "status": "done"})
        await _emit_asr_event(state, task, task_id, {"type": "complete", "data": result})
    except Exception as exc:
        task["status"] = "error"
        task["error"] = str(exc)
        await _emit_asr_event(state, task, task_id, {"type": "task_status", "status": "error"})
        await _emit_asr_event(state, task, task_id, {"type": "error", "message": str(exc)})
    finally:
        tmp_path.unlink(missing_ok=True)
        state.asr_task_handles.pop(task_id, None)


@router.post("/transcribe-file")
async def transcribe_file(
    file: UploadFile = File(...),
    backend: str = Form("whisper"),
    speaker_labels: str | None = Form(None),
    state=Depends(get_app_state),
):
    normalized_backend = (backend or "whisper").strip().lower()
    if normalized_backend not in {"", "whisper"}:
        raise HTTPException(status_code=400, detail=f"Unsupported ASR backend: {backend}")

    suffix = Path(file.filename or "upload.wav").suffix or ".wav"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
            dir=state.settings.output_dir,
        ) as tmp_file:
            tmp_file.write(await file.read())
            tmp_path = Path(tmp_file.name)

        result = await state.asr_engine.transcribe(
            str(tmp_path),
            backend="whisper",
            speaker_labels=_parse_bool_form(speaker_labels, default=False),
        )
        return result
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        state.asr_engine.last_error = str(exc)
        raise HTTPException(status_code=503, detail=f"ASR unavailable: {exc}") from exc
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


@router.post("/project-from-audio")
async def project_from_audio(
    file: UploadFile = File(...),
    project_name: str | None = Form(None),
    speaker_labels: str | None = Form(None),
    parse_mode: str = Form("verified_five_step_pipeline"),
    auto_parse: str | None = Form(None),
    speaker_map: str | None = Form(None),
    state=Depends(get_app_state),
):
    suffix = Path(file.filename or "upload.wav").suffix or ".wav"
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
            dir=state.settings.output_dir,
        ) as tmp_file:
            tmp_file.write(await file.read())
            tmp_path = Path(tmp_file.name)

        task_id = str(uuid4())
        state.asr_tasks[task_id] = {
            "task_id": task_id,
            "status": "queued",
            "result": None,
            "error": "",
            "events": [{"type": "task_status", "status": "queued"}],
        }
        task_input = {
            "tmp_path": str(tmp_path),
            "audio_name": file.filename,
            "project_name": project_name,
            "speaker_labels": _parse_bool_form(speaker_labels, default=False),
            "parse_mode": (parse_mode or "verified_five_step_pipeline").strip() or "verified_five_step_pipeline",
            "auto_parse": _parse_bool_form(auto_parse, default=True),
            "speaker_map": parse_speaker_map_form(speaker_map),
        }
        handle = asyncio.create_task(_run_project_from_audio_task(task_id, task_input, state))
        state.asr_task_handles[task_id] = handle
        return {"task_id": task_id}
    except ValueError as exc:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValidationError as exc:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        state.asr_engine.last_error = str(exc)
        raise HTTPException(status_code=503, detail=f"ASR unavailable: {exc}") from exc


@router.get("/project-from-audio/{task_id}")
async def get_project_from_audio_task(task_id: str, state=Depends(get_app_state)):
    task = state.asr_tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="ASR task not found")
    if task["status"] == "done":
        return {"status": "done", "result": task.get("result")}
    if task["status"] == "error":
        return {"status": "error", "error": task.get("error") or "ASR task failed"}
    return {
        "status": task.get("status", "queued"),
        "task_id": task_id,
    }
