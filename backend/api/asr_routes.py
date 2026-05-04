from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from backend.state import get_app_state

router = APIRouter()


def _parse_bool_form(val: str | None, default: bool = False) -> bool:
    if val is None:
        return default
    normalized = str(val).strip().lower()
    return normalized in {"1", "true", "yes", "on"}


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
