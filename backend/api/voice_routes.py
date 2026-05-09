from __future__ import annotations

import json
import wave
import mimetypes
from pathlib import Path
import time
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from backend.models import (
    ReorderVoicePresetsRequest,
    TranscribeRequest,
    VoicePreset,
    VoicePreviewRequest,
    VoiceQualityCheckRequest,
    VoiceRecommendRequest,
)
from backend.services.project_core_service import get_project
from backend.services.voice_preset_service import (
    analyze_reference_audio,
    build_content_recommendation_payload,
    content_recommendation_prompt,
    normalize_tags,
    parse_content_recommendations,
    recommend_presets_for_project,
)
from backend.state import get_app_state

router = APIRouter()
_PREVIEW_TTL_SECONDS = 10 * 60
_ALLOWED_RECOMMEND_SOURCES = {"secondary_local", "primary_local", "openai", "gemini", "rule"}


def _cleanup_expired_previews(output_dir: Path) -> None:
    now = time.time()
    for file in output_dir.glob("preview_*.wav"):
        try:
            if now - file.stat().st_mtime > _PREVIEW_TTL_SECONDS:
                file.unlink(missing_ok=True)
        except Exception:
            continue


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _normalize_preset(preset: VoicePreset) -> VoicePreset:
    return preset.model_copy(
        update={
            "name": (preset.name or "").strip(),
            "description": (preset.description or "").strip(),
            "suitable_role_description": (preset.suitable_role_description or "").strip(),
            "tags": normalize_tags(preset.tags),
        }
    )


