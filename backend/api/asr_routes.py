from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import ValidationError

from backend.api.llm_routes import enqueue_parse_task
from backend.services import create_project_from_audio, parse_speaker_map_form
from backend.services.audio_vocal_separation_service import normalize_demucs_model, prepare_vocal_audio_for_asr
from backend.state import get_app_state

router = APIRouter()


def _run_ffmpeg_extract_audio(input_path: Path, output_path: Path) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    try:
        subprocess.run(cmd, capture_output=True, check=True)
    except FileNotFoundError as exc:
        raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH。") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"ffmpeg 提取音频失败：{stderr or exc}") from exc
    if not output_path.exists() or output_path.stat().st_size <= 44:
        raise RuntimeError("未从视频中提取到有效音频。")


def _cleanup_paths(paths: list[Path]) -> None:
    for path in paths:
        path.unlink(missing_ok=True)


def _parse_bool_form(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    normalized = str(val).strip().lower()
    return normalized in {"1", "true", "yes", "on"}


async def _transcribe_with_optional_language(
    engine,
    audio_path: str,
    *,
    backend: str,
    language: str,
    speaker_labels: bool,
    enable_timestamps: bool,
    silence_aware_split: bool,
):
    try:
        return await engine.transcribe(
            audio_path,
            backend=backend,
            language=language,
            speaker_labels=speaker_labels,
            enable_timestamps=enable_timestamps,
            silence_aware_split=silence_aware_split,
        )
    except TypeError as exc:
        if "language" not in str(exc) and "silence_aware_split" not in str(exc) and "unexpected keyword" not in str(exc):
            raise
        return await engine.transcribe(
            audio_path,
            backend=backend,
            speaker_labels=speaker_labels,
            enable_timestamps=enable_timestamps,
        )


async def _emit_asr_event(state, task: dict, task_id: str, event: dict) -> None:
    task["events"].append(event)
    await state.realtime.publish("asr", task_id, event)


def _get_vocal_separation_options(state, *, enabled_form: str | None, model_form: str | None) -> dict:
    config = getattr(state.orchestrator, "config", None)
    enabled = _parse_bool_form(
        enabled_form,
        default=bool(getattr(config, "asr_vocal_separation_enabled", False)),
    )
    return {
        "enabled": enabled,
        "model": normalize_demucs_model(model_form or getattr(config, "asr_vocal_separation_model", "htdemucs")),
        "repo_dir": str(getattr(config, "asr_vocal_separation_repo_dir", "") or ""),
        "device": str(getattr(config, "asr_vocal_separation_device", "") or getattr(config, "asr_device", "cpu") or "cpu"),
    }


@router.post("/extract-audio")
async def extract_audio_from_upload(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    state=Depends(get_app_state),
):
    suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
    input_path: Path | None = None
    output_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
            dir=state.settings.output_dir,
        ) as tmp_file:
            tmp_file.write(await file.read())
            input_path = Path(tmp_file.name)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav", dir=state.settings.output_dir) as out_file:
            output_path = Path(out_file.name)
        await asyncio.to_thread(_run_ffmpeg_extract_audio, input_path, output_path)
        background_tasks.add_task(_cleanup_paths, [input_path, output_path])
        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename=f"{Path(file.filename or 'video').stem}-audio.wav",
            background=background_tasks,
        )
    except RuntimeError as exc:
        if input_path is not None:
            input_path.unlink(missing_ok=True)
        if output_path is not None:
            output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        if input_path is not None:
            input_path.unlink(missing_ok=True)
        if output_path is not None:
            output_path.unlink(missing_ok=True)
        raise HTTPException(status_code=503, detail=f"视频音频提取不可用：{exc}") from exc


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
            asr_backend=str(task_input.get("asr_backend") or "whisper"),
            language=str(task_input.get("language") or "auto"),
            enable_timestamps=bool(task_input.get("enable_timestamps")),
            silence_aware_split=bool(task_input.get("silence_aware_split", True)),
            vocal_separation=bool(task_input.get("vocal_separation")),
            vocal_separation_model=str(task_input.get("vocal_separation_model") or ""),
            vocal_separation_repo_dir=str(task_input.get("vocal_separation_repo_dir") or ""),
            vocal_separation_device=str(task_input.get("vocal_separation_device") or ""),
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
    language: str = Form("auto"),
    speaker_labels: str | None = Form(None),
    enable_timestamps: str | None = Form(None),
    vocal_separation: str | None = Form(None),
    vocal_separation_model: str | None = Form(None),
    silence_aware_split: str | None = Form(None),
    state=Depends(get_app_state),
):
    normalized_backend = (backend or "").strip().lower()
    if not normalized_backend:
        normalized_backend = str(getattr(state.orchestrator.config, "asr_backend", "whisper") or "whisper").strip().lower()
    if normalized_backend in {"qwen3_asr", "qwen3-asr"}:
        normalized_backend = "qwen3_crispasr"
    if normalized_backend not in {"whisper", "qwen3_crispasr"}:
        raise HTTPException(status_code=400, detail=f"Unsupported ASR backend: {backend}")
    effective_speaker_labels = _parse_bool_form(speaker_labels, default=False)
    effective_timestamps = _parse_bool_form(enable_timestamps, default=False)
    effective_silence_aware_split = _parse_bool_form(silence_aware_split, default=True)
    if normalized_backend == "qwen3_crispasr":
        effective_speaker_labels = False
        effective_timestamps = False
        effective_silence_aware_split = False

    suffix = Path(file.filename or "upload.wav").suffix or ".wav"
    tmp_path: Path | None = None
    separation_work_dir: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=suffix,
            dir=state.settings.output_dir,
        ) as tmp_file:
            tmp_file.write(await file.read())
            tmp_path = Path(tmp_file.name)

        vocal_options = _get_vocal_separation_options(state, enabled_form=vocal_separation, model_form=vocal_separation_model)
        separation_work_dir = Path(tempfile.mkdtemp(prefix="asr_vocal_", dir=state.settings.output_dir))
        separation = await prepare_vocal_audio_for_asr(
            tmp_path,
            enabled=bool(vocal_options["enabled"]),
            model=str(vocal_options["model"]),
            repo_dir=str(vocal_options["repo_dir"]),
            device=str(vocal_options["device"]),
            work_dir=separation_work_dir,
        )
        state.asr_vocal_separation_error = " | ".join(separation.warnings)
        await state.orchestrator.ensure_asr_ready(backend=normalized_backend)
        result = await _transcribe_with_optional_language(
            state.asr_engine,
            str(separation.audio_path),
            backend=normalized_backend,
            language=language,
            speaker_labels=effective_speaker_labels,
            enable_timestamps=effective_timestamps,
            silence_aware_split=effective_silence_aware_split,
        )
        warnings = list(result.get("warnings") if isinstance(result.get("warnings"), list) else [])
        warnings.extend(separation.warnings)
        result["warnings"] = warnings
        result["vocal_separation"] = separation.to_payload()
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
        if separation_work_dir is not None:
            shutil.rmtree(separation_work_dir, ignore_errors=True)


