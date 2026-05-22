from __future__ import annotations

import asyncio
import gc
import json
import math
from pathlib import Path
import re
import subprocess
import tempfile
from typing import Any

from backend.config import settings


WHISPER_BACKEND = "whisper"
QWEN3_CRISPASR_BACKEND = "qwen3_crispasr"
QWEN3_BACKEND_ALIASES = {QWEN3_CRISPASR_BACKEND, "qwen3_asr", "qwen3-asr"}
TIMELINE_WORD_PADDING_SEC = 0.08
TIMELINE_TEXT_PADDING_SEC = 0.65
TIMELINE_LONG_SEGMENT_MIN_DIFF_SEC = 2.0
TIMELINE_LONG_SEGMENT_RATIO = 2.2
TIMELINE_MAX_CORRECTED_TEXT_RATIO = 1.35
TIMELINE_WORD_SPLIT_GAP_SEC = 0.7
TIMELINE_WORD_SPLIT_PUNCTUATION_GAP_SEC = 0.7
TIMELINE_MIN_SPLIT_SEGMENT_SEC = 0.7
QWEN3_SHORT_TIMING_EDGE_PAD_SEC = 0.2
QWEN3_JSON_REPAIR_SHORT_PUNCT_SEC = 0.3
QWEN3_JSON_REPAIR_CLOSING_QUOTE_PREFIX_RE = re.compile(r"^([”’」』》）)\]]+)(.+)$")
SILENCE_AWARE_MIN_SILENCE_MS = 1000
SILENCE_AWARE_SEEK_STEP_MS = 20
SILENCE_AWARE_THRESHOLD_DBFS = -45


