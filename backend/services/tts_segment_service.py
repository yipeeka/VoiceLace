from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
import wave

from backend.engine.waveform_peaks import build_peaks_payload, compute_file_sha256
from backend.models import SegmentAsset
from backend.services.tts_path_service import to_output_relpath


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
    if can_reuse and project_asset_path is not None:
        shutil.copyfile(project_asset_path, segment_path)
        reused = True
    elif cache_hit:
        shutil.copyfile(cached_path, segment_path)
    else:
        await tts_engine.synthesize_to_file(
            segment.text,
            segment_path,
            preset,
            config,
            tts_overrides=normalized_overrides,
        )
        if segment_path.exists() and segment_path.stat().st_size > 0:
            shutil.copyfile(segment_path, cached_path)
        generated = 1

    try:
        with wave.open(str(segment_path), "rb") as segment_wav:
            frame_rate = segment_wav.getframerate()
            frame_count = segment_wav.getnframes()
            duration_ms = int((frame_count / frame_rate) * 1000)
            combined_frames.extend(segment_wav.readframes(frame_count))
    except Exception:
        if cache_hit:
            await tts_engine.synthesize_to_file(
                segment.text,
                segment_path,
                preset,
                config,
                tts_overrides=normalized_overrides,
            )
            if segment_path.exists() and segment_path.stat().st_size > 0:
                shutil.copyfile(segment_path, cached_path)
            with wave.open(str(segment_path), "rb") as segment_wav:
                frame_rate = segment_wav.getframerate()
                frame_count = segment_wav.getnframes()
                duration_ms = int((frame_count / frame_rate) * 1000)
                combined_frames.extend(segment_wav.readframes(frame_count))
            cache_hit = False
            generated = 1
        else:
            raise

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
        "audio_url": f"/api/v1/tts/synthesize/{task_id}/audio/{segment.id}",
        "status": "done",
        "duration_ms": duration_ms,
        "cached": bool(cache_hit),
        "reused": reused,
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
