from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import wave

from backend.engine.waveform_peaks import build_peaks_payload, compute_file_sha256
from backend.models import SegmentAsset
from backend.services.tts_path_service import to_output_relpath


def _read_wav_info(path: Path) -> dict:
    with wave.open(str(path), "rb") as segment_wav:
        frame_rate = segment_wav.getframerate()
        frame_count = segment_wav.getnframes()
        duration_ms = int((frame_count / frame_rate) * 1000) if frame_rate else 0
        frames = segment_wav.readframes(frame_count)
    return {
        "frame_rate": frame_rate,
        "frame_count": frame_count,
        "duration_ms": duration_ms,
        "frames": frames,
        "has_signal": any(byte != 0 for byte in frames),
    }


def _allows_silent_output(tts_backend: str) -> bool:
    return (tts_backend or "").strip().lower() == "mock"


async def _generate_segment_audio(
    *,
    tts_engine,
    segment,
    segment_path: Path,
    preset,
    config,
    normalized_overrides: dict,
) -> dict:
    try:
        await tts_engine.synthesize_to_file(
            segment.text,
            segment_path,
            preset,
            config,
            tts_overrides=normalized_overrides,
            non_verbal=segment.non_verbal,
            emotion=segment.emotion,
        )
    except TypeError as exc:
        # Keep backward compatibility with test doubles / older engines that
        # have not added non_verbal/emotion kwargs yet.
        if "unexpected keyword argument" not in str(exc):
            raise
        await tts_engine.synthesize_to_file(
            segment.text,
            segment_path,
            preset,
            config,
            tts_overrides=normalized_overrides,
        )
    return _read_wav_info(segment_path)


