from __future__ import annotations

import wave
import mimetypes
from pathlib import Path
import time
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
from backend.services.voice_preset_service import analyze_reference_audio, normalize_tags, recommend_presets_for_project
from backend.state import get_app_state

router = APIRouter()
_PREVIEW_TTL_SECONDS = 10 * 60


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
    return recommend_presets_for_project(project, presets, backend=payload.backend, limit=payload.limit)


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
        result = await state.asr_engine.transcribe(str(path), backend="whisper", speaker_labels=False)
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
