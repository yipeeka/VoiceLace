from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Literal

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from backend.api.asr_routes import _transcribe_with_optional_language
from backend.api.llm_routes import cancel_parse_task, enqueue_parse_task
from backend.api.music_routes import cancel_music_task, generate_music
from backend.api.tts_routes import cancel_synthesis_task, start_postprocess, synthesize
from backend.models import LlmParseRequest, MusicGenerateRequest, PostprocessRequest, SynthesizeRequest
from backend.services import (
    build_project_parse_qc_report,
    build_tts_status_response,
    list_project_summaries,
    resolve_export_audio_path,
    resolve_subtitle_path,
)
from backend.persistence import load_project


StateGetter = Callable[[], Any]


def _jsonable(payload: Any) -> Any:
    return jsonable_encoder(payload)


def _tool_error(exc: Exception) -> RuntimeError:
    if isinstance(exc, HTTPException):
        return RuntimeError(str(exc.detail or f"HTTP {exc.status_code}"))
    return RuntimeError(str(exc))


def _safe_file_path(state: Any, raw_path: str) -> Path:
    candidate = Path(raw_path).expanduser()
    if not candidate.is_absolute():
        candidate = state.settings.base_dir.parent / candidate
    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise RuntimeError(f"File not found: {raw_path}") from exc

    project_root = state.settings.base_dir.parent.resolve()
    allowed_roots = [
        state.settings.data_dir.resolve(),
        state.settings.output_dir.resolve(),
        state.settings.voices_dir.resolve(),
        (project_root / "samples").resolve(),
    ]
    if not any(root == resolved or root in resolved.parents for root in allowed_roots):
        raise RuntimeError("File path is outside MCP allowed roots")
    if not resolved.is_file():
        raise RuntimeError("File path must point to a file")
    return resolved


def _public_task(task: dict | None) -> dict:
    if not task:
        return {}
    payload = {
        "task_id": task.get("task_id", ""),
        "kind": task.get("kind") or task.get("task_kind") or "",
        "status": task.get("status", ""),
        "project_id": task.get("project_id"),
        "stage": task.get("stage", ""),
        "stage_label": task.get("stage_label", ""),
        "stage_progress": task.get("stage_progress", 0),
        "queue_position": task.get("queue_position"),
        "error": task.get("error", ""),
        "result": task.get("result"),
        "events": list(task.get("events") or [])[-20:],
    }
    return {key: value for key, value in payload.items() if value not in (None, "")}