@router.post("/project-from-audio")
async def project_from_audio(
    file: UploadFile = File(...),
    project_name: str | None = Form(None),
    speaker_labels: str | None = Form(None),
    backend: str | None = Form(None),
    language: str = Form("auto"),
    enable_timestamps: str | None = Form(None),
    vocal_separation: str | None = Form(None),
    vocal_separation_model: str | None = Form(None),
    silence_aware_split: str | None = Form(None),
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
        chosen_backend = (backend or "").strip().lower() or str(getattr(state.orchestrator.config, "asr_backend", "whisper") or "whisper")
        if chosen_backend in {"qwen3_asr", "qwen3-asr"}:
            chosen_backend = "qwen3_crispasr"
        if chosen_backend not in {"whisper", "qwen3_crispasr"}:
            raise ValueError(f"Unsupported ASR backend: {backend}")
        vocal_options = _get_vocal_separation_options(state, enabled_form=vocal_separation, model_form=vocal_separation_model)
        task_input = {
            "asr_backend": chosen_backend,
            "language": language,
            "enable_timestamps": _parse_bool_form(enable_timestamps, default=False),
            "silence_aware_split": _parse_bool_form(silence_aware_split, default=True),
            "vocal_separation": bool(vocal_options["enabled"]),
            "vocal_separation_model": str(vocal_options["model"]),
            "vocal_separation_repo_dir": str(vocal_options["repo_dir"]),
            "vocal_separation_device": str(vocal_options["device"]),
            "tmp_path": str(tmp_path),
            "audio_name": file.filename,
            "project_name": project_name,
            "speaker_labels": _parse_bool_form(speaker_labels, default=False),
            "parse_mode": (parse_mode or "verified_five_step_pipeline").strip() or "verified_five_step_pipeline",
            "auto_parse": _parse_bool_form(auto_parse, default=True),
            "speaker_map": parse_speaker_map_form(speaker_map),
        }
        if chosen_backend == "qwen3_crispasr":
            task_input["speaker_labels"] = False
            task_input["enable_timestamps"] = False
            task_input["silence_aware_split"] = False
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
