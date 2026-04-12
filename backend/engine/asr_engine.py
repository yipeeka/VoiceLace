from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from backend.config import settings


class ASREngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.model_path = settings.default_asr_model_path
        self.device = settings.default_asr_device
        self.backend_name = "unloaded"
        self.last_error = ""
        self._backend: str | None = None
        self._model: Any | None = None

    async def load_model(self, model_path: str | None = None, device: str | None = None) -> None:
        self.model_path = model_path or self.model_path or "base"
        self.device = device or self.device or "cpu"
        errors: list[str] = []

        whisper_device, faster_device, faster_device_index = self._parse_device(self.device)
        try:
            import whisper

            self._model = whisper.load_model(self.model_path, device=whisper_device)
            self._backend = "openai-whisper"
            self.backend_name = self._backend
            self.last_error = ""
            self.is_loaded = True
            return
        except Exception as exc:
            errors.append(f"openai-whisper: {exc}")

        try:
            from faster_whisper import WhisperModel

            compute_type = "float16" if faster_device == "cuda" else "int8"
            self._model = WhisperModel(
                self.model_path,
                device=faster_device,
                device_index=faster_device_index,
                compute_type=compute_type,
            )
            self._backend = "faster-whisper"
            self.backend_name = self._backend
            self.last_error = ""
            self.is_loaded = True
            return
        except Exception as exc:
            errors.append(f"faster-whisper: {exc}")

        self._model = None
        self._backend = None
        self.backend_name = "unavailable"
        self.is_loaded = False
        self.last_error = " | ".join(errors) if errors else "ASR backend unavailable"
        raise RuntimeError(self.last_error)

    async def unload_model(self) -> None:
        self._model = None
        self._backend = None
        self.is_loaded = False
        self.backend_name = "unloaded"

    async def transcribe(self, audio_path: str) -> str:
        target = Path(audio_path)
        if not target.exists():
            raise FileNotFoundError(f"Audio file not found: {target}")

        if not self.is_loaded or self._model is None:
            await self.load_model(self.model_path, self.device)

        if self._backend == "openai-whisper":
            whisper_device, _, _ = self._parse_device(self.device)
            result = self._model.transcribe(
                str(target),
                fp16=whisper_device.startswith("cuda"),
            )
            text = str(result.get("text", "")).strip()
            if not text:
                raise RuntimeError("ASR returned empty transcript")
            return text

        if self._backend == "faster-whisper":
            segments, _ = self._model.transcribe(str(target), beam_size=5, vad_filter=True)
            text = "".join(getattr(segment, "text", "") for segment in segments).strip()
            if not text:
                raise RuntimeError("ASR returned empty transcript")
            return text

        raise RuntimeError("ASR backend unavailable")

    def _parse_device(self, device: str) -> tuple[str, str, int]:
        val = (device or "").strip().lower()
        if val.startswith("cuda"):
            match = re.match(r"^cuda(?::(\d+))?$", val)
            if match:
                idx = int(match.group(1) or "0")
                return f"cuda:{idx}", "cuda", idx
            return "cuda:0", "cuda", 0
        return "cpu", "cpu", 0