async def process_synthesis_segment(
    *,
    tts_engine,
    segment,
    segment_path: Path,
    preset,
    config,
    normalized_overrides: dict,
    cached_path: Path,
    cache_hit: bool,
    can_reuse: bool,
    project_asset_path: Path | None,
    rebuild_full: bool,
    index: int,
    total: int,
    combined_frames: bytearray,
    sample_rate: int,
    project_segments_dir: Path,
    project_segment_waveforms_dir: Path,
    output_dir: Path,
    fingerprint: str,
    preset_id: str | None,
    preset_hash: str,
    config_hash: str,
    tts_backend: str,
    tts_model_path: str,
    task_id: str,
    gap_duration_ms: int,
) -> dict:
    reused = False
    generated = 0
    source = "generated"
    if can_reuse and project_asset_path is not None:
        shutil.copyfile(project_asset_path, segment_path)
        reused = True
        source = "reused"
    elif cache_hit:
        shutil.copyfile(cached_path, segment_path)
        source = "cache"
    else:
        wav_info = await _generate_segment_audio(
            tts_engine=tts_engine,
            segment=segment,
            segment_path=segment_path,
            preset=preset,
            config=config,
            normalized_overrides=normalized_overrides,
        )
        if wav_info["has_signal"] and segment_path.exists() and segment_path.stat().st_size > 0:
            shutil.copyfile(segment_path, cached_path)
        generated = 1

    try:
        if generated:
            wav_info
        else:
            wav_info = _read_wav_info(segment_path)
    except Exception:
        if cache_hit or reused:
            wav_info = await _generate_segment_audio(
                tts_engine=tts_engine,
                segment=segment,
                segment_path=segment_path,
                preset=preset,
                config=config,
                normalized_overrides=normalized_overrides,
            )
            if wav_info["has_signal"] and segment_path.exists() and segment_path.stat().st_size > 0:
                shutil.copyfile(segment_path, cached_path)
            cache_hit = False
            reused = False
            generated = 1
            source = "generated"
        else:
            raise

    if (cache_hit or reused) and not wav_info["has_signal"]:
        # Cached/reused silent WAVs make UI look successful while actually producing no audio.
        # Force one regeneration with current backend/model and refresh cache with valid output.
        wav_info = await _generate_segment_audio(
            tts_engine=tts_engine,
            segment=segment,
            segment_path=segment_path,
            preset=preset,
            config=config,
            normalized_overrides=normalized_overrides,
        )
        if wav_info["has_signal"] and segment_path.exists() and segment_path.stat().st_size > 0:
            shutil.copyfile(segment_path, cached_path)
        cache_hit = False
        reused = False
        generated = 1
        source = "generated"

    expected_backend = (tts_backend or "").strip().lower()
    runtime_backend = (getattr(tts_engine, "backend_name", tts_backend) or "").strip().lower()
    runtime_error = (getattr(tts_engine, "last_error", "") or "").strip()

    if expected_backend and expected_backend != "mock" and runtime_backend == "mock":
        detail = runtime_error or "未知错误"
        raise RuntimeError(
            f"TTS 后端从 {expected_backend} 降级为 mock，导致无法正常合成：{detail}"
        )

    silent_audio = not wav_info["has_signal"]
    if silent_audio and generated and not _allows_silent_output(runtime_backend or expected_backend):
        detail_suffix = f" 最近错误: {runtime_error}" if runtime_error else ""
        backend_text = runtime_backend or expected_backend or "unknown"
        raise RuntimeError(
            "TTS 生成了静音音频，请检查 TTS 模型、参考音频或声音预设配置后重试。"
            f" backend={backend_text}, segment_id={segment.id}.{detail_suffix}"
        )

    frame_rate = int(wav_info["frame_rate"])
    frame_count = int(wav_info["frame_count"])
    duration_ms = int(wav_info["duration_ms"])
    combined_frames.extend(wav_info["frames"])

    if rebuild_full and index < total - 1:
        # Use the actual frame rate read from the WAV, not the caller-supplied sample_rate,
        # to avoid mismatches when e.g. different backends produce different rates.
        gap_frames = max(1, int(frame_rate * (gap_duration_ms / 1000)))
        combined_frames.extend(b"\x00\x00" * gap_frames)

    project_segment_path = project_segments_dir / f"{segment.id}.wav"
    shutil.copyfile(segment_path, project_segment_path)
    segment_peaks_path = project_segment_waveforms_dir / f"{segment.id}.peaks.json"
    segment_peaks_payload = build_peaks_payload(wav_path=project_segment_path, bins=96)
    segment_peaks_path.write_text(json.dumps(segment_peaks_payload, ensure_ascii=False), encoding="utf-8")
    segment_audio_sha256 = compute_file_sha256(project_segment_path)

    segment_asset = SegmentAsset(
        segment_id=segment.id,
        audio_relpath=to_output_relpath(output_dir=output_dir, path=project_segment_path),
        duration_ms=duration_ms,
        fingerprint=fingerprint,
        source_text=segment.text or "",
        source_speaker=segment.speaker or "",
        source_type=segment.type or "",
        source_emotion=segment.emotion or "",
        source_tts_overrides=normalized_overrides,
        source_voice_preset_id=preset_id,
        source_preset_hash=preset_hash,
        source_config_hash=config_hash,
        source_tts_backend=tts_backend,
        source_tts_model_path=tts_model_path,
        source_task_id=task_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        status="ready",
        peaks_relpath=to_output_relpath(output_dir=output_dir, path=segment_peaks_path),
        peaks_version=int(segment_peaks_payload.get("version", 1)),
        peaks_bins=int(segment_peaks_payload.get("bins", 0)),
        peaks_format=str(segment_peaks_payload.get("format", "minmax_i16")),
        audio_sha256=segment_audio_sha256,
    )

    segment_result = {
        "segment_id": segment.id,
        "index": index,
        "speaker": segment.speaker,
        "text": segment.text,
        "source_start_ms": getattr(segment, "source_start_ms", None),
        "source_end_ms": getattr(segment, "source_end_ms", None),
        "source_duration_ms": getattr(segment, "source_duration_ms", None),
        "audio_url": f"/api/v1/tts/synthesize/{task_id}/audio/{segment.id}",
        "status": "done",
        "duration_ms": duration_ms,
        "cached": bool(cache_hit),
        "reused": reused,
        "source": source,
        "silent_audio": silent_audio,
        "peaks": {
            "format": segment_peaks_payload.get("format", "minmax_i16"),
            "bins": int(segment_peaks_payload.get("bins", 0)),
            "data": (segment_peaks_payload.get("levels", {}) or {}).get(str(segment_peaks_payload.get("bins", 0)), []),
        },
    }
    segment_input = {
        "path": str(segment_path),
        "segment_id": segment.id,
        "speaker": segment.speaker,
        "text": segment.text,
        "source_start_ms": getattr(segment, "source_start_ms", None),
        "source_end_ms": getattr(segment, "source_end_ms", None),
        "source_duration_ms": getattr(segment, "source_duration_ms", None),
    }
    return {
        "segment_result": segment_result,
        "segment_asset": segment_asset,
        "segment_input": segment_input,
        "generated_count_delta": generated,
        "cache_hit": cache_hit,
        "reused": reused,
        "frame_rate": frame_rate,
    }
