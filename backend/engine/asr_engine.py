from __future__ import annotations

import asyncio
from pathlib import Path
import re
import subprocess
from typing import Any

from backend.config import settings


class ASREngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.model_path = settings.default_asr_model_path
        self.device = settings.default_asr_device
        self.pyannote_model_id = settings.default_pyannote_model_id
        self.pyannote_auth_token = settings.default_pyannote_auth_token
        self.pyannote_device = settings.default_pyannote_device
        self.backend_name = "unloaded"
        self.last_error = ""
        self._backend: str | None = None
        self._model: Any | None = None
        self._diarization_pipeline: Any | None = None
        self._pyannote_loaded = False
        self._pyannote_error = ""

    async def load_model(
        self,
        model_path: str | None = None,
        device: str | None = None,
        backend: str = "whisper",
    ) -> None:
        target_backend = self._normalize_backend(backend)
        if target_backend != "whisper":
            raise ValueError(f"Unsupported ASR backend: {backend}")
        self.model_path = model_path or self.model_path or "base"
        self.device = device or self.device or "cpu"
        await self._load_whisper_like_model()

    async def unload_model(self) -> None:
        self._model = None
        self._backend = None
        self.is_loaded = False
        self.backend_name = "unloaded"
        self._diarization_pipeline = None
        self._pyannote_loaded = False
        self._pyannote_error = ""

    def get_pyannote_status(self) -> dict[str, Any]:
        return {
            "pyannote_model_id": self.pyannote_model_id,
            "pyannote_loaded": self._pyannote_loaded,
            "pyannote_error": self._pyannote_error,
            "pyannote_available": self._pyannote_loaded and self._diarization_pipeline is not None,
        }

    async def transcribe(
        self,
        audio_path: str,
        *,
        backend: str = "whisper",
        speaker_labels: bool = False,
    ) -> dict[str, Any]:
        target = Path(audio_path)
        if not target.exists():
            raise FileNotFoundError(f"Audio file not found: {target}")

        target_backend = self._normalize_backend(backend)
        if target_backend != "whisper":
            raise ValueError(f"Unsupported ASR backend: {backend}")

        raw_text, segments, backend_used = await self._transcribe_whisper_segments(target)
        if not raw_text:
            raise RuntimeError("ASR returned empty transcript")

        warnings: list[str] = []
        aligned_segments = [dict(segment or {}) for segment in (segments or [])]
        speaker_map: dict[str, str] = {}
        if speaker_labels:
            turns = await self._run_diarization(target)
            labeled_text, aligned_segments, speaker_map = self._label_segments_with_turns(segments, raw_text, turns, warnings)
            plain_text = self._strip_speaker_labels(labeled_text)
        else:
            labeled_text = raw_text
            plain_text = raw_text

        alignments: list[dict[str, Any]] = []
        for idx, seg in enumerate(aligned_segments, start=1):
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            start = seg.get("start")
            end = seg.get("end")
            start_ms = int(round(float(start) * 1000)) if isinstance(start, (int, float)) else 0
            end_ms = int(round(float(end) * 1000)) if isinstance(end, (int, float)) else start_ms
            if end_ms < start_ms:
                end_ms = start_ms
            alignments.append(
                {
                    "id": f"asr-seg-{idx}",
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "text": text,
                    "speaker": str(seg.get("speaker", "") or ""),
                }
            )

        return {
            "text": plain_text,
            "labeled_text": labeled_text,
            "backend": backend_used,
            "speaker_labels": bool(speaker_labels),
            "alignments": alignments,
            "speaker_map": speaker_map,
            "warnings": warnings,
            "model_files": {},
        }

    async def _load_whisper_like_model(self) -> None:
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

    async def _transcribe_whisper_segments(self, target: Path) -> tuple[str, list[dict[str, Any]], str]:
        if not self.is_loaded or self._model is None:
            await self.load_model(self.model_path, self.device, backend="whisper")

        segments: list[dict[str, Any]] = []
        if self._backend == "openai-whisper":
            whisper_device, _, _ = self._parse_device(self.device)
            result = self._model.transcribe(
                str(target),
                fp16=whisper_device.startswith("cuda"),
            )
            raw_text = str(result.get("text", "")).strip()
            for seg in result.get("segments", []) or []:
                text = str(seg.get("text", "")).strip()
                if not text:
                    continue
                segments.append(
                    {
                        "start": float(seg.get("start", 0.0) or 0.0),
                        "end": float(seg.get("end", 0.0) or 0.0),
                        "text": text,
                    }
                )
        elif self._backend == "faster-whisper":
            fw_segments, _ = self._model.transcribe(str(target), beam_size=5, vad_filter=True)
            raw_parts: list[str] = []
            for seg in fw_segments:
                text = str(getattr(seg, "text", "")).strip()
                if not text:
                    continue
                raw_parts.append(text)
                segments.append(
                    {
                        "start": float(getattr(seg, "start", 0.0) or 0.0),
                        "end": float(getattr(seg, "end", 0.0) or 0.0),
                        "text": text,
                    }
                )
            raw_text = "".join(raw_parts).strip()
        else:
            raise RuntimeError("ASR backend unavailable")

        if not segments and raw_text:
            segments = [{"start": None, "end": None, "text": raw_text}]
        return raw_text, segments, self._backend or "whisper"

    async def _run_diarization(self, target: Path) -> list[dict[str, Any]]:
        pipeline = await self._ensure_diarization_pipeline()
        audio_input = await asyncio.to_thread(self._load_audio_for_diarization, target)
        try:
            output = await asyncio.to_thread(pipeline, audio_input)
        except Exception as exc:
            self._pyannote_error = str(exc)
            raise RuntimeError(f"pyannote 说话人分离失败：{exc}") from exc

        annotation = getattr(output, "exclusive_speaker_diarization", None) or getattr(output, "speaker_diarization", None) or output
        turns: list[dict[str, Any]] = []
        if hasattr(annotation, "itertracks"):
            for turn, _, speaker in annotation.itertracks(yield_label=True):
                turns.append(
                    {
                        "start": float(getattr(turn, "start", 0.0) or 0.0),
                        "end": float(getattr(turn, "end", 0.0) or 0.0),
                        "speaker": str(speaker),
                    }
                )

        if not turns:
            raise RuntimeError("pyannote 未返回可用说话人分离结果。")
        return turns

    @staticmethod
    def _load_audio_for_diarization(target: Path) -> dict[str, Any]:
        # Decode audio with ffmpeg to avoid pyannote->torchcodec file decoding issues on Windows.
        sample_rate = 16000
        cmd = [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(target),
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "-",
        ]
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                check=True,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH。") from exc
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
            raise RuntimeError(f"ffmpeg 解码失败：{stderr or exc}") from exc

        payload = proc.stdout or b""
        if len(payload) < 4:
            raise RuntimeError("ffmpeg 解码后音频为空。")

        try:
            import numpy as np
            import torch
        except Exception as exc:
            raise RuntimeError(f"缺少依赖（numpy/torch）：{exc}") from exc

        if len(payload) % 4 != 0:
            payload = payload[: len(payload) - (len(payload) % 4)]
        if not payload:
            raise RuntimeError("ffmpeg 解码数据长度异常。")
        samples = np.frombuffer(payload, dtype=np.float32).copy()
        if samples.size == 0:
            raise RuntimeError("ffmpeg 解码后未得到有效采样。")

        waveform = torch.from_numpy(samples).unsqueeze(0)
        return {"waveform": waveform, "sample_rate": sample_rate}

    async def _ensure_diarization_pipeline(self):
        if self._diarization_pipeline is not None:
            return self._diarization_pipeline

        token = (self.pyannote_auth_token or "").strip()
        if not token:
            self._pyannote_loaded = False
            self._pyannote_error = "未配置 pyannote token"
            raise RuntimeError("未配置 pyannote token，请在系统配置填写 pyannote_auth_token。")

        try:
            from pyannote.audio import Pipeline
        except Exception as exc:
            self._pyannote_error = str(exc)
            raise RuntimeError(f"未安装 pyannote.audio：{exc}") from exc

        try:
            pipeline = Pipeline.from_pretrained(self.pyannote_model_id, token=token)
        except TypeError as exc:
            # Compatibility fallback for older/newer APIs:
            # only fallback when `token` keyword is truly unsupported.
            if "unexpected keyword argument 'token'" not in str(exc):
                self._pyannote_loaded = False
                self._pyannote_error = str(exc)
                raise RuntimeError(f"加载 pyannote 模型失败：{exc}") from exc
            try:
                pipeline = Pipeline.from_pretrained(self.pyannote_model_id, use_auth_token=token)
            except Exception as inner_exc:
                self._pyannote_loaded = False
                self._pyannote_error = str(inner_exc)
                raise RuntimeError(f"加载 pyannote 模型失败：{inner_exc}") from inner_exc
        except Exception as exc:
            self._pyannote_loaded = False
            self._pyannote_error = str(exc)
            raise RuntimeError(f"加载 pyannote 模型失败：{exc}") from exc

        device = (self.pyannote_device or self.device or "cpu").strip().lower()
        if device.startswith("cuda"):
            try:
                import torch

                if torch.cuda.is_available():
                    pipeline.to(torch.device(device if ":" in device else "cuda"))
            except Exception:
                pass

        self._diarization_pipeline = pipeline
        self._pyannote_loaded = True
        self._pyannote_error = ""
        return pipeline

    def _label_segments_with_turns(
        self,
        segments: list[dict[str, Any]],
        full_text: str,
        turns: list[dict[str, Any]],
        warnings: list[str],
    ) -> tuple[str, list[dict[str, Any]], dict[str, str]]:
        if not segments:
            fallback = self._ensure_single_speaker_label(full_text)
            return fallback, [], {"说话人1": "说话人1"} if fallback else {}

        speaker_map: dict[str, str] = {}
        next_speaker_idx = 1

        def normalized_name(raw: str) -> str:
            nonlocal next_speaker_idx
            if raw not in speaker_map:
                speaker_map[raw] = f"说话人{next_speaker_idx}"
                next_speaker_idx += 1
            return speaker_map[raw]

        labeled_lines: list[str] = []
        labeled_segments: list[dict[str, Any]] = []
        fallback_count = 0
        for seg in segments:
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            start = seg.get("start")
            end = seg.get("end")
            speaker_raw = self._pick_best_speaker(start, end, turns)
            if speaker_raw is None:
                fallback_count += 1
                speaker_raw = turns[0]["speaker"]
            speaker_name = normalized_name(str(speaker_raw))
            labeled_lines.append(f"{speaker_name}：{text}")
            labeled_segments.append(
                {
                    **seg,
                    "speaker": speaker_name,
                }
            )

        if fallback_count > 0:
            warnings.append(f"{fallback_count} 个片段未能精确匹配说话人，已回退到默认分配。")

        if not labeled_lines:
            fallback = self._ensure_single_speaker_label(full_text)
            return fallback, [], {"说话人1": "说话人1"} if fallback else {}
        return "\n".join(labeled_lines), labeled_segments, {value: value for value in speaker_map.values()}

    @staticmethod
    def _pick_best_speaker(start: float | None, end: float | None, turns: list[dict[str, Any]]) -> str | None:
        if start is None or end is None or end <= start:
            return None

        best_speaker: str | None = None
        best_overlap = 0.0
        for turn in turns:
            overlap = max(0.0, min(end, turn["end"]) - max(start, turn["start"]))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = turn["speaker"]
        if best_speaker is not None and best_overlap > 0:
            return best_speaker

        midpoint = (start + end) / 2.0
        best_dist = float("inf")
        nearest: str | None = None
        for turn in turns:
            center = (turn["start"] + turn["end"]) / 2.0
            dist = abs(center - midpoint)
            if dist < best_dist:
                best_dist = dist
                nearest = turn["speaker"]
        return nearest

    @staticmethod
    def _normalize_backend(backend: str | None) -> str:
        val = (backend or "whisper").strip().lower()
        if val in {"", "whisper"}:
            return "whisper"
        return val

    @staticmethod
    def _strip_speaker_labels(text: str) -> str:
        if not text:
            return ""
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        plain_parts: list[str] = []
        for line in lines:
            m = re.match(r"^\s*说话人\s*\d+\s*：\s*(.+)$", line)
            if m:
                plain_parts.append(m.group(1).strip())
            else:
                plain_parts.append(line)
        return "\n".join(part for part in plain_parts if part)

    @staticmethod
    def _ensure_single_speaker_label(text: str) -> str:
        content = (text or "").strip()
        if not content:
            return ""
        if re.search(r"(?m)^\s*说话人\s*\d+\s*：", content):
            return content
        return f"说话人1：{content}"

    def _parse_device(self, device: str) -> tuple[str, str, int]:
        val = (device or "").strip().lower()
        if val.startswith("cuda"):
            match = re.match(r"^cuda(?::(\d+))?$", val)
            if match:
                idx = int(match.group(1) or "0")
                return f"cuda:{idx}", "cuda", idx
            return "cuda:0", "cuda", 0
        return "cpu", "cpu", 0