def _build_recommendation_engine_config(state, source: str) -> dict[str, Any]:
    cfg = state.orchestrator.config
    source_name = (source or "secondary_local").strip().lower()
    if source_name == "secondary_local":
        return {
            "backend": "llama_cpp",
            "model_path": cfg.secondary_llm_model_path,
            "clip_model_path": cfg.secondary_llm_clip_model_path,
            "n_ctx": int(cfg.secondary_llm_n_ctx),
            "n_gpu_layers": int(cfg.secondary_llm_n_gpu_layers),
            "n_threads": int(cfg.secondary_llm_threads),
            "enable_think_mode": bool(cfg.secondary_enable_llama_cpp_think_mode),
            "options": {
                "temperature": float(cfg.secondary_llm_temperature),
                "top_p": float(cfg.secondary_llm_top_p),
                "top_k": int(cfg.secondary_llm_top_k),
                "min_p": float(cfg.secondary_llm_min_p),
                "presence_penalty": float(cfg.secondary_llm_presence_penalty),
                "repeat_penalty": float(cfg.secondary_llm_repeat_penalty),
                "max_tokens": int(cfg.secondary_llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    if source_name == "primary_local":
        return {
            "backend": "llama_cpp",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": bool(cfg.enable_llama_cpp_think_mode),
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    if source_name == "openai":
        return {
            "backend": "openai",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    if source_name == "gemini":
        return {
            "backend": "gemini",
            "model_path": cfg.llm_model_path,
            "clip_model_path": cfg.llm_clip_model_path,
            "n_ctx": int(cfg.llm_n_ctx),
            "n_gpu_layers": int(cfg.llm_n_gpu_layers),
            "n_threads": int(cfg.llm_threads),
            "enable_think_mode": False,
            "options": {
                "temperature": float(cfg.llm_temperature),
                "top_p": float(cfg.llm_top_p),
                "top_k": int(cfg.llm_top_k),
                "min_p": float(cfg.llm_min_p),
                "presence_penalty": float(cfg.llm_presence_penalty),
                "repeat_penalty": float(cfg.llm_repeat_penalty),
                "max_tokens": int(cfg.llm_max_tokens),
                "api_model": cfg.llm_api_model,
            },
        }
    raise HTTPException(status_code=400, detail=f"Unsupported recommendation source: {source_name}")


async def _ensure_recommendation_engine_ready(state, source: str) -> tuple[Any, dict[str, Any]]:
    config = _build_recommendation_engine_config(state, source)
    engine = state.translation_llm_engine
    current_source = (state.translation_engine_source or "").strip().lower()
    if engine.is_loaded and current_source != source:
        await engine.unload_model()
        state.translation_engine_source = ""
        state.translation_engine_error = ""
    if not engine.is_loaded:
        engine.enable_llama_cpp_think_mode = bool(config["enable_think_mode"])
        await engine.load_model(
            model_path=config["model_path"],
            clip_model_path=config["clip_model_path"],
            n_ctx=config["n_ctx"],
            n_gpu_layers=config["n_gpu_layers"],
            backend=config["backend"],
            n_threads=config["n_threads"],
        )
        state.translation_engine_source = source
        state.translation_engine_error = ""
    return engine, config["options"]


@router.get("/presets")
async def list_presets(state=Depends(get_app_state)):
    return state.voice_manager.list_presets()


@router.post("/presets")
async def create_preset(payload: VoicePreset, state=Depends(get_app_state)):
    presets = state.voice_manager.list_presets()
    preset = _normalize_preset(payload.model_copy(update={"id": payload.id or str(uuid4())}))
    presets.append(preset)
    state.voice_manager.save_presets(presets)
    return preset


@router.put("/presets/{preset_id}")
async def update_preset(preset_id: str, payload: VoicePreset, state=Depends(get_app_state)):
    updated = _normalize_preset(payload.model_copy(update={"id": preset_id}))
    presets = [
        updated if preset.id == preset_id else preset
        for preset in state.voice_manager.list_presets()
    ]
    state.voice_manager.save_presets(presets)
    return updated


@router.delete("/presets/{preset_id}")
async def delete_preset(preset_id: str, state=Depends(get_app_state)):
    presets = [preset for preset in state.voice_manager.list_presets() if preset.id != preset_id]
    state.voice_manager.save_presets(presets)
    return {"status": "deleted"}


@router.post("/presets/reorder")
async def reorder_presets(payload: ReorderVoicePresetsRequest, state=Depends(get_app_state)):
    presets = state.voice_manager.list_presets()
    preset_by_id = {preset.id: preset for preset in presets}
    ordered: list[VoicePreset] = []
    seen: set[str] = set()

    for preset_id in payload.preset_ids:
        preset = preset_by_id.get(preset_id)
        if preset and preset_id not in seen:
            ordered.append(preset)
            seen.add(preset_id)

    for preset in presets:
        if preset.id not in seen:
            ordered.append(preset)

    state.voice_manager.save_presets(ordered)
    return ordered


@router.post("/upload-ref")
async def upload_reference_audio(file: UploadFile = File(...), state=Depends(get_app_state)):
    target = state.settings.voices_dir / file.filename
    target.write_bytes(await file.read())
    duration = 0
    try:
        from pydub import AudioSegment

        audio = AudioSegment.from_file(str(target))
        duration = round(float(audio.duration_seconds), 3)
    except Exception:
        try:
            with wave.open(str(target), "rb") as wav_file:
                frame_rate = wav_file.getframerate()
                frame_count = wav_file.getnframes()
                duration = round(frame_count / frame_rate, 3) if frame_rate else 0
        except Exception:
            duration = 0
    quality_report = analyze_reference_audio(target)
    return {"file_path": str(target), "duration": duration, "quality_report": quality_report.model_dump(mode="json")}


@router.post("/presets/{preset_id}/quality-check")
async def quality_check_preset(
    preset_id: str,
    payload: VoiceQualityCheckRequest | None = Body(default=None),
    state=Depends(get_app_state),
):
    presets = state.voice_manager.list_presets()
    target_index = next((index for index, preset in enumerate(presets) if preset.id == preset_id), -1)
    if target_index < 0:
        raise HTTPException(status_code=404, detail="Voice preset not found")

    preset = presets[target_index]
    backends = [payload.backend] if payload and payload.backend else ["omnivoice", "voxcpm2"]
    quality_reports = dict(preset.quality_reports or {})
    checked: dict[str, dict] = {}

    for backend in backends:
        backend_name = (backend or "").strip().lower()
        if backend_name not in {"omnivoice", "voxcpm2"}:
            continue
        if backend_name == "omnivoice":
            ref_audio_path = (preset.resolved_omnivoice_profile().ref_audio_path or "").strip()
        else:
            ref_audio_path = (preset.resolved_voxcpm2_profile().ref_audio_path or "").strip()
        if not ref_audio_path:
            if payload and payload.backend == backend_name:
                raise HTTPException(status_code=400, detail=f"{backend_name} 尚未配置参考音频")
            continue
        report = analyze_reference_audio(Path(ref_audio_path).expanduser())
        quality_reports[backend_name] = report
        checked[backend_name] = report.model_dump(mode="json")

    if not checked:
        raise HTTPException(status_code=400, detail="没有可检测的参考音频")

    updated = _normalize_preset(preset.model_copy(update={"quality_reports": quality_reports}))
    presets[target_index] = updated
    state.voice_manager.save_presets(presets)
    return {"preset_id": preset_id, "checked": checked, "quality_reports": updated.quality_reports}


@router.post("/recommend")
async def recommend_presets(payload: VoiceRecommendRequest, state=Depends(get_app_state)):
    project = get_project(payload.project_id, projects_dir=state.settings.projects_dir)
    presets = state.voice_manager.list_presets()
    source = (payload.source or "secondary_local").strip().lower()
    if source not in _ALLOWED_RECOMMEND_SOURCES:
        raise HTTPException(status_code=400, detail=f"Unsupported recommendation source: {source}")

    rule_result = recommend_presets_for_project(project, presets, backend=payload.backend, limit=payload.limit)
    if source == "rule":
        return {
            **rule_result,
            "source_requested": source,
            "source_used": "rule",
            "warnings": [],
        }

    llm_payload = build_content_recommendation_payload(project, presets, backend=payload.backend, limit=payload.limit)
    prompt = content_recommendation_prompt(payload.limit)
    warnings: list[str] = []

    try:
        engine, llm_options = await _ensure_recommendation_engine_ready(state, source)
        llm_text = await engine.generate_text(
            text=json.dumps(llm_payload, ensure_ascii=False),
            system_prompt=prompt,
            llm_options=llm_options,
        )
        normalized_rows, parse_warnings = parse_content_recommendations(
            llm_text,
            characters=llm_payload["characters"],
            preset_ids={preset.id for preset in presets},
            limit=payload.limit,
        )
        warnings.extend(parse_warnings)
        if normalized_rows:
            preset_map = {preset.id: preset for preset in presets}
            top_by_character = {row.get("character", ""): row.get("top", []) for row in normalized_rows}
            merged_rows: list[dict] = []
            for row in rule_result.get("recommendations", []):
                character_name = row.get("character", "")
                llm_top = top_by_character.get(character_name, [])
                if llm_top:
                    enriched_top = []
                    for item in llm_top:
                        preset_id = item.get("preset_id", "")
                        preset = preset_map.get(preset_id)
                        if not preset:
                            continue
                        quality = preset.quality_reports.get(rule_result.get("backend", "omnivoice"))
                        quality_status = quality.status if quality else "unknown"
                        enriched_top.append(
                            {
                                "preset_id": preset_id,
                                "name": preset.name,
                                "score": int(item.get("score", 0)),
                                "favorite": bool(preset.favorite),
                                "tags": preset.tags,
                                "quality_status": quality_status,
                                "reasons": item.get("reasons", ["内容匹配"]),
                            }
                        )
                    if enriched_top:
                        merged_rows.append(
                            {
                                **row,
                                "top": enriched_top[: payload.limit],
                            }
                        )
                        continue
                merged_rows.append(row)
            if merged_rows:
                return {
                    **rule_result,
                    "recommendations": merged_rows,
                    "source_requested": source,
                    "source_used": source,
                    "warnings": warnings,
                }
    except Exception as exc:
        warnings.append(f"LLM 推荐失败，已回退规则推荐: {exc}")

    return {
        **rule_result,
        "source_requested": source,
        "source_used": "rule_fallback",
        "warnings": warnings or ["LLM 推荐不可用，已回退规则推荐"],
    }


@router.get("/reference-audio")
async def get_reference_audio(path: str = Query(...), state=Depends(get_app_state)):
    audio_path = Path(path).expanduser().resolve()
    voices_root = state.settings.voices_dir.resolve()
    if not _is_within(audio_path, voices_root):
        raise HTTPException(status_code=403, detail="Reference audio path is outside voices directory")
    if not audio_path.exists() or not audio_path.is_file():
        raise HTTPException(status_code=404, detail=f"Reference audio not found: {audio_path}")
    media_type = mimetypes.guess_type(audio_path.name)[0] or "audio/wav"
    return FileResponse(audio_path, media_type=media_type, filename=audio_path.name)


@router.post("/transcribe")
async def transcribe_audio(payload: TranscribeRequest, state=Depends(get_app_state)):
    path = Path(payload.audio_path).expanduser()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Audio file not found: {path}")
    try:
        backend = str(getattr(state.orchestrator.config, "asr_backend", "whisper") or "whisper")
        await state.orchestrator.ensure_asr_ready(backend=backend)
        result = await state.asr_engine.transcribe(str(path), backend=backend, speaker_labels=False)
        return {"text": result.get("text", ""), "backend": result.get("backend", state.asr_engine.backend_name)}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        message = str(exc)
        state.asr_engine.last_error = message
        raise HTTPException(status_code=503, detail=f"ASR unavailable: {message}") from exc


@router.post("/preview")
async def preview_voice(payload: VoicePreviewRequest, state=Depends(get_app_state)):
    target_backend = (payload.tts_backend or "omnivoice").strip().lower()
    if target_backend not in {"omnivoice", "voxcpm2", "mock"}:
        target_backend = "omnivoice"
    await state.orchestrator.ensure_tts_ready(tts_backend=target_backend)
    _cleanup_expired_previews(state.settings.output_dir)
    output = state.settings.output_dir / f"preview_{uuid4().hex[:8]}.wav"
    await state.tts_engine.synthesize_to_file(payload.text, output, payload.preset)
    return FileResponse(output, media_type="audio/wav", filename=output.name)