def build_mcp_server(state_getter: StateGetter):
    try:
        from mcp.server.fastmcp import FastMCP
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("MCP SDK is not installed. Install the `mcp` Python package.") from exc

    mcp = FastMCP(
        "VoiceLace MCP",
        instructions=(
            "Local VoiceLace tools for inspecting projects and starting ASR, LLM parsing, "
            "TTS synthesis, music generation, postprocess, export lookup, task polling, and cancellation."
        ),
        streamable_http_path="/",
        stateless_http=True,
    )

    @mcp.tool()
    async def get_system_status() -> dict:
        """Return model/runtime status and current VoiceLace configuration."""
        state = state_getter()
        return _jsonable(await state.orchestrator.get_status())

    @mcp.tool()
    async def list_projects(limit: int = 50) -> dict:
        """List recent VoiceLace projects."""
        state = state_getter()
        projects = [item.model_dump(mode="json") for item in list_project_summaries(projects_dir=state.settings.projects_dir)]
        projects.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return {"items": projects[: max(1, min(int(limit or 50), 200))], "total": len(projects)}

    @mcp.tool()
    async def get_project(project_id: str, include_script: bool = True, max_segments: int = 120) -> dict:
        """Read a project, optionally including a capped script segment list."""
        state = state_getter()
        project = load_project(state.settings.projects_dir, project_id)
        payload = project.model_dump(mode="json")
        if not include_script:
            payload.pop("script", None)
            return payload
        segments = list(payload.get("script", {}).get("segments") or [])
        cap = max(0, min(int(max_segments or 120), 500))
        payload["script"]["segments"] = segments[:cap]
        payload["script"]["segment_count"] = len(segments)
        payload["script"]["segments_truncated"] = len(segments) > cap
        return payload

    @mcp.tool()
    async def get_project_parse_qc(project_id: str) -> dict:
        """Return parse quality-control metrics and issues for a project."""
        state = state_getter()
        return _jsonable(build_project_parse_qc_report(project_id, projects_dir=state.settings.projects_dir))

    @mcp.tool()
    async def start_parse_task(
        text: str,
        parse_mode: Literal[
            "legacy_single_pass",
            "two_step_pipeline",
            "read_aloud_single_voice",
            "verified_two_step_pipeline",
            "verified_five_step_pipeline",
        ] = "verified_five_step_pipeline",
        project_id: str | None = None,
        system_prompt: str | None = None,
    ) -> dict:
        """Start an asynchronous LLM script-parse task."""
        state = state_getter()
        try:
            task_id = enqueue_parse_task(
                state,
                LlmParseRequest(text=text, parse_mode=parse_mode, project_id=project_id, system_prompt=system_prompt),
            )
            return {"task_id": task_id, "kind": "parse", "status": "queued"}
        except Exception as exc:
            raise _tool_error(exc) from exc

    @mcp.tool()
    async def transcribe_audio_path(
        audio_path: str,
        backend: str = "whisper",
        language: str = "auto",
        speaker_labels: bool = False,
        enable_timestamps: bool = False,
    ) -> dict:
        """Transcribe an existing local audio file from an allowed project/sample directory."""
        state = state_getter()
        path = _safe_file_path(state, audio_path)
        normalized_backend = (backend or state.orchestrator.config.asr_backend or "whisper").strip().lower()
        if normalized_backend in {"qwen3_asr", "qwen3-asr"}:
            normalized_backend = "qwen3_crispasr"
        if normalized_backend not in {"whisper", "qwen3_crispasr"}:
            raise RuntimeError(f"Unsupported ASR backend: {backend}")
        if normalized_backend == "qwen3_crispasr":
            speaker_labels = False
            enable_timestamps = False
        try:
            await state.orchestrator.ensure_asr_ready(backend=normalized_backend)
            return _jsonable(
                await _transcribe_with_optional_language(
                    state.asr_engine,
                    str(path),
                    backend=normalized_backend,
                    language=language,
                    speaker_labels=speaker_labels,
                    enable_timestamps=enable_timestamps,
                )
            )
        except Exception as exc:
            state.asr_engine.last_error = str(exc)
            raise _tool_error(exc) from exc

    @mcp.tool()
    async def start_synthesis_task(
        project_id: str,
        segment_ids: list[str] | None = None,
        rebuild_full: bool = True,
    ) -> dict:
        """Start a queued TTS synthesis task for a whole project or selected segments."""
        state = state_getter()
        try:
            payload = SynthesizeRequest(project_id=project_id, segment_ids=segment_ids, rebuild_full=rebuild_full)
            return _jsonable(await synthesize(payload, state))
        except Exception as exc:
            raise _tool_error(exc) from exc

    @mcp.tool()
    async def start_postprocess_task(project_id: str) -> dict:
        """Start a queued postprocess task for a project."""
        state = state_getter()
        try:
            return _jsonable(await start_postprocess(project_id, PostprocessRequest(project_id=project_id), state))
        except Exception as exc:
            raise _tool_error(exc) from exc

    @mcp.tool()
    async def start_music_task(
        prompt: str,
        project_id: str | None = None,
        lyrics: str = "",
        audio_duration: float = 10.0,
        vocal_language: str = "en",
        seed: int | None = None,
        task_type: Literal["text2music", "cover", "repaint", "lego", "extract", "complete"] = "text2music",
    ) -> dict:
        """Start a music generation task."""
        state = state_getter()
        try:
            payload = MusicGenerateRequest(
                task_type=task_type,
                prompt=prompt,
                project_id=project_id,
                lyrics=lyrics,
                audio_duration=audio_duration,
                vocal_language=vocal_language,
                seed=seed,
            )
            return _jsonable(await generate_music(payload, state))
        except Exception as exc:
            raise _tool_error(exc) from exc

    @mcp.tool()
    async def get_task_status(kind: Literal["parse", "synthesis", "postprocess", "music", "asr"], task_id: str) -> dict:
        """Poll a task by kind and task id."""
        state = state_getter()
        if kind == "parse":
            task = state.llm_tasks.get(task_id)
        elif kind in {"synthesis", "postprocess"}:
            task = state.tts_tasks.get(task_id)
            if task is not None:
                _, status_payload = build_tts_status_response(task_id, task)
                return _jsonable(status_payload)
        elif kind == "music":
            task = state.music_tasks.get(task_id)
        else:
            task = state.asr_tasks.get(task_id)
        if task is None:
            raise RuntimeError(f"{kind} task not found")
        return _jsonable(_public_task(task))

    @mcp.tool()
    async def cancel_task(kind: Literal["parse", "synthesis", "postprocess", "music"], task_id: str) -> dict:
        """Cancel a running or queued parse, synthesis, postprocess, or music task."""
        state = state_getter()
        try:
            if kind == "parse":
                return _jsonable(await cancel_parse_task(task_id, state))
            if kind in {"synthesis", "postprocess"}:
                return _jsonable(await cancel_synthesis_task(task_id, state))
            return _jsonable(await cancel_music_task(task_id, state))
        except Exception as exc:
            raise _tool_error(exc) from exc

    @mcp.tool()
    async def get_export_paths(project_id: str) -> dict:
        """Return existing raw/processed audio and subtitle export paths for a project."""
        state = state_getter()
        project = load_project(state.settings.projects_dir, project_id)
        exports: list[dict[str, str]] = []
        for variant in ("raw", "processed"):
            for fmt in ("wav", "mp3"):
                try:
                    path, _ = resolve_export_audio_path(
                        output_dir=state.settings.output_dir,
                        project=project,
                        req_format=fmt,
                        variant=variant,
                    )
                except FileNotFoundError:
                    continue
                if path.exists():
                    exports.append(
                        {
                            "kind": "audio",
                            "variant": variant,
                            "format": fmt,
                            "path": str(path),
                            "url": f"/api/v1/tts/export?project_id={project_id}&format={fmt}&variant={variant}",
                        }
                    )
        for fmt in ("srt", "lrc"):
            path = resolve_subtitle_path(
                output_dir=state.settings.output_dir,
                project_id=project_id,
                project=project,
                fmt=fmt,
            )
            if path.exists():
                exports.append(
                    {
                        "kind": "subtitle",
                        "format": fmt,
                        "path": str(path),
                        "url": f"/api/v1/tts/subtitle?project_id={project_id}&format={fmt}",
                    }
                )
        return {"project_id": project.id, "project_name": project.name, "exports": exports}

    return mcp