class ASREngine:
    def __init__(self) -> None:
        self.is_loaded = False
        self.default_backend = settings.default_asr_backend
        self.model_path = settings.default_asr_model_path
        self.device = settings.default_asr_device
        self.crispasr_exe = settings.default_qwen3_asr_crispasr_exe
        self.qwen3_model_path = settings.default_qwen3_asr_model_path
        self.qwen3_forced_aligner_model_path = settings.default_qwen3_asr_forced_aligner_model_path
        self.qwen3_threads = int(settings.default_qwen3_asr_threads)
        self.qwen3_language = settings.default_qwen3_asr_language
        self.qwen3_enable_timestamps = bool(settings.default_qwen3_asr_enable_timestamps)
        self.qwen3_preview_max_line_length = int(settings.default_qwen3_asr_preview_max_line_length)
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
        self._last_crispasr_warnings: list[str] = []
        self._last_crispasr_timeline_repairs: list[dict[str, Any]] = []

    def needs_reload(self, *, model_path: str | None = None, device: str | None = None, backend: str = "whisper") -> bool:
        if not self.is_loaded:
            return True
        target_backend = self._normalize_backend(backend)
        if (self._backend or "") != target_backend:
            return True
        target_model_path = model_path or self.model_path
        target_device = device or self.device
        if target_backend == "whisper":
            return (target_model_path or "") != (self.model_path or "") or (target_device or "") != (self.device or "")
        return False

    async def load_model(
        self,
        model_path: str | None = None,
        device: str | None = None,
        backend: str = "whisper",
    ) -> None:
        target_backend = self._normalize_backend(backend)
        self.default_backend = target_backend
        self.model_path = model_path or self.model_path or "base"
        self.device = device or self.device or "cpu"
        if target_backend == "whisper":
            await self._load_whisper_like_model()
            return
        if target_backend == "qwen3_crispasr":
            self._validate_crispasr_config()
            self._model = {"backend": "qwen3_crispasr"}
            self._backend = "qwen3_crispasr"
            self.backend_name = "qwen3_crispasr"
            self.last_error = ""
            self.is_loaded = True
            return
        raise ValueError(f"Unsupported ASR backend: {backend}")

    async def unload_model(self) -> None:
        self._model = None
        self._backend = None
        self.is_loaded = False
        self.backend_name = "unloaded"
        self._diarization_pipeline = None
        self._pyannote_loaded = False
        self._pyannote_error = ""
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass

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
        language: str | None = None,
        speaker_labels: bool = False,
        enable_timestamps: bool | None = None,
        silence_aware_split: bool = True,
        qwen3_preview_max_line_length: int | None = None,
    ) -> dict[str, Any]:
        target = Path(audio_path)
        if not target.exists():
            raise FileNotFoundError(f"Audio file not found: {target}")

        (
            raw_text,
            segments,
            backend_used,
            target_backend,
            warnings,
            qwen3_max_line_length,
        ) = await self._transcribe_backend_segments(
            target,
            backend=backend,
            language=language,
            speaker_labels=speaker_labels,
            enable_timestamps=enable_timestamps,
            qwen3_preview_max_line_length=qwen3_preview_max_line_length,
        )
        if not raw_text:
            raise RuntimeError("ASR returned empty transcript")

        timeline_repairs: list[dict[str, Any]] = []
        if self._is_qwen3_backend(target_backend):
            timeline_repairs.extend(getattr(self, "_last_crispasr_timeline_repairs", []) or [])
        aligned_segments = self._recover_inline_timestamp_segments(segments)
        if aligned_segments:
            if self._is_qwen3_backend(target_backend):
                qwen3_result = self._postprocess_qwen3_timeline_segments(
                    aligned_segments,
                    max_line_length=qwen3_max_line_length,
                )
                aligned_segments = qwen3_result["segments"]
                warnings.extend(qwen3_result["warnings"])
                timeline_repairs.extend(qwen3_result["repairs"])
            raw_text = self._segments_to_text(aligned_segments) or raw_text
        silence_ranges: list[dict[str, float]] = []
        if silence_aware_split and target_backend == WHISPER_BACKEND:
            try:
                silence_ranges = self._detect_silence_ranges(target)
            except Exception as exc:
                warnings.append(f"长静音检测失败，已回退词间切分：{exc}")
        skip_word_gap_split = self._is_qwen3_backend(target_backend) and any(
            bool(seg.get("qwen3_json_srt_repaired")) for seg in aligned_segments
        )
        if skip_word_gap_split:
            split_count = 0
            silence_split_count = 0
        else:
            aligned_segments, split_count, silence_split_count = self._split_segments_by_word_gaps(
                aligned_segments,
                silence_ranges=silence_ranges if silence_aware_split else None,
            )
        if split_count:
            warnings.append(f"已按词间静音自动拆分 {split_count} 个识别片段。")
            raw_text = self._segments_to_text(aligned_segments) or raw_text
        if silence_split_count:
            warnings.append(f"已避开 {silence_split_count} 段长静音区域切分识别片段。")
        audio_duration_sec = self._probe_audio_duration_seconds(target)
        aligned_segments, corrected_count = self._correct_segment_timings(
            aligned_segments,
            audio_duration_sec=audio_duration_sec,
        )
        if corrected_count:
            warnings.append(f"已矫正 {corrected_count} 个异常过长或过宽的识别时间轴片段。")

        speaker_map: dict[str, str] = {}
        has_timestamps = any(
            isinstance(seg.get("start"), (int, float)) and isinstance(seg.get("end"), (int, float))
            for seg in aligned_segments
        )
        if speaker_labels and has_timestamps:
            turns = await self._run_diarization(target)
            labeled_text, aligned_segments, speaker_map = self._label_segments_with_turns(aligned_segments, raw_text, turns, warnings)
            plain_text = self._strip_speaker_labels(labeled_text)
        elif speaker_labels:
            warnings.append("当前 ASR 输出缺少稳定时间戳，已跳过说话人分离。")
            labeled_text = raw_text
            plain_text = raw_text
        else:
            labeled_text = raw_text
            plain_text = raw_text

        alignments = self._build_alignments_from_segments(aligned_segments)
        if self._is_qwen3_backend(target_backend):
            alignments, final_clamp_report = self._finalize_qwen3_preview_alignments_with_audio_bounds(
                alignments,
                audio_duration_sec=audio_duration_sec,
            )
            if final_clamp_report:
                timeline_repairs.append(final_clamp_report)
                warnings.append("Qwen3-ASR 预览时间轴已按真实音频时长做最终越界校验。")
                rebuilt_lines = [str(item.get("text", "")).strip() for item in alignments if str(item.get("text", "")).strip()]
                if rebuilt_lines:
                    plain_text = "\n".join(rebuilt_lines).strip()
                    if speaker_labels:
                        labeled_text = "\n".join(
                            f"{str(item.get('speaker') or '').strip()}：{str(item.get('text') or '').strip()}"
                            if str(item.get("speaker") or "").strip()
                            else str(item.get("text") or "").strip()
                            for item in alignments
                            if str(item.get("text") or "").strip()
                        ).strip()
                    else:
                        labeled_text = plain_text

        return {
            "text": plain_text,
            "labeled_text": labeled_text,
            "backend": backend_used,
            "speaker_labels": bool(speaker_labels),
            "alignments": alignments,
            "speaker_map": speaker_map,
            "warnings": warnings,
            "timeline_repairs": timeline_repairs,
            "model_files": self._build_model_files(backend_used),
        }

    async def _transcribe_backend_segments(
        self,
        target: Path,
        *,
        backend: str | None,
        language: str | None,
        speaker_labels: bool,
        enable_timestamps: bool | None,
        qwen3_preview_max_line_length: int | None,
    ) -> tuple[str, list[dict[str, Any]], str, str, list[str], int | None]:
        requested_backend = backend if str(backend or "").strip() else self.default_backend
        target_backend = self._normalize_backend(requested_backend)
        requested_language = str(language or "auto").strip().lower() or "auto"

        if target_backend == WHISPER_BACKEND:
            try:
                raw_text, segments, backend_used = await self._transcribe_whisper_segments(target, language=requested_language)
            except TypeError as exc:
                if "language" not in str(exc) or "unexpected keyword" not in str(exc):
                    raise
                raw_text, segments, backend_used = await self._transcribe_whisper_segments(target)
            return raw_text, segments, backend_used, target_backend, [], None

        if self._is_qwen3_backend(target_backend):
            qwen3_enable_timestamps = bool(enable_timestamps) if enable_timestamps is not None else None
            qwen3_max_line_length = self._normalize_qwen3_preview_max_line_length(qwen3_preview_max_line_length)
            if speaker_labels:
                self._validate_qwen3_speaker_label_requirements()
                qwen3_enable_timestamps = True
            raw_text, segments, backend_used = await self._transcribe_crispasr_segments(
                target,
                enable_timestamps_override=qwen3_enable_timestamps,
                language_override=requested_language,
                max_line_length=qwen3_max_line_length,
            )
            warnings = list(getattr(self, "_last_crispasr_warnings", []) or [])
            return raw_text, segments, backend_used, target_backend, warnings, qwen3_max_line_length

        raise ValueError(f"Unsupported ASR backend: {backend}")

    def _recover_inline_timestamp_segments(self, segments: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for segment in segments or []:
            item = dict(segment or {})
            text = str(item.get("text", "") or "")
            if "[" in text and "-->" in text and "]" in text:
                token_segments = self._parse_inline_timestamp_tokens(text)
                merged_segments = self._merge_timestamp_tokens(token_segments) if token_segments else []
                if merged_segments:
                    output.extend(merged_segments)
                    continue
            output.append(item)
        return output

    def _postprocess_qwen3_timeline_segments(
        self,
        segments: list[dict[str, Any]],
        *,
        max_line_length: int | None,
    ) -> dict[str, Any]:
        warnings: list[str] = []
        repairs: list[dict[str, Any]] = []
        if any(bool(seg.get("qwen3_json_srt_repaired")) for seg in segments):
            return {
                "segments": [dict(seg, preserve_timing_boundaries=True) for seg in segments],
                "warnings": warnings,
                "repairs": repairs,
            }

        output, zero_count, zero_repairs = self._repair_qwen3_zero_duration_and_overlaps(segments)
        repairs.extend(zero_repairs)
        if zero_count:
            warnings.append(f"已修复 {zero_count} 个 Qwen3 零时长、引号或重叠时间轴片段。")

        output, tail_merge_count, tail_repairs = self._merge_qwen3_trailing_fragments(output)
        repairs.extend(tail_repairs)
        if tail_merge_count:
            warnings.append(f"已合并 {tail_merge_count} 个 Qwen3 时间轴尾随短片段。")

        output, short_timing_count, short_timing_repairs = self._repair_qwen3_short_timings(output)
        repairs.extend(short_timing_repairs)
        if short_timing_count:
            warnings.append(f"已修复 {short_timing_count} 个 Qwen3 过短时间轴片段。")

        output, weak_split_count, weak_split_repairs = self._split_qwen3_long_segments_by_weak_punctuation(
            output,
            max_line_length=max_line_length,
        )
        repairs.extend(weak_split_repairs)
        if weak_split_count:
            warnings.append(f"已按弱标点拆分 {weak_split_count} 个 Qwen3 过长识别片段。")

        return {"segments": output, "warnings": warnings, "repairs": repairs}

    @staticmethod
    def _segments_to_text(segments: list[dict[str, Any]]) -> str:
        return "\n".join(
            str(segment.get("text", "")).strip()
            for segment in segments
            if str(segment.get("text", "")).strip()
        ).strip()

    @staticmethod
    def _build_alignments_from_segments(segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
        alignments: list[dict[str, Any]] = []
        for idx, seg in enumerate(segments, start=1):
            text = str(seg.get("text", "")).strip()
            if not text:
                continue
            start = seg.get("start")
            end = seg.get("end")
            start_ms = int(round(float(start) * 1000)) if isinstance(start, (int, float)) else 0
            end_ms = int(round(float(end) * 1000)) if isinstance(end, (int, float)) else start_ms
            if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end_ms <= start_ms:
                end_ms = start_ms + 1
            elif end_ms < start_ms:
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
        return alignments

    def _build_model_files(self, backend_name: str) -> dict[str, str]:
        backend = str(backend_name or "").strip().lower()
        if self._is_qwen3_backend(backend):
            return {
                "main_model_path": str(Path(self.qwen3_model_path or "").expanduser()) if self.qwen3_model_path else "",
                "crispasr_exe": str(Path(self.crispasr_exe or "").expanduser()) if self.crispasr_exe else "",
                "forced_aligner_model_path": str(Path(self.qwen3_forced_aligner_model_path or "").expanduser())
                if self.qwen3_forced_aligner_model_path
                else "",
            }
        return {
            "main_model_path": str(self.model_path or ""),
        }

    @classmethod
    def _finalize_qwen3_preview_alignments_with_audio_bounds(
        cls,
        alignments: list[dict[str, Any]],
        *,
        audio_duration_sec: float | None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        audio_duration = cls._coerce_finite_seconds(audio_duration_sec)
        if audio_duration is None:
            return alignments, None
        audio_end_ms = max(0, int(round(audio_duration * 1000)))
        if audio_end_ms <= 0:
            return alignments, None

        output: list[dict[str, Any]] = []
        clamped_count = 0
        merged_count = 0
        original_out_of_audio = 0
        zero_after_clamp = 0

        for item in alignments or []:
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            start = cls._coerce_alignment_ms(item.get("start_ms"))
            end = cls._coerce_alignment_ms(item.get("end_ms"))
            if start is None or end is None:
                output.append(dict(item))
                continue
            if start < 0 or end > audio_end_ms:
                original_out_of_audio += 1
            next_item = dict(item)
            next_start = min(max(0, start), audio_end_ms)
            next_end = min(max(0, end), audio_end_ms)
            if next_start != start or next_end != end:
                clamped_count += 1
            if next_end <= next_start:
                zero_after_clamp += 1
                if output:
                    cls._append_qwen3_repaired_segment_text(output[-1], text)
                    merged_count += 1
                    continue
                next_end = audio_end_ms
                next_start = max(0, next_end - 1)
                if next_end <= next_start:
                    continue
            next_item["start_ms"] = next_start
            next_item["end_ms"] = next_end
            output.append(next_item)

        if not clamped_count and not merged_count and not original_out_of_audio:
            return alignments, None
        for index, item in enumerate(output, start=1):
            item["id"] = str(item.get("id") or f"asr-seg-{index}")
        report = {
            "kind": "qwen3_preview_audio_bounds",
            "audio_duration_ms": audio_end_ms,
            "entries_before": len([item for item in alignments or [] if str(item.get("text") or "").strip()]),
            "entries_after": len(output),
            "out_of_audio_before": original_out_of_audio,
            "clamped_entries": clamped_count,
            "merged_after_clamp": merged_count,
            "zero_or_negative_after_clamp": zero_after_clamp,
            "out_of_audio_after": sum(
                1
                for item in output
                if cls._coerce_alignment_ms(item.get("start_ms")) is not None
                and cls._coerce_alignment_ms(item.get("end_ms")) is not None
                and (
                    int(item["start_ms"]) < 0
                    or int(item["end_ms"]) > audio_end_ms
                    or int(item["end_ms"]) <= int(item["start_ms"])
                )
            ),
        }
        return output, report

    @staticmethod
    def _coerce_alignment_ms(value: Any) -> int | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number):
            return None
        return int(round(number))

    def _validate_qwen3_speaker_label_requirements(self) -> None:
        forced_aligner = str(self.qwen3_forced_aligner_model_path or "").strip()
        if not forced_aligner:
            raise RuntimeError(
                "启用 Qwen3-ASR 说话人标签需要配置 Qwen3-ForcedAligner GGUF 模型路径"
                "（qwen3_asr_forced_aligner_model_path）。"
            )
        forced_aligner_path = Path(forced_aligner).expanduser()
        if not forced_aligner_path.exists() or not forced_aligner_path.is_file():
            raise RuntimeError(f"Qwen3-ForcedAligner GGUF 模型不存在，无法进行说话人标签对齐: {forced_aligner_path}")

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

    async def _transcribe_whisper_segments(self, target: Path, *, language: str = "auto") -> tuple[str, list[dict[str, Any]], str]:
        if not self.is_loaded or self._model is None:
            await self.load_model(self.model_path, self.device, backend="whisper")

        segments: list[dict[str, Any]] = []
        language_arg = None if str(language or "auto").strip().lower() in {"", "auto", "unknown"} else str(language).strip().lower()
        if self._backend == "openai-whisper":
            whisper_device, _, _ = self._parse_device(self.device)
            kwargs = {"fp16": whisper_device.startswith("cuda"), "word_timestamps": True}
            if language_arg:
                kwargs["language"] = language_arg
            try:
                result = self._model.transcribe(str(target), **kwargs)
            except TypeError as exc:
                if "word_timestamps" not in str(exc) and "unexpected keyword" not in str(exc):
                    raise
                kwargs.pop("word_timestamps", None)
                result = self._model.transcribe(str(target), **kwargs)
            raw_text = str(result.get("text", "")).strip()
            for seg in result.get("segments", []) or []:
                text = str(seg.get("text", "")).strip()
                if not text:
                    continue
                item = {
                    "start": float(seg.get("start", 0.0) or 0.0),
                    "end": float(seg.get("end", 0.0) or 0.0),
                    "text": text,
                }
                words = seg.get("words")
                if isinstance(words, list):
                    item["words"] = words
                segments.append(item)
        elif self._backend == "faster-whisper":
            kwargs = {"beam_size": 5, "vad_filter": True, "word_timestamps": True}
            if language_arg:
                kwargs["language"] = language_arg
            try:
                fw_segments, _ = self._model.transcribe(str(target), **kwargs)
            except TypeError as exc:
                if "word_timestamps" not in str(exc) and "unexpected keyword" not in str(exc):
                    raise
                kwargs.pop("word_timestamps", None)
                fw_segments, _ = self._model.transcribe(str(target), **kwargs)
            raw_parts: list[str] = []
            for seg in fw_segments:
                text = str(getattr(seg, "text", "")).strip()
                if not text:
                    continue
                raw_parts.append(text)
                item = {
                    "start": float(getattr(seg, "start", 0.0) or 0.0),
                    "end": float(getattr(seg, "end", 0.0) or 0.0),
                    "text": text,
                }
                words = getattr(seg, "words", None)
                if words:
                    item["words"] = [
                        {
                            "start": getattr(word, "start", None),
                            "end": getattr(word, "end", None),
                            "word": getattr(word, "word", ""),
                        }
                        for word in words
                    ]
                segments.append(item)
            raw_text = "".join(raw_parts).strip()
        else:
            raise RuntimeError("ASR backend unavailable")

        if not segments and raw_text:
            segments = [{"start": None, "end": None, "text": raw_text}]
        return raw_text, segments, self._backend or "whisper"

    @staticmethod
    def _coerce_finite_seconds(value: Any) -> float | None:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(number) or number < 0:
            return None
        return number

    @staticmethod
    def _normalize_qwen3_preview_max_line_length(value: Any) -> int | None:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        if parsed == -1:
            return None
        return min(50, max(2, parsed))

    @classmethod
    def _word_time_range(cls, words: Any) -> tuple[float, float] | None:
        normalized = cls._normalize_word_items(words)
        starts = [float(word["start"]) for word in normalized]
        ends = [float(word["end"]) for word in normalized]
        if not starts or not ends:
            return None
        return min(starts), max(ends)

    @classmethod
    def _normalize_word_items(cls, words: Any) -> list[dict[str, Any]]:
        if not isinstance(words, list):
            return []
        normalized: list[dict[str, Any]] = []
        for word in words:
            if isinstance(word, dict):
                start = cls._coerce_finite_seconds(word.get("start"))
                end = cls._coerce_finite_seconds(word.get("end"))
                text = str(word.get("word") or word.get("text") or "").strip()
            else:
                start = cls._coerce_finite_seconds(getattr(word, "start", None))
                end = cls._coerce_finite_seconds(getattr(word, "end", None))
                text = str(getattr(word, "word", "") or getattr(word, "text", "") or "").strip()
            if start is None or end is None or end <= start or not text:
                continue
            normalized.append({"start": start, "end": end, "text": text})
        return normalized

    @classmethod
    def _join_word_texts(cls, words: list[dict[str, Any]]) -> str:
        text = ""
        for word in words:
            text = cls._join_tokens_for_language(text, str(word.get("text", "")).strip())
        return text.strip()

    @staticmethod
    def _normalize_silence_ranges(silence_ranges: Any) -> list[dict[str, float]]:
        if not isinstance(silence_ranges, list):
            return []
        normalized: list[dict[str, float]] = []
        for item in silence_ranges:
            if not isinstance(item, dict):
                continue
            start = ASREngine._coerce_finite_seconds(item.get("start"))
            end = ASREngine._coerce_finite_seconds(item.get("end"))
            if start is None or end is None or end <= start:
                continue
            normalized.append({"start": round(start, 3), "end": round(end, 3)})
        return sorted(normalized, key=lambda value: (value["start"], value["end"]))

    @staticmethod
    def _find_silence_between(prev_end: float, next_start: float, silence_ranges: list[dict[str, float]]) -> dict[str, float] | None:
        if next_start <= prev_end:
            return None
        for item in silence_ranges:
            start = float(item["start"])
            end = float(item["end"])
            if end <= prev_end:
                continue
            if start >= next_start:
                break
            if max(start, prev_end) < min(end, next_start):
                return item
            if start >= prev_end and end <= next_start:
                return item
        return None

    @staticmethod
    def _detect_silence_ranges(audio_path: Path) -> list[dict[str, float]]:
        try:
            from pydub import AudioSegment
            from pydub.silence import detect_silence
        except Exception as exc:
            raise RuntimeError(f"缺少 pydub 静音检测依赖：{exc}") from exc

        audio = AudioSegment.from_file(audio_path)
        ranges_ms = detect_silence(
            audio,
            min_silence_len=SILENCE_AWARE_MIN_SILENCE_MS,
            silence_thresh=SILENCE_AWARE_THRESHOLD_DBFS,
            seek_step=SILENCE_AWARE_SEEK_STEP_MS,
        )
        return [
            {"start": round(max(0, int(start_ms)) / 1000.0, 3), "end": round(max(0, int(end_ms)) / 1000.0, 3)}
            for start_ms, end_ms in ranges_ms
            if int(end_ms) > int(start_ms)
        ]

    @classmethod
    def _split_segments_by_word_gaps(
        cls,
        segments: list[dict[str, Any]],
        *,
        silence_ranges: list[dict[str, float]] | None = None,
    ) -> tuple[list[dict[str, Any]], int, int]:
        next_segments: list[dict[str, Any]] = []
        split_count = 0
        silence_split_count = 0
        sentence_end = {"。", "！", "？", ".", "!", "?"}
        normalized_silence_ranges = cls._normalize_silence_ranges(silence_ranges)

        def group_duration(group: dict[str, Any]) -> float:
            words = group.get("words") if isinstance(group, dict) else []
            if not words:
                return 0.0
            return max(0.0, float(words[-1]["end"]) - float(words[0]["start"]))

        def group_text(group: dict[str, Any]) -> str:
            return cls._join_word_texts(group.get("words") or [])

        def add_prefix_text(group: dict[str, Any], text: str) -> None:
            clean = str(text or "").strip()
            if not clean:
                return
            group["prefix_text"] = cls._join_tokens_for_language(clean, str(group.get("prefix_text", "")).strip())

        def add_suffix_text(group: dict[str, Any], text: str) -> None:
            clean = str(text or "").strip()
            if not clean:
                return
            group["suffix_text"] = cls._join_tokens_for_language(str(group.get("suffix_text", "")).strip(), clean)

        def absorb_short_groups(raw_groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
            groups = [dict(group) for group in raw_groups if group.get("words")]
            index = 0
            while len(groups) > 1 and index < len(groups):
                if group_duration(groups[index]) >= TIMELINE_MIN_SPLIT_SEGMENT_SEC:
                    index += 1
                    continue
                text = group_text(groups[index])
                if index == 0:
                    add_prefix_text(groups[1], text)
                    groups.pop(0)
                    continue
                if index == len(groups) - 1:
                    add_suffix_text(groups[index - 1], text)
                    groups.pop(index)
                    index = max(0, index - 1)
                    continue
                previous_words = groups[index - 1]["words"]
                next_words = groups[index + 1]["words"]
                previous_gap = max(0.0, float(groups[index]["words"][0]["start"]) - float(previous_words[-1]["end"]))
                next_gap = max(0.0, float(next_words[0]["start"]) - float(groups[index]["words"][-1]["end"]))
                if previous_gap <= next_gap:
                    add_suffix_text(groups[index - 1], text)
                else:
                    add_prefix_text(groups[index + 1], text)
                groups.pop(index)
                index = max(0, index - 1)
            return groups

        def segment_duration(segment: dict[str, Any]) -> float:
            start = cls._coerce_finite_seconds(segment.get("start"))
            end = cls._coerce_finite_seconds(segment.get("end"))
            if start is None or end is None:
                return 0.0
            return max(0.0, end - start)

        def segment_gap(previous: dict[str, Any], next_item: dict[str, Any]) -> float:
            previous_end = cls._coerce_finite_seconds(previous.get("end"))
            next_start = cls._coerce_finite_seconds(next_item.get("start"))
            if previous_end is None or next_start is None:
                return 0.0
            return max(0.0, next_start - previous_end)

        def prepend_segment_text(segment: dict[str, Any], text: str) -> None:
            clean = str(text or "").strip()
            if clean:
                segment["text"] = cls._join_tokens_for_language(clean, str(segment.get("text", "")).strip())

        def append_segment_text(segment: dict[str, Any], text: str) -> None:
            clean = str(text or "").strip()
            if clean:
                segment["text"] = cls._join_tokens_for_language(str(segment.get("text", "")).strip(), clean)

        def absorb_short_created_segments(created_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
            segments = [dict(segment) for segment in created_segments if str(segment.get("text", "")).strip()]
            index = 0
            while len(segments) > 1 and index < len(segments):
                if segment_duration(segments[index]) >= TIMELINE_MIN_SPLIT_SEGMENT_SEC:
                    index += 1
                    continue
                text = str(segments[index].get("text", "")).strip()
                if index == 0:
                    prepend_segment_text(segments[1], text)
                    segments.pop(0)
                    continue
                if index == len(segments) - 1:
                    append_segment_text(segments[index - 1], text)
                    segments.pop(index)
                    index = max(0, index - 1)
                    continue
                previous_gap = segment_gap(segments[index - 1], segments[index])
                next_gap = segment_gap(segments[index], segments[index + 1])
                if previous_gap <= next_gap:
                    append_segment_text(segments[index - 1], text)
                else:
                    prepend_segment_text(segments[index + 1], text)
                segments.pop(index)
                index = max(0, index - 1)
            return segments

        for seg in segments:
            item = dict(seg or {})
            words = cls._normalize_word_items(item.get("words"))
            if len(words) < 2:
                next_segments.append(item)
                continue

            groups: list[dict[str, Any]] = []
            current: dict[str, Any] = {"words": [words[0]], "prefix_text": "", "suffix_text": "", "start_boundary": None, "end_boundary": None}
            for word in words[1:]:
                previous = current["words"][-1]
                gap = max(0.0, float(word["start"]) - float(previous["end"]))
                previous_text = str(previous.get("text", "")).strip()
                silence_range = cls._find_silence_between(float(previous["end"]), float(word["start"]), normalized_silence_ranges)
                split_here = silence_range is not None or gap > TIMELINE_WORD_SPLIT_GAP_SEC
                if previous_text[-1:] in sentence_end and gap > TIMELINE_WORD_SPLIT_PUNCTUATION_GAP_SEC:
                    split_here = True
                if split_here:
                    if silence_range is not None:
                        current["end_boundary"] = float(silence_range["start"])
                        silence_split_count += 1
                    groups.append(current)
                    current = {
                        "words": [word],
                        "prefix_text": "",
                        "suffix_text": "",
                        "start_boundary": float(silence_range["end"]) if silence_range is not None else None,
                        "end_boundary": None,
                    }
                else:
                    current["words"].append(word)
            groups.append(current)

            if len(groups) < 2:
                next_segments.append(item)
                continue
            groups = absorb_short_groups(groups)
            if not groups:
                next_segments.append(item)
                continue

            original_start = cls._coerce_finite_seconds(item.get("start"))
            original_end = cls._coerce_finite_seconds(item.get("end"))
            created: list[dict[str, Any]] = []
            for group in groups:
                words = group.get("words") or []
                text = cls._join_tokens_for_language(
                    cls._join_tokens_for_language(str(group.get("prefix_text", "")).strip(), cls._join_word_texts(words)),
                    str(group.get("suffix_text", "")).strip(),
                ).strip()
                if not text:
                    continue
                start_boundary = cls._coerce_finite_seconds(group.get("start_boundary"))
                end_boundary = cls._coerce_finite_seconds(group.get("end_boundary"))
                group_start = max(0.0, start_boundary if start_boundary is not None else float(words[0]["start"]) - TIMELINE_WORD_PADDING_SEC)
                group_end = end_boundary if end_boundary is not None else float(words[-1]["end"]) + TIMELINE_WORD_PADDING_SEC
                if original_start is not None:
                    group_start = max(original_start, group_start)
                if original_end is not None:
                    group_end = min(original_end, group_end)
                if group_end < group_start:
                    group_end = group_start
                created.append(
                    {
                        **item,
                        "start": group_start,
                        "end": group_end,
                        "text": text,
                        "words": words,
                        "preserve_timing_boundaries": start_boundary is not None or end_boundary is not None,
                    }
                )

            if not created:
                next_segments.append(item)
                continue
            created = absorb_short_created_segments(created)
            if not created:
                next_segments.append(item)
                continue
            split_count += max(0, len(created) - 1)
            next_segments.extend(created)

        return next_segments, split_count, silence_split_count

    @staticmethod
    def _estimate_speaking_seconds(text: str) -> float:
        raw = str(text or "").strip()
        if not raw:
            return 0.4
        cjk_count = len(re.findall(r"[\u4e00-\u9fff]", raw))
        latin_tokens = re.findall(r"[A-Za-z0-9']+", raw)
        punctuation = re.findall(r"[，。！？；,.!?;:]", raw)
        if cjk_count > 0:
            base = cjk_count / 3.2
        else:
            base = max(1, len(latin_tokens)) / 2.6
        pause = len(punctuation) * 0.12
        return max(0.4, min(60.0, base + pause))

    @staticmethod
    def _probe_audio_duration_seconds(audio_path: Path) -> float | None:
        cmd = [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ]
        try:
            proc = subprocess.run(cmd, capture_output=True, check=True)
        except Exception:
            return None
        stdout = proc.stdout or b""
        if isinstance(stdout, bytes):
            raw = stdout.decode("utf-8", errors="ignore").strip()
        else:
            raw = str(stdout).strip()
        try:
            duration = float(raw)
        except ValueError:
            return None
        if not math.isfinite(duration) or duration <= 0:
            return None
        return duration

    @classmethod
    def _correct_segment_timings(
        cls,
        segments: list[dict[str, Any]],
        *,
        audio_duration_sec: float | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        corrected: list[dict[str, Any]] = []
        corrected_count = 0
        audio_duration = cls._coerce_finite_seconds(audio_duration_sec)

        for seg in segments:
            item = dict(seg or {})
            start = cls._coerce_finite_seconds(item.get("start"))
            end = cls._coerce_finite_seconds(item.get("end"))
            if start is None or end is None:
                corrected.append(item)
                continue
            raw_start = start
            raw_end = end
            if audio_duration is not None:
                start = min(start, audio_duration)
                end = min(end, audio_duration)
            if end < start:
                end = start

            original_start = start
            original_end = end
            word_range = cls._word_time_range(item.get("words"))
            if item.get("preserve_timing_boundaries"):
                pass
            elif word_range:
                word_start, word_end = word_range
                start = max(original_start, word_start - TIMELINE_WORD_PADDING_SEC)
                end = min(original_end, word_end + TIMELINE_WORD_PADDING_SEC)
                if audio_duration is not None:
                    end = min(end, audio_duration)
                if end < start:
                    end = start
            else:
                duration = end - start
                estimated = cls._estimate_speaking_seconds(str(item.get("text", "")))
                is_suspiciously_long = (
                    duration - estimated >= TIMELINE_LONG_SEGMENT_MIN_DIFF_SEC
                    and duration >= max(estimated * TIMELINE_LONG_SEGMENT_RATIO, estimated + TIMELINE_LONG_SEGMENT_MIN_DIFF_SEC)
                )
                if is_suspiciously_long:
                    corrected_duration = max(
                        0.45,
                        min(duration, max(estimated + TIMELINE_TEXT_PADDING_SEC, estimated * TIMELINE_MAX_CORRECTED_TEXT_RATIO)),
                    )
                    end = start + corrected_duration
                    if audio_duration is not None:
                        end = min(end, audio_duration)

            if abs(start - raw_start) > 0.05 or abs(end - raw_end) > 0.05:
                corrected_count += 1
            item["start"] = start
            item["end"] = max(start, end)
            corrected.append(item)

        return corrected, corrected_count

    def _validate_crispasr_config(self) -> None:
        exe = Path(str(self.crispasr_exe or "").strip()).expanduser()
        model = Path(str(self.qwen3_model_path or "").strip()).expanduser()
        if not str(self.crispasr_exe or "").strip():
            raise RuntimeError("未配置 CrispASR 可执行文件路径（qwen3_asr_crispasr_exe）")
        if not exe.exists() or not exe.is_file():
            raise RuntimeError(f"CrispASR 可执行文件不存在: {exe}")
        if not str(self.qwen3_model_path or "").strip():
            raise RuntimeError("未配置 Qwen3-ASR GGUF 模型路径（qwen3_asr_model_path）")
        if not model.exists() or not model.is_file():
            raise RuntimeError(f"Qwen3-ASR GGUF 模型不存在: {model}")

    @staticmethod
    def _parse_srt_time_to_seconds(value: str) -> float:
        text = str(value or "").strip()
        m = re.match(r"^(\d+):(\d+):(\d+)[,.](\d+)$", text)
        if not m:
            return 0.0
        hh = int(m.group(1))
        mm = int(m.group(2))
        ss = int(m.group(3))
        frac_text = m.group(4)
        if len(frac_text) >= 3:
            ms = int(frac_text[:3])
        else:
            ms = int(frac_text.ljust(3, "0"))
        return float(hh * 3600 + mm * 60 + ss + ms / 1000.0)

    @classmethod
    def _parse_srt_segments(cls, text: str) -> list[dict[str, Any]]:
        blocks = re.split(r"\r?\n\r?\n+", str(text or "").strip())
        segments: list[dict[str, Any]] = []
        for block in blocks:
            lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
            if len(lines) < 2:
                continue
            if re.fullmatch(r"\d+", lines[0]):
                lines = lines[1:]
            if not lines:
                continue
            time_line = lines[0]
            tm = re.match(r"^(.+?)\s*-->\s*(.+?)$", time_line)
            if not tm:
                continue
            start = cls._parse_srt_time_to_seconds(tm.group(1))
            end = cls._parse_srt_time_to_seconds(tm.group(2))
            cue_text = " ".join(lines[1:]).strip()
            if cue_text:
                segments.append({"start": start, "end": end, "text": cue_text})
        return segments

    @classmethod
    def _parse_inline_timestamp_tokens(cls, text: str) -> list[dict[str, Any]]:
        pattern = re.compile(r"\[\s*([0-9:.,]+)\s*-->\s*([0-9:.,]+)\s*\]\s*([^\[]*)")
        tokens: list[dict[str, Any]] = []
        for match in pattern.finditer(str(text or "")):
            start = cls._parse_srt_time_to_seconds(match.group(1))
            end = cls._parse_srt_time_to_seconds(match.group(2))
            chunk = str(match.group(3) or "").strip()
            if not chunk:
                continue
            if end < start:
                end = start
            tokens.append({"start": start, "end": end, "text": chunk})
        return tokens

    @staticmethod
    def _join_tokens_for_language(current: str, token: str) -> str:
        left = str(current or "")
        right = str(token or "")
        if not left:
            return right
        if not right:
            return left
        if left.endswith(" ") or right.startswith(" "):
            return left + right
        cjk_or_punc = r"[\u4e00-\u9fff，。！？；：、“”‘’（）《》【】,.!?;:]"
        if re.match(cjk_or_punc, right[0]) or re.match(cjk_or_punc, left[-1]):
            return left + right
        return f"{left} {right}"

    @classmethod
    def _merge_timestamp_tokens(cls, tokens: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not tokens:
            return []
        merged: list[dict[str, Any]] = []
        sentence_end = {"。", "！", "？", ".", "!", "?"}
        punctuation = {"，", "。", "！", "？", "；", "：", ",", ".", "!", "?", ";", ":"}
        gap_threshold = 0.45

        current: dict[str, Any] | None = None
        for idx, token in enumerate(tokens):
            text = str(token.get("text", "")).strip()
            if not text:
                continue
            start = float(token.get("start", 0.0) or 0.0)
            end = float(token.get("end", start) or start)
            if end < start:
                end = start

            if current is None:
                current = {"start": start, "end": end, "text": text}
                continue

            gap = max(0.0, start - float(current["end"]))
            should_split = gap > gap_threshold
            if str(current["text"])[-1:] in sentence_end:
                should_split = True
            if text in punctuation and not should_split:
                current["text"] = cls._join_tokens_for_language(str(current["text"]), text)
                current["end"] = max(float(current["end"]), end)
                continue

            if should_split:
                merged.append(current)
                current = {"start": start, "end": end, "text": text}
            else:
                current["text"] = cls._join_tokens_for_language(str(current["text"]), text)
                current["end"] = max(float(current["end"]), end)

            if current is not None and float(current["end"]) <= float(current["start"]) and idx + 1 < len(tokens):
                next_start = float(tokens[idx + 1].get("start", current["end"]) or current["end"])
                if next_start > float(current["start"]):
                    current["end"] = next_start

        if current is not None:
            merged.append(current)
        return merged

    @classmethod
    def _normalize_alignment_text(cls, text: str) -> str:
        chars: list[str] = []
        in_number = False
        chinese_number_chars = set("零〇一二两三四五六七八九十百千万亿兆点")
        for char in str(text or "").lower():
            if char.isdigit() or char in chinese_number_chars:
                if not in_number:
                    chars.append("#")
                in_number = True
                continue
            in_number = False
            if re.match(r"[\u4e00-\u9fffA-Za-z]", char):
                chars.append(char)
        return "".join(chars)

    @classmethod
    def _text_for_normalized_range(cls, text: str, start: int, end: int) -> str:
        normalized_index = 0
        out: list[str] = []
        for char in str(text or ""):
            is_text_char = bool(re.match(r"[\u4e00-\u9fffA-Za-z0-9]", char.lower()))
            if is_text_char:
                if normalized_index >= end:
                    break
                if normalized_index >= start:
                    out.append(char)
                normalized_index += 1
                continue
            if start <= normalized_index <= end:
                out.append(char)
        return "".join(out)

#    @staticmethod
    @classmethod
    def _split_plain_text_sentences(cls, text: str) -> list[str]:
        raw = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not raw:
            return []
        pieces: list[str] = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            matches = re.findall(r"[^。！？!?\n]+[。！？!?][”\"'’）)]}》】]*|[^。！？!?\n]+", line)
            pieces.extend(item.strip() for item in matches if item.strip())
        return pieces or [raw]

    @classmethod
    def _preview_line_text_length(cls, text: str) -> int:
        return len(cls._normalize_alignment_text(text))

    @classmethod
    def _repair_leading_closing_punctuation_rows(cls, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        repaired: list[dict[str, Any]] = []
        closing_marks = set("”\"'’）)]}》】」』")
        sentence_end_marks = set("。！？!?")
        for row in rows:
            text = str(row.get("text", "") or "").strip()
            if repaired:
                close_end = 0
                if text[:1] in sentence_end_marks:
                    index = 0
                    while index < len(text) and text[index] in sentence_end_marks:
                        index += 1
                    close_index = index
                    while close_index < len(text) and text[close_index] in closing_marks:
                        close_index += 1
                    if close_index > index:
                        close_end = close_index
                else:
                    while close_end < len(text) and text[close_end] in closing_marks:
                        close_end += 1

                if close_end:
                    close_text = text[:close_end]
                    rest_text = text[close_end:].strip()
                    repaired[-1] = {
                        **repaired[-1],
                        "text": cls._join_tokens_for_language(str(repaired[-1].get("text", "")).strip(), close_text),
                    }
                    if not rest_text:
                        continue
                    row = {**row, "text": rest_text}
            repaired.append(row)
        return repaired

    @classmethod
    def _split_preview_text_by_weak_breaks(cls, text: str, max_line_length: int) -> list[str]:
        limit = max(1, int(max_line_length or 1))
        raw = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not raw:
            return []

        weak_break_marks = set("，,、；;")
        punctuation_or_quote_marks = set("，,、；;。！？!?:：、…\"'“”‘’（）()[]{}《》【】「」『』")

        def split_standalone_weak_breaks(source: str) -> list[str]:
            clauses: list[str] = []
            start = 0
            for index, char in enumerate(source):
                if char not in weak_break_marks:
                    continue
                next_index = index + 1
                while next_index < len(source) and source[next_index].isspace():
                    next_index += 1
                if next_index < len(source) and source[next_index] in punctuation_or_quote_marks:
                    continue
                clause = source[start : index + 1].strip()
                if clause:
                    clauses.append(clause)
                start = index + 1
            tail = source[start:].strip()
            if tail:
                clauses.append(tail)
            return clauses

        lines: list[str] = []
        for source_line in raw.splitlines():
            source_line = source_line.strip()
            if not source_line:
                continue
            if cls._preview_line_text_length(source_line) <= limit:
                lines.append(source_line)
                continue

            clauses = split_standalone_weak_breaks(source_line)
            if len(clauses) <= 1:
                lines.append(source_line)
                continue

            current = ""
            for clause in clauses:
                if not current:
                    current = clause
                    continue
                candidate = cls._join_tokens_for_language(current, clause)
                current_len = cls._preview_line_text_length(current)
                clause_len = cls._preview_line_text_length(clause)
                if cls._preview_line_text_length(candidate) <= limit or current_len <= 3 or clause_len <= 3:
                    current = candidate
                    continue
                lines.append(current)
                current = clause
            if current:
                lines.append(current)

        return lines or [raw]

    @classmethod
    def _split_preview_text_by_natural_breaks(cls, text: str, max_line_length: int) -> list[str]:
        raw = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not raw:
            return []
        lines: list[str] = []
        for strong_sentence in cls._split_plain_text_sentences(raw):
            if cls._preview_line_text_length(strong_sentence) <= max_line_length:
                lines.append(strong_sentence)
            else:
                lines.extend(cls._split_preview_text_by_weak_breaks(strong_sentence, max_line_length))
        return lines or [raw]

#    @classmethod
    @classmethod
    def _timeline_bounds(cls, segments: list[dict[str, Any]]) -> tuple[float, float]:
        starts: list[float] = []
        ends: list[float] = []
        for segment in segments or []:
            start = cls._coerce_finite_seconds(segment.get("start"))
            end = cls._coerce_finite_seconds(segment.get("end"))
            if start is None or end is None or end <= start:
                continue
            starts.append(start)
            ends.append(end)
        if not starts or not ends:
            return 0.0, 0.001
        return min(starts), max(ends)

    @classmethod
    def _pick_speaker_for_range(cls, start_sec: float, end_sec: float, segments: list[dict[str, Any]]) -> str:
        best_speaker = ""
        best_overlap = 0.0
        midpoint = (start_sec + end_sec) / 2.0
        nearest_speaker = ""
        nearest_distance = float("inf")
        for segment in segments or []:
            speaker = str(segment.get("speaker", "") or "").strip()
            if not speaker:
                continue
            seg_start = cls._coerce_finite_seconds(segment.get("start"))
            seg_end = cls._coerce_finite_seconds(segment.get("end"))
            if seg_start is None or seg_end is None or seg_end <= seg_start:
                continue
            overlap = max(0.0, min(end_sec, seg_end) - max(start_sec, seg_start))
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = speaker
            center = (seg_start + seg_end) / 2.0
            distance = abs(center - midpoint)
            if distance < nearest_distance:
                nearest_distance = distance
                nearest_speaker = speaker
        return best_speaker or nearest_speaker

#    @classmethod
    @classmethod
    def _merge_qwen3_trailing_fragments(cls, segments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, list[dict[str, Any]]]:
        merged: list[dict[str, Any]] = []
        merge_count = 0
        repairs: list[dict[str, Any]] = []
        sentence_end = set("。！？!?；;")
        punctuation_or_closer = set("，,。.!！？?；;：:“”\"'‘’（）()[]{}《》【】、")
        closers = set("”\"'’）)]}》】")
        openers = set("“\"'‘（([{《【")
        leading_punctuation = set("，,。.!！？?；;：:、")
        discourse_starters = {
            "然后",
            "但是",
            "不过",
            "所以",
            "因此",
            "接着",
            "随后",
            "另外",
            "同时",
            "最后",
            "首先",
            "其次",
            "此外",
            "而且",
            "那么",
            "于是",
        }
        boundary_words = {
            "一下",
            "就叫",
            "进入",
            "编辑",
            "配置",
            "解析",
            "保存",
            "加载",
            "模型",
            "项目",
            "文本",
            "声音",
            "音乐",
            "背景",
            "合成",
            "导出",
            "开始",
            "点击",
            "选择",
            "生成",
            "完成",
            "页面",
            "基础",
            "角色",
            "旁白",
            "对话",
            "工作",
            "方法",
            "使用",
            "建立",
            "新建",
            "设置",
            "系统",
            "时间",
            "片段",
            "语音",
            "识别",
            "翻译",
            "润色",
            "导入",
            "导出",
            "预览",
            "创建",
            "替换",
            "追加",
            "打开",
            "关闭",
            "停止",
            "录音",
            "上传",
            "下载",
            "需要",
        }

        def compact_len(value: str) -> int:
            return len(re.sub(r"\s+", "", value))

        def ends_sentence(value: str) -> bool:
            return bool(str(value or "").rstrip()[-1:] in sentence_end)

        def is_tail_fragment(value: str, previous: str) -> bool:
            text = str(value or "").strip()
            prev = str(previous or "").strip()
            if not text or not prev:
                return False
            compact = re.sub(r"\s+", "", text)
            if not compact:
                return False
            if all(ch in punctuation_or_closer for ch in compact):
                return True
            if compact[0] in closers:
                return True
            return compact_len(compact) <= 3 and any(ch in sentence_end for ch in compact) and not ends_sentence(prev)

        def split_trailing_openers(value: str) -> tuple[str, str]:
            text = str(value or "").rstrip()
            idx = len(text)
            while idx > 0 and text[idx - 1] in openers:
                idx -= 1
            if idx == len(text):
                return text, ""
            return text[:idx].rstrip(), text[idx:]

        def split_leading_attachment(value: str, previous: str) -> tuple[str, str]:
            text = str(value or "").strip()
            prev = str(previous or "").strip()
            if not text or not prev or ends_sentence(prev):
                return "", text
            idx = 0
            while idx < len(text) and text[idx] in leading_punctuation:
                idx += 1
            if idx > 0:
                return text[:idx], text[idx:].lstrip()
            comma_idx = -1
            for mark in ("，", ","):
                pos = text.find(mark)
                if pos >= 0 and (comma_idx < 0 or pos < comma_idx):
                    comma_idx = pos
            if 0 <= comma_idx <= 2:
                prefix = text[: comma_idx + 1]
                remainder = text[comma_idx + 1 :].lstrip()
                prefix_word = re.sub(r"[，,\s]+", "", prefix)
                if prefix_word in discourse_starters:
                    return "", text
                return prefix, remainder
            return "", text

        def split_compound_boundary(previous: str, current: str) -> tuple[str, str]:
            prev = str(previous or "").strip()
            text = str(current or "").strip()
            if not prev or not text or ends_sentence(prev):
                return "", text
            prev_tail = re.sub(r"\s+", "", prev)[-1:]
            compact = re.sub(r"\s+", "", text)
            current_head = compact[:1]
            if not prev_tail or not current_head:
                return "", text
            if f"{prev_tail}{current_head}" in boundary_words:
                return text[:1], text[1:].lstrip()
            moved_len = cls._qwen3_jieba_boundary_prefix_len(prev_tail, text, discourse_starters)
            if moved_len <= 0:
                return "", text
            return text[:moved_len], text[moved_len:].lstrip()

        def record_repair(kind: str, *, before: str, moved: str, after: str, target_before: str) -> None:
            repairs.append(
                {
                    "kind": kind,
                    "target_before": target_before,
                    "moved_text": moved,
                    "source_before": before,
                    "source_after": after,
                }
            )

        for segment in segments:
            item = dict(segment or {})
            text = str(item.get("text", "") or "").strip()
            if not text:
                continue
            compound_split = False
            if merged:
                prev_text = str(merged[-1].get("text", "") or "")
                prev_body, trailing_openers = split_trailing_openers(prev_text)
                if trailing_openers:
                    merged[-1]["text"] = prev_body
                    item["text"] = cls._join_tokens_for_language(trailing_openers, text)
                    text = str(item["text"])
                    merge_count += 1
                    repairs.append(
                        {
                            "kind": "trailing_opener",
                            "target_before": prev_text,
                            "moved_text": trailing_openers,
                            "source_before": str(segment.get("text", "") or ""),
                            "source_after": text,
                        }
                    )
                    if not str(merged[-1].get("text", "") or "").strip():
                        merged.pop()
            if merged and is_tail_fragment(text, str(merged[-1].get("text", "") or "")):
                target_before = str(merged[-1].get("text", "") or "")
                merged[-1]["text"] = cls._join_tokens_for_language(str(merged[-1].get("text", "") or ""), text)
                merge_count += 1
                record_repair("trailing_fragment", before=str(segment.get("text", "") or ""), moved=text, after="", target_before=target_before)
                continue
            if merged:
                leading, remainder = split_leading_attachment(text, str(merged[-1].get("text", "") or ""))
                if leading and remainder:
                    target_before = str(merged[-1].get("text", "") or "")
                    merged[-1]["text"] = cls._join_tokens_for_language(str(merged[-1].get("text", "") or ""), leading)
                    item["text"] = remainder
                    text = remainder
                    merge_count += 1
                    record_repair("leading_punctuation_or_prefix", before=str(segment.get("text", "") or ""), moved=leading, after=remainder, target_before=target_before)
                elif leading:
                    target_before = str(merged[-1].get("text", "") or "")
                    merged[-1]["text"] = cls._join_tokens_for_language(str(merged[-1].get("text", "") or ""), leading)
                    merge_count += 1
                    record_repair("leading_punctuation_or_prefix", before=str(segment.get("text", "") or ""), moved=leading, after="", target_before=target_before)
                    continue
                else:
                    compound_prefix, compound_remainder = split_compound_boundary(str(merged[-1].get("text", "") or ""), text)
                    if compound_prefix and compound_remainder:
                        target_before = str(merged[-1].get("text", "") or "")
                        merged[-1]["text"] = cls._join_tokens_for_language(str(merged[-1].get("text", "") or ""), compound_prefix)
                        item["text"] = compound_remainder
                        text = compound_remainder
                        merge_count += 1
                        compound_split = True
                        record_repair("compound_boundary", before=str(segment.get("text", "") or ""), moved=compound_prefix, after=compound_remainder, target_before=target_before)
                    elif compound_prefix:
                        target_before = str(merged[-1].get("text", "") or "")
                        merged[-1]["text"] = cls._join_tokens_for_language(str(merged[-1].get("text", "") or ""), compound_prefix)
                        merge_count += 1
                        record_repair("compound_boundary", before=str(segment.get("text", "") or ""), moved=compound_prefix, after="", target_before=target_before)
                        continue
            if not compound_split and merged and is_tail_fragment(text, str(merged[-1].get("text", "") or "")):
                target_before = str(merged[-1].get("text", "") or "")
                merged[-1]["text"] = cls._join_tokens_for_language(str(merged[-1].get("text", "") or ""), text)
                merge_count += 1
                record_repair("trailing_fragment", before=str(segment.get("text", "") or ""), moved=text, after="", target_before=target_before)
                continue
            merged.append(item)
        return merged, merge_count, repairs

    @classmethod
    def _qwen3_jieba_boundary_prefix_len(cls, previous_tail: str, current: str, discourse_starters: set[str]) -> int:
        tail = str(previous_tail or "").strip()
        text = str(current or "").strip()
        if not tail or not text or not re.match(r"[\u4e00-\u9fff]", tail) or not re.match(r"[\u4e00-\u9fff]", text[:1]):
            return 0
        if any(text.startswith(starter) for starter in discourse_starters):
            return 0
        try:
            import jieba  # type: ignore
        except Exception:
            return 0

        cjk_prefix_match = re.match(r"^[\u4e00-\u9fff]{1,4}", text)
        if not cjk_prefix_match:
            return 0
        candidate_current = cjk_prefix_match.group(0)
        candidate = f"{tail}{candidate_current}"
        try:
            tokens = [str(token or "").strip() for token in jieba.lcut(candidate, HMM=True) if str(token or "").strip()]
        except Exception:
            return 0
        if not tokens:
            return 0
        first = tokens[0]
        if not first.startswith(tail) or len(first) <= len(tail):
            return 0
        moved = first[len(tail) :]
        if not candidate_current.startswith(moved):
            return 0
        return min(len(moved), len(text))

    @classmethod
    def _repair_qwen3_short_timings(cls, segments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int, list[dict[str, Any]]]:
        repaired = [dict(segment or {}) for segment in segments]
        repair_count = 0
        repairs: list[dict[str, Any]] = []

        for index, item in enumerate(repaired):
            text = str(item.get("text", "") or "").strip()
            start = cls._coerce_finite_seconds(item.get("start"))
            end = cls._coerce_finite_seconds(item.get("end"))
            if not text or start is None or end is None or end <= start:
                continue

            duration = end - start
            estimated = cls._estimate_speaking_seconds(text)
            if estimated < 1.2 or duration >= 0.45 or duration >= estimated * 0.28:
                continue

            previous_end = None
            if index > 0:
                previous_end = cls._coerce_finite_seconds(repaired[index - 1].get("end"))
            next_start = None
            if index + 1 < len(repaired):
                next_start = cls._coerce_finite_seconds(repaired[index + 1].get("start"))

            new_start = start
            new_end = end
            if previous_end is not None and previous_end < start and start - previous_end >= 0.3:
                new_start = min(start, previous_end + QWEN3_SHORT_TIMING_EDGE_PAD_SEC)
            if next_start is not None and next_start > new_start and next_start - end <= 0.3:
                new_end = next_start - QWEN3_SHORT_TIMING_EDGE_PAD_SEC
            elif next_start is not None and next_start > end:
                new_end = min(next_start - QWEN3_SHORT_TIMING_EDGE_PAD_SEC, new_start + max(estimated * 1.15, duration))
            else:
                new_end = max(end, new_start + estimated)

            if new_end <= new_start:
                continue
            if abs(new_start - start) > 0.05 or abs(new_end - end) > 0.05:
                item["start"] = new_start
                item["end"] = new_end
                repair_count += 1
                repairs.append(
                    {
                        "kind": "short_timing",
                        "text": text,
                        "start_before": start,
                        "end_before": end,
                        "start_after": new_start,
                        "end_after": new_end,
                    }
                )

        return repaired, repair_count, repairs

    @classmethod
    def _parse_crispasr_qwen3_json_segments(cls, text: str) -> list[dict[str, Any]]:
        try:
            payload = json.loads(str(text or ""))
        except Exception:
            return []
        transcription = payload.get("transcription") if isinstance(payload, dict) else None
        if not isinstance(transcription, list):
            return []

        parsed: list[dict[str, Any]] = []
        for entry in transcription:
            if not isinstance(entry, dict):
                continue
            offsets = entry.get("offsets") if isinstance(entry.get("offsets"), dict) else {}
            start_ms = cls._coerce_finite_seconds(offsets.get("from"))
            end_ms = cls._coerce_finite_seconds(offsets.get("to"))
            start = start_ms / 1000.0 if start_ms is not None else None
            end = end_ms / 1000.0 if end_ms is not None else None
            raw_words = entry.get("words")
            word_values: list[float] = []
            if isinstance(raw_words, list):
                for word in raw_words:
                    if not isinstance(word, dict):
                        continue
                    for key in ("t0", "t1"):
                        value = cls._coerce_finite_seconds(word.get(key))
                        if value is not None:
                            word_values.append(value)
            max_offset_ms = max([value for value in (start_ms, end_ms) if value is not None], default=0.0)
            max_word_value = max(word_values, default=0.0)
            if max_word_value and max_offset_ms and max_word_value <= (max_offset_ms / 1000.0) * 1.25:
                word_scale = 1.0
            elif max_word_value and max_offset_ms and max_word_value * 10 <= max_offset_ms * 1.25:
                word_scale = 0.01
            else:
                word_scale = 0.01
            words: list[dict[str, Any]] = []
            raw_words_for_repair: list[dict[str, Any]] = []
            if isinstance(raw_words, list):
                for word in raw_words:
                    if not isinstance(word, dict):
                        continue
                    word_text = str(word.get("text") or "").strip()
                    t0 = cls._coerce_finite_seconds(word.get("t0"))
                    t1 = cls._coerce_finite_seconds(word.get("t1"))
                    if not word_text or t0 is None or t1 is None:
                        continue
                    word_start = max(0.0, t0 * word_scale)
                    word_end = max(word_start, t1 * word_scale)
                    words.append({"start": word_start, "end": word_end, "text": word_text})
                    raw_words_for_repair.append({"start": word_start, "end": word_end, "text": word_text})
            words = cls._repair_crispasr_json_word_timings(words, segment_start=start, segment_end=end)
            segment: dict[str, Any] = {
                "text": str(entry.get("text") or "").strip(),
                "qwen3_json_words": words,
                "qwen3_json_raw_words": raw_words_for_repair,
                "words": words,
            }
            if start is not None:
                segment["start"] = start
            if end is not None:
                segment["end"] = max(start if start is not None else 0.0, end)
            parsed.append(segment)
        return parsed

    @classmethod
    def _repair_crispasr_json_word_timings(
        cls,
        words: list[dict[str, Any]],
        *,
        segment_start: float | None = None,
        segment_end: float | None = None,
    ) -> list[dict[str, Any]]:
        repaired: list[dict[str, Any]] = []
        raw_times: list[tuple[float | None, float | None]] = [
            (cls._coerce_finite_seconds(word.get("start")), cls._coerce_finite_seconds(word.get("end")))
            for word in words
        ]
        previous_end = cls._coerce_finite_seconds(segment_start)
        segment_limit = cls._coerce_finite_seconds(segment_end)
        for index, word in enumerate(words):
            text = str(word.get("text") or "").strip()
            if not text:
                continue
            start, end = raw_times[index]
            if start is None:
                start = previous_end if previous_end is not None else 0.0
            if previous_end is not None and start < previous_end:
                start = previous_end

            next_start = None
            for later_start, _ in raw_times[index + 1 :]:
                if later_start is not None and later_start > start:
                    next_start = later_start
                    break

            if end is None or end <= start:
                if next_start is not None:
                    end = next_start
                elif segment_limit is not None and segment_limit > start:
                    end = min(segment_limit, start + 0.08)
                else:
                    end = start + 0.01
            if end <= start:
                end = start + 0.001

            repaired.append({"start": start, "end": end, "text": text})
            previous_end = end
        return repaired

    @classmethod
    def _fuse_qwen3_srt_segments_with_json_timeline(
        cls,
        segments: list[dict[str, Any]],
        json_segments: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], list[str]]:
        srt_segments = [dict(segment or {}) for segment in segments]
        _ = json_segments
        return srt_segments, ["Qwen3-ASR JSON full 词流融合已临时禁用，已回退到 CrispASR SRT 时间轴。"]

    @classmethod
    def _load_crispasr_qwen3_json_segments(
        cls,
        *,
        work_dir: Path,
        output_stem: Path,
        raw_output: str = "",
    ) -> list[dict[str, Any]]:
        candidates: list[Path] = [
            output_stem.with_suffix(".json"),
            output_stem.with_name(f"{output_stem.name}_json.json"),
            output_stem.with_name(f"{output_stem.name}_full.json"),
        ]
        candidates.extend(sorted(work_dir.glob("*_json.json")))
        candidates.extend(sorted(work_dir.glob("*.json")))
        candidates.extend(sorted(work_dir.rglob("*.json")))

        seen: set[Path] = set()
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
            except Exception:
                resolved = candidate
            if resolved in seen or not candidate.exists() or not candidate.is_file():
                continue
            seen.add(resolved)
            try:
                parsed = cls._parse_crispasr_qwen3_json_segments(candidate.read_text(encoding="utf-8", errors="ignore"))
            except Exception:
                continue
            if parsed:
                return parsed

        raw = str(raw_output or "").strip()
        if raw.startswith("{") or raw.startswith("["):
            parsed = cls._parse_crispasr_qwen3_json_segments(raw)
            if parsed:
                return parsed
        return []

    @classmethod
    def _repair_qwen3_srt_segments_from_json_words(
        cls,
        segments: list[dict[str, Any]],
        json_segments: list[dict[str, Any]],
        *,
        audio_duration_sec: float | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        original = [dict(segment or {}) for segment in segments if str((segment or {}).get("text", "")).strip()]
        words: list[dict[str, Any]] = []
        for json_segment in json_segments or []:
            json_words = (
                json_segment.get("qwen3_json_raw_words")
                or json_segment.get("qwen3_json_words")
                or json_segment.get("words")
                or []
            )
            for word in json_words:
                text = str(word.get("text") or word.get("word") or "").strip()
                start = cls._coerce_finite_seconds(word.get("start"))
                end = cls._coerce_finite_seconds(word.get("end"))
                if not text or start is None or end is None:
                    continue
                words.append({"text": text, "start": start, "end": end})

        report: dict[str, Any] = {
            "kind": "qwen3_json_srt_repair_report",
            "entries_before": len(original),
            "entries_after": len(original),
            "json_words": len(words),
            "entries_matched_to_json_words": 0,
            "unmatched_entries": [],
            "zero_or_negative_before": cls._count_timing_zero_or_negative(original),
            "zero_or_negative_after": cls._count_timing_zero_or_negative(original),
            "overlap_before": cls._count_timing_overlaps(original),
            "overlap_after": cls._count_timing_overlaps(original),
            "out_of_audio_after": cls._count_timing_out_of_audio(original, audio_duration_sec),
            "merge_short_punct_ms": int(round(QWEN3_JSON_REPAIR_SHORT_PUNCT_SEC * 1000)),
        }
        if not original or not words:
            return original, report

        stream_chars: list[str] = []
        char_to_word: list[int] = []
        for word_index, word in enumerate(words):
            raw_word_text = str(word.get("text") or "")
            if not raw_word_text:
                continue
            for char in raw_word_text:
                stream_chars.append(char)
                char_to_word.append(word_index)
        stream = "".join(stream_chars)
        if not stream or not char_to_word:
            return original, report

        matched_count = 0
        unmatched: list[int] = []
        cursor = 0
        json_timed: list[dict[str, Any]] = []
        for number, segment in enumerate(original, 1):
            item = dict(segment)
            text = str(item.get("text") or "").strip()
            needle = cls._qwen3_srt_repair_compact_text(text)
            if not needle:
                matched_count += 1
                item["degenerate_json_span"] = True
                item["qwen3_json_srt_repaired"] = True
                item["preserve_timing_boundaries"] = True
                json_timed.append(item)
                continue

            found = stream.find(needle, cursor)
            if found < 0:
                unmatched.append(number)
                json_timed.append(item)
                continue

            end_pos = found + len(needle)
            word_indexes = sorted(set(char_to_word[found:end_pos]))
            span_words = [dict(words[index]) for index in word_indexes if 0 <= index < len(words)]
            if not span_words:
                unmatched.append(number)
                json_timed.append(item)
                continue

            start = min(float(word["start"]) for word in span_words)
            end = max(float(word["end"]) for word in span_words)
            item["start"] = start
            item["end"] = end
            item["words"] = span_words
            item["degenerate_json_span"] = end <= start
            item["qwen3_json_srt_repaired"] = True
            item["preserve_timing_boundaries"] = True
            json_timed.append(item)
            cursor = max(cursor, end_pos)
            matched_count += 1

        final_segments, repair_changes = cls._finalize_qwen3_json_repaired_segments(
            original,
            json_timed,
            audio_duration_sec=audio_duration_sec,
        )
        report.update(
            {
                "entries_after": len(final_segments),
                "entries_matched_to_json_words": matched_count,
                "unmatched_entries": unmatched,
                "zero_or_negative_after": cls._count_timing_zero_or_negative(final_segments),
                "overlap_after": cls._count_timing_overlaps(final_segments),
                "out_of_audio_after": cls._count_timing_out_of_audio(final_segments, audio_duration_sec),
            }
        )
        if repair_changes:
            report["changes"] = repair_changes
        for segment in final_segments:
            segment["qwen3_json_srt_repaired"] = True
            segment["preserve_timing_boundaries"] = True
        return final_segments, report

    @staticmethod
    def _qwen3_srt_repair_compact_text(value: str) -> str:
        return re.sub(r"\s+", "", str(value or ""))

    @classmethod
    def _qwen3_srt_repair_is_punctuation_only(cls, value: str) -> bool:
        compact = cls._qwen3_srt_repair_compact_text(value)
        punctuation = set("，。！？；：、“”‘’\"'（）()[]{}《》【】「」『』…—-,.!?;:")
        return bool(compact) and all(char in punctuation for char in compact)

    @classmethod
    def _finalize_qwen3_json_repaired_segments(
        cls,
        original: list[dict[str, Any]],
        entries: list[dict[str, Any]],
        *,
        audio_duration_sec: float | None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        final: list[dict[str, Any]] = []
        repairs: list[dict[str, Any]] = []
        audio_duration = cls._coerce_finite_seconds(audio_duration_sec)

        for index, entry in enumerate(entries):
            item = dict(entry)
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            original_item = original[index] if index < len(original) else item
            start = cls._coerce_finite_seconds(item.get("start"))
            end = cls._coerce_finite_seconds(item.get("end"))
            if start is None:
                start = cls._coerce_finite_seconds(original_item.get("start")) or 0.0
            if end is None:
                end = cls._coerce_finite_seconds(original_item.get("end"))
                if end is None:
                    end = start
            if audio_duration is not None:
                start = min(max(0.0, start), audio_duration)
                end = min(max(0.0, end), audio_duration)

            compact = cls._qwen3_srt_repair_compact_text(text)
            near_audio_end = audio_duration is not None and audio_duration - start <= 0.5
            should_merge_degenerate = bool(final) and (
                cls._qwen3_srt_repair_is_punctuation_only(text)
                or len(compact) <= 12
                or near_audio_end
                or bool(item.get("degenerate_json_span"))
            )
            if end <= start:
                if should_merge_degenerate:
                    cls._append_qwen3_repaired_segment_text(final[-1], text)
                    cls._append_qwen3_repaired_segment_words(final[-1], item)
                    repairs.append(
                        {
                            "kind": "qwen3_quote_fragment_merge"
                            if cls._qwen3_srt_repair_is_punctuation_only(text)
                            else "qwen3_zero_duration_merge",
                            "moved_text": text,
                            "direction": "previous",
                        }
                    )
                    continue
                end = start + 0.3
                if audio_duration is not None:
                    end = min(end, audio_duration)
                if end <= start and final:
                    cls._append_qwen3_repaired_segment_text(final[-1], text)
                    cls._append_qwen3_repaired_segment_words(final[-1], item)
                    repairs.append({"kind": "qwen3_zero_duration_merge", "moved_text": text, "direction": "previous"})
                    continue

            if final:
                previous_end = cls._coerce_finite_seconds(final[-1].get("end"))
                if previous_end is not None and start < previous_end:
                    start = previous_end
                    if end <= start:
                        if len(compact) <= 12:
                            cls._append_qwen3_repaired_segment_text(final[-1], text)
                            cls._append_qwen3_repaired_segment_words(final[-1], item)
                            repairs.append({"kind": "qwen3_overlap_merge", "moved_text": text, "direction": "previous"})
                            continue
                        end = start + 0.3
                        if audio_duration is not None:
                            end = min(end, audio_duration)
                    if end <= start and final:
                        cls._append_qwen3_repaired_segment_text(final[-1], text)
                        cls._append_qwen3_repaired_segment_words(final[-1], item)
                        repairs.append({"kind": "qwen3_overlap_merge", "moved_text": text, "direction": "previous"})
                        continue

            item["start"] = start
            item["end"] = max(start, end)
            item.pop("degenerate_json_span", None)
            final.append(item)

        final, quote_repairs = cls._move_qwen3_leading_closing_quotes(final)
        final, punctuation_repairs = cls._merge_qwen3_short_punctuation_entries(
            final,
            max_duration_sec=QWEN3_JSON_REPAIR_SHORT_PUNCT_SEC,
        )
        repairs.extend(quote_repairs)
        repairs.extend(punctuation_repairs)

        return final, repairs

    @classmethod
    def _move_qwen3_leading_closing_quotes(cls, segments: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        fixed: list[dict[str, Any]] = []
        repairs: list[dict[str, Any]] = []
        for number, segment in enumerate(segments or [], start=1):
            item = dict(segment or {})
            text = str(item.get("text") or "")
            match = QWEN3_JSON_REPAIR_CLOSING_QUOTE_PREFIX_RE.match(text)
            if match and fixed:
                quote_prefix, remainder = match.groups()
                fixed[-1]["text"] = str(fixed[-1].get("text") or "").rstrip() + quote_prefix
                item["text"] = remainder.lstrip()
                repairs.append(
                    {
                        "kind": "qwen3_leading_closing_quote_move",
                        "entry": number,
                        "moved_text": quote_prefix,
                        "direction": "previous",
                    }
                )
            fixed.append(item)
        return fixed, repairs

    @classmethod
    def _merge_qwen3_short_punctuation_entries(
        cls,
        segments: list[dict[str, Any]],
        *,
        max_duration_sec: float,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if max_duration_sec <= 0:
            return [dict(segment or {}) for segment in segments or []], []

        merged: list[dict[str, Any]] = []
        repairs: list[dict[str, Any]] = []
        pending_prefix = ""
        for number, segment in enumerate(segments or [], start=1):
            item = dict(segment or {})
            text = str(item.get("text") or "")
            if pending_prefix:
                item["text"] = pending_prefix + text
                pending_prefix = ""

            start = cls._coerce_finite_seconds(item.get("start"))
            end = cls._coerce_finite_seconds(item.get("end"))
            duration = (end - start) if start is not None and end is not None else 0.0
            original_text = text
            if cls._qwen3_srt_repair_is_punctuation_only(original_text) and duration <= max_duration_sec:
                if merged:
                    cls._append_qwen3_repaired_segment_text(merged[-1], original_text)
                    previous_end = cls._coerce_finite_seconds(merged[-1].get("end"))
                    if end is not None and (previous_end is None or end > previous_end):
                        merged[-1]["end"] = end
                    cls._append_qwen3_repaired_segment_words(merged[-1], item)
                    repairs.append(
                        {
                            "kind": "qwen3_short_punctuation_merge",
                            "entry": number,
                            "moved_text": original_text,
                            "duration_ms": int(round(max(0.0, duration) * 1000)),
                            "direction": "previous",
                        }
                    )
                else:
                    pending_prefix = original_text
                    repairs.append(
                        {
                            "kind": "qwen3_short_punctuation_prefix_queue",
                            "entry": number,
                            "moved_text": original_text,
                            "duration_ms": int(round(max(0.0, duration) * 1000)),
                            "direction": "next",
                        }
                    )
                continue

            merged.append(item)

        if pending_prefix and merged:
            cls._append_qwen3_repaired_segment_text(merged[-1], pending_prefix)
            repairs.append(
                {
                    "kind": "qwen3_short_punctuation_merge",
                    "moved_text": pending_prefix,
                    "direction": "final",
                }
            )

        return merged, repairs

    @classmethod
    def _append_qwen3_repaired_segment_text(cls, target: dict[str, Any], text: str) -> None:
        target["text"] = cls._join_tokens_for_language(str(target.get("text", "")).strip(), str(text or "").strip())

    @staticmethod
    def _append_qwen3_repaired_segment_words(target: dict[str, Any], item: dict[str, Any]) -> None:
        words = list(item.get("words") or [])
        if not words:
            return
        target["words"] = list(target.get("words") or []) + words

    @classmethod
    def _count_timing_zero_or_negative(cls, segments: list[dict[str, Any]]) -> int:
        count = 0
        for segment in segments or []:
            start = cls._coerce_finite_seconds(segment.get("start"))
            end = cls._coerce_finite_seconds(segment.get("end"))
            if start is not None and end is not None and end <= start:
                count += 1
        return count

    @classmethod
    def _count_timing_overlaps(cls, segments: list[dict[str, Any]]) -> int:
        count = 0
        for previous, current in zip(segments or [], (segments or [])[1:]):
            prev_end = cls._coerce_finite_seconds(previous.get("end"))
            cur_start = cls._coerce_finite_seconds(current.get("start"))
            if prev_end is not None and cur_start is not None and cur_start < prev_end:
                count += 1
        return count

    @classmethod
    def _count_timing_out_of_audio(cls, segments: list[dict[str, Any]], audio_duration_sec: float | None) -> int:
        audio_duration = cls._coerce_finite_seconds(audio_duration_sec)
        if audio_duration is None:
            return 0
        count = 0
        for segment in segments or []:
            start = cls._coerce_finite_seconds(segment.get("start"))
            end = cls._coerce_finite_seconds(segment.get("end"))
            if start is not None and start < 0:
                count += 1
                continue
            if end is not None and end > audio_duration:
                count += 1
        return count

    @classmethod
    def _attach_qwen3_json_words_to_segments(
        cls,
        segments: list[dict[str, Any]],
        json_segments: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        if not segments or not json_segments:
            return [dict(segment or {}) for segment in segments]

        flat_words: list[dict[str, Any]] = []
        stream_chars: list[str] = []
        char_to_word: list[int] = []
        for json_segment in json_segments:
            for word in json_segment.get("qwen3_json_words") or []:
                text = str(word.get("text") or "")
                normalized = cls._normalize_alignment_text(text)
                if not normalized:
                    continue
                word_index = len(flat_words)
                flat_words.append(dict(word))
                for char in normalized:
                    stream_chars.append(char)
                    char_to_word.append(word_index)
        stream = "".join(stream_chars)
        cursor = 0
        attached: list[dict[str, Any]] = []

        for segment in segments:
            item = dict(segment or {})
            text = str(item.get("text") or "").strip()
            start = cls._coerce_finite_seconds(item.get("start"))
            end = cls._coerce_finite_seconds(item.get("end"))
            matched_words: list[dict[str, Any]] = []
            if start is not None and end is not None and end > start:
                low = max(0.0, start - 0.08)
                high = end + 0.08
                for word in flat_words:
                    word_start = cls._coerce_finite_seconds(word.get("start"))
                    word_end = cls._coerce_finite_seconds(word.get("end"))
                    if word_start is None or word_end is None:
                        continue
                    midpoint = (word_start + word_end) / 2.0
                    if low <= midpoint <= high and word_end > word_start:
                        matched_words.append(dict(word))
            if not matched_words and text and stream and char_to_word:
                normalized = cls._normalize_alignment_text(text)
                if normalized:
                    found = stream.find(normalized, cursor)
                    if found < 0:
                        found = stream.find(normalized)
                    if found >= 0:
                        end_pos = found + len(normalized)
                        word_indexes = sorted(set(char_to_word[found:end_pos]))
                        matched_words = [
                            dict(flat_words[index])
                            for index in word_indexes
                            if 0 <= index < len(flat_words)
                            and cls._coerce_finite_seconds(flat_words[index].get("end")) is not None
                            and cls._coerce_finite_seconds(flat_words[index].get("start")) is not None
                            and float(flat_words[index]["end"]) > float(flat_words[index]["start"])
                        ]
                        cursor = max(cursor, end_pos)
            if matched_words:
                item["words"] = matched_words
            attached.append(item)
        return attached

    @classmethod
    def _repair_qwen3_zero_duration_and_overlaps(
        cls,
        segments: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], int, list[dict[str, Any]]]:
        source = [dict(segment or {}) for segment in segments]
        repaired: list[dict[str, Any]] = []
        repairs: list[dict[str, Any]] = []
        quote_openers = set("“\"'‘（([{《【「『")
        quote_closers = set("”\"'’）)]}》】」』")
        punctuation_or_quote = set("，,。.!！？?；;、…“”\"'‘’（）()[]{}《》【】「」『』")
        sentence_end = set("。.!！？?")

        def compact(value: str) -> str:
            return re.sub(r"\s+", "", value)

        def is_punctuation_fragment(value: str) -> bool:
            text = compact(value)
            return bool(text) and all(char in punctuation_or_quote for char in text)

        def is_open_quote_fragment(value: str) -> bool:
            text = compact(value)
            return bool(text) and all(char in quote_openers for char in text)

        def is_closing_quote_fragment(value: str) -> bool:
            text = compact(value)
            if not text:
                return False
            if all(char in quote_closers for char in text):
                return True
            return text[0] in sentence_end and all(char in sentence_end or char in quote_closers for char in text)

        def append_text(target: dict[str, Any], text: str) -> None:
            target["text"] = cls._join_tokens_for_language(str(target.get("text", "")).strip(), text)

        def prepend_text(target: dict[str, Any], text: str) -> None:
            target["text"] = cls._join_tokens_for_language(text, str(target.get("text", "")).strip())

        def merge_words(target: dict[str, Any], item: dict[str, Any], *, prepend: bool = False) -> None:
            target_words = list(target.get("words") or [])
            item_words = list(item.get("words") or [])
            if not item_words:
                return
            target["words"] = item_words + target_words if prepend else target_words + item_words

        index = 0
        while index < len(source):
            item = dict(source[index])
            text = str(item.get("text", "") or "").strip()
            if not text:
                index += 1
                continue
            start = cls._coerce_finite_seconds(item.get("start"))
            end = cls._coerce_finite_seconds(item.get("end"))
            if start is None:
                start = 0.0
            if end is None:
                end = start

            if is_open_quote_fragment(text) and index + 1 < len(source):
                prepend_text(source[index + 1], text)
                merge_words(source[index + 1], item, prepend=True)
                repairs.append({"kind": "qwen3_quote_fragment_merge", "moved_text": text, "direction": "next"})
                index += 1
                continue

            zero_or_negative = end <= start
            previous = repaired[-1] if repaired else None
            previous_end = cls._coerce_finite_seconds(previous.get("end")) if previous else None
            gap_to_previous = start - previous_end if previous_end is not None else None
            should_merge_previous = previous is not None and (
                is_punctuation_fragment(text)
                or is_closing_quote_fragment(text)
                or (zero_or_negative and len(compact(text)) <= 8 and gap_to_previous is not None and gap_to_previous <= 0.35)
            )
            if should_merge_previous and previous is not None:
                append_text(previous, text)
                merge_words(previous, item)
                if end > start and not is_punctuation_fragment(text):
                    previous["end"] = max(float(previous.get("end") or start), end)
                repairs.append(
                    {
                        "kind": "qwen3_quote_fragment_merge" if is_punctuation_fragment(text) else "qwen3_zero_duration_merge",
                        "moved_text": text,
                        "direction": "previous",
                    }
                )
                index += 1
                continue

            if previous_end is not None and start < previous_end:
                before_start = start
                start = previous_end + 0.001
                item["start"] = start
                repairs.append(
                    {
                        "kind": "qwen3_overlap_shift",
                        "text": text,
                        "start_before": before_start,
                        "start_after": start,
                    }
                )
            if end <= start:
                word_range = cls._word_time_range(item.get("words"))
                if word_range and word_range[1] > word_range[0]:
                    end = max(start + 0.001, word_range[1] + TIMELINE_WORD_PADDING_SEC)
                else:
                    end = start + min(0.8, max(0.16, cls._estimate_speaking_seconds(text)))
                item["end"] = end
                repairs.append({"kind": "qwen3_min_duration", "text": text, "start": start, "end_after": end})
            repaired.append(item)
            index += 1

        return repaired, len(repairs), repairs

    @classmethod
    def _split_qwen3_long_segments_by_weak_punctuation(
        cls,
        segments: list[dict[str, Any]],
        *,
        max_line_length: int | None,
    ) -> tuple[list[dict[str, Any]], int, list[dict[str, Any]]]:
        if max_line_length is None:
            return [dict(segment or {}) for segment in segments], 0, []
        try:
            limit = min(50, max(2, int(max_line_length or 20)))
        except Exception:
            return [dict(segment or {}) for segment in segments], 0, []

        output: list[dict[str, Any]] = []
        repairs: list[dict[str, Any]] = []
        split_count = 0
        for segment in segments:
            item = dict(segment or {})
            text = str(item.get("text", "") or "").strip()
            if not text or cls._preview_line_text_length(text) <= limit:
                output.append(item)
                continue
            parts = [part for part in cls._split_preview_text_by_natural_breaks(text, limit) if part.strip()]
            if parts and text[-1:] in "。！？!?" and "".join(parts) != text and "".join(parts) + text[-1] == text:
                parts[-1] = cls._join_tokens_for_language(parts[-1], text[-1])
            if len(parts) <= 1:
                output.append(item)
                continue

            start = cls._coerce_finite_seconds(item.get("start"))
            end = cls._coerce_finite_seconds(item.get("end"))
            if start is None or end is None or end <= start:
                output.append(item)
                continue
            duration = max(0.001, end - start)
            words = cls._normalize_word_items(item.get("words"))
            cursor = 0
            consumed_chars = 0
            total_chars = sum(max(1, cls._preview_line_text_length(part)) for part in parts)
            created: list[dict[str, Any]] = []
            for index, part in enumerate(parts):
                part_chars = max(1, cls._preview_line_text_length(part))
                part_item = {**item, "text": part}
                part_words: list[dict[str, Any]] = []
                if words:
                    target_chars = consumed_chars + part_chars
                    word_chars = 0
                    while cursor < len(words) and (not part_words or word_chars < part_chars):
                        word = words[cursor]
                        word_len = max(1, cls._preview_line_text_length(str(word.get("text") or "")))
                        part_words.append(word)
                        word_chars += word_len
                        cursor += 1
                        if consumed_chars + word_chars >= target_chars and index + 1 < len(parts):
                            break
                    if part_words:
                        part_item["words"] = part_words
                        part_item["start"] = max(start, float(part_words[0]["start"]) - TIMELINE_WORD_PADDING_SEC)
                        part_item["end"] = min(end, float(part_words[-1]["end"]) + TIMELINE_WORD_PADDING_SEC)
                if not part_words:
                    part_start = start + duration * consumed_chars / max(1, total_chars)
                    next_chars = consumed_chars + part_chars
                    part_end = start + duration * next_chars / max(1, total_chars)
                    part_item["start"] = part_start
                    part_item["end"] = part_end
                consumed_chars += part_chars
                if created:
                    previous_end = cls._coerce_finite_seconds(created[-1].get("end"))
                    part_start = cls._coerce_finite_seconds(part_item.get("start"))
                    if previous_end is not None and part_start is not None and part_start <= previous_end:
                        part_item["start"] = previous_end + 0.001
                    part_end = cls._coerce_finite_seconds(part_item.get("end"))
                    if part_end is not None and part_end <= float(part_item["start"]):
                        part_item["end"] = float(part_item["start"]) + 0.001
                created.append(part_item)
            if len(created) <= 1:
                output.append(item)
                continue
            output.extend(created)
            split_count += len(created) - 1
            repairs.append({"kind": "qwen3_weak_punctuation_split", "source_text": text, "parts": parts})
        return output, split_count, repairs

    async def _transcribe_crispasr_segments(
        self,
        target: Path,
        *,
        enable_timestamps_override: bool | None = None,
        language_override: str | None = None,
        split_on_punctuation: bool = False,
        max_line_length: int | None = None,
    ) -> tuple[str, list[dict[str, Any]], str]:
        self._last_crispasr_warnings = []
        self._last_crispasr_timeline_repairs = []
        if not self.is_loaded or self._backend != "qwen3_crispasr":
            await self.load_model(self.model_path, self.device, backend="qwen3_crispasr")
        self._validate_crispasr_config()

        exe = str(Path(self.crispasr_exe).expanduser())
        model = str(Path(self.qwen3_model_path).expanduser())
        language = str(language_override or self.qwen3_language or "auto").strip() or "auto"
        threads = int(self.qwen3_threads or 0)
        if enable_timestamps_override is None:
            use_timestamps = bool(self.qwen3_enable_timestamps)
        else:
            use_timestamps = bool(enable_timestamps_override)
        forced_aligner = str(self.qwen3_forced_aligner_model_path or "").strip()
        if use_timestamps and not forced_aligner:
            raise RuntimeError("启用 Qwen3-ASR 时间轴需要配置 Qwen3-ForcedAligner GGUF 模型路径（qwen3_asr_forced_aligner_model_path）。")

        work_dir = Path(tempfile.mkdtemp(prefix="qwen3_asr_", dir=settings.output_dir))
        normalized_wav = work_dir / "input_16k.wav"
        output_stem = work_dir / "output"
        srt_output = output_stem.with_suffix(".srt")
        try:
            cmd_decode = [
                "ffmpeg",
                "-v",
                "error",
                "-nostdin",
                "-y",
                "-i",
                str(target),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(normalized_wav),
            ]
            try:
                await asyncio.to_thread(subprocess.run, cmd_decode, capture_output=True, check=True)
            except FileNotFoundError as exc:
                raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH。") from exc
            except subprocess.CalledProcessError as exc:
                stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
                raise RuntimeError(f"ffmpeg 转码失败：{stderr or exc}") from exc

            cmd = [
                exe,
                "--backend",
                "qwen3",
                "-m",
                model,
                "-f",
                str(normalized_wav),
            ]
            if threads > 0:
                cmd.extend(["-t", str(threads)])
            if language:
                cmd.extend(["-l", language])
            if split_on_punctuation and not use_timestamps:
                cmd.append("--split-on-punct")
            if use_timestamps and forced_aligner:
                forced_aligner_path = Path(forced_aligner).expanduser()
                if not forced_aligner_path.exists() or not forced_aligner_path.is_file():
                    raise RuntimeError(f"Qwen3-ForcedAligner GGUF 模型不存在: {forced_aligner_path}")
                cmd.extend(["-am", str(forced_aligner_path)])
            if use_timestamps:
                cmd.extend(["--vad", "-osrt", "-ojf", "--split-on-punct", "-of", str(output_stem)])

            try:
                proc = await asyncio.to_thread(
                    subprocess.run,
                    cmd,
                    capture_output=True,
                    check=False,
                    text=True,
                    encoding="utf-8",
                    errors="ignore",
                )
            except FileNotFoundError as exc:
                raise RuntimeError(f"未找到 CrispASR 可执行文件：{exe}") from exc

            if proc.returncode != 0:
                message = (proc.stderr or proc.stdout or "").strip()
                raise RuntimeError(f"CrispASR 运行失败（exit={proc.returncode}）：{message or 'unknown error'}")

            raw_output = (proc.stdout or "").strip()
            segments: list[dict[str, Any]] = []
            json_segments: list[dict[str, Any]] = []
            if use_timestamps:
                audio_duration_sec = self._probe_audio_duration_seconds(target)
                preview_diagnostics: dict[str, Any] = {
                    "kind": "qwen3_crispasr_preview_diagnostics",
                    "crispasr_exe": exe,
                    "enable_timestamps": bool(use_timestamps),
                    "has_forced_aligner_arg": "-am" in cmd,
                    "has_vad_arg": "--vad" in cmd,
                    "has_srt_output_arg": "-osrt" in cmd,
                    "has_json_full_output_arg": "-ojf" in cmd,
                    "has_split_on_punct_arg": "--split-on-punct" in cmd,
                    "has_output_stem_arg": "-of" in cmd,
                    "audio_duration_ms": int(round(audio_duration_sec * 1000)) if audio_duration_sec is not None else None,
                    "srt_found": False,
                    "json_found": False,
                }
                if srt_output.exists():
                    srt_text = srt_output.read_text(encoding="utf-8", errors="ignore")
                    segments = self._parse_srt_segments(srt_text)
                json_segments = self._load_crispasr_qwen3_json_segments(
                    work_dir=work_dir,
                    output_stem=output_stem,
                    raw_output=raw_output,
                )
                preview_diagnostics["srt_found"] = bool(srt_output.exists() or segments)
                preview_diagnostics["json_found"] = bool(json_segments)
                self._last_crispasr_timeline_repairs.append(preview_diagnostics)
                if not segments:
                    segments = self._parse_srt_segments(raw_output)
                if not segments:
                    token_segments = self._parse_inline_timestamp_tokens(raw_output)
                    segments = self._merge_timestamp_tokens(token_segments)
                if segments and json_segments:
                    repaired_segments, repair_report = self._repair_qwen3_srt_segments_from_json_words(
                        segments,
                        json_segments,
                        audio_duration_sec=audio_duration_sec,
                    )
                    if repaired_segments and int(repair_report.get("json_words") or 0) > 0:
                        segments = repaired_segments
                        self._last_crispasr_timeline_repairs.append(repair_report)
                        self._last_crispasr_timeline_repairs.extend(repair_report.get("changes") or [])
                        self._last_crispasr_warnings.append(
                            "Qwen3-ASR 已使用 JSON full 词级时间轴修复 SRT 时间轴。"
                        )
                    else:
                        segments, fusion_warnings = self._fuse_qwen3_srt_segments_with_json_timeline(segments, json_segments)
                        self._last_crispasr_warnings.extend(fusion_warnings)
                elif segments:
                    self._last_crispasr_warnings.append("Qwen3-ASR 未找到 JSON full 时间轴，已回退到 CrispASR SRT 时间轴。")
                raw_text = "\n".join(seg.get("text", "").strip() for seg in segments if seg.get("text", "").strip()).strip()
                if not raw_text:
                    raw_text = raw_output.strip()
            else:
                audio_duration_sec = self._probe_audio_duration_seconds(target)
                self._last_crispasr_timeline_repairs.append(
                    {
                        "kind": "qwen3_crispasr_preview_diagnostics",
                        "crispasr_exe": exe,
                        "enable_timestamps": bool(use_timestamps),
                        "has_forced_aligner_arg": "-am" in cmd,
                        "has_vad_arg": "--vad" in cmd,
                        "has_srt_output_arg": "-osrt" in cmd,
                        "has_json_full_output_arg": "-ojf" in cmd,
                        "has_split_on_punct_arg": "--split-on-punct" in cmd,
                        "has_output_stem_arg": "-of" in cmd,
                        "audio_duration_ms": int(round(audio_duration_sec * 1000)) if audio_duration_sec is not None else None,
                        "srt_found": False,
                        "json_found": False,
                    }
                )
                raw_text = raw_output.strip()
                # CrispASR sometimes emits inline timestamp tokens even when -osrt is not explicitly used.
                # Always try to parse/merge them so alignments remain usable for speaker labeling and preview.
                token_segments = self._parse_inline_timestamp_tokens(raw_output)
                if token_segments:
                    segments = self._merge_timestamp_tokens(token_segments)
                    merged_text = "\n".join(seg.get("text", "").strip() for seg in segments if seg.get("text", "").strip()).strip()
                    if merged_text:
                        raw_text = merged_text

            if not raw_text and segments:
                raw_text = "\n".join(seg.get("text", "").strip() for seg in segments if seg.get("text", "").strip()).strip()
            if not raw_text:
                raise RuntimeError("CrispASR 输出为空。")
            if not segments:
                segments = [{"start": None, "end": None, "text": raw_text}]
            return raw_text, segments, "qwen3_crispasr"
        finally:
            try:
                for path in work_dir.iterdir():
                    if path.is_file():
                        path.unlink(missing_ok=True)
            except Exception:
                pass
            try:
                work_dir.rmdir()
            except Exception:
                pass

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
        val = (backend or "").strip().lower()
        if val in {"", WHISPER_BACKEND}:
            return WHISPER_BACKEND
        if val in QWEN3_BACKEND_ALIASES:
            return QWEN3_CRISPASR_BACKEND
        return val

    @classmethod
    def _is_qwen3_backend(cls, backend: str | None) -> bool:
        return cls._normalize_backend(backend) == QWEN3_CRISPASR_BACKEND

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
