from __future__ import annotations

import json
from pathlib import Path
import shutil
import wave

from backend.engine.mixer_engine import MixerEngine, TimelineEntry
from backend.engine.subtitle_gen import timeline_to_lrc, timeline_to_srt
from backend.engine.waveform_peaks import build_peaks_payload
from backend.services.dubbing_timeline_service import is_source_timeline_lock_enabled
from backend.services.tts_path_service import to_output_relpath
from backend.services.tts_stale_service import from_output_relpath


def should_use_source_timeline(*, config, project) -> bool:
    return is_source_timeline_lock_enabled(config=config, project=project)


def timeline_from_segment_results(segment_results: list[dict], gap_ms: int) -> list[TimelineEntry]:
    timeline: list[TimelineEntry] = []
    cursor = 0
    for idx, item in enumerate(segment_results):
        duration_ms = int(item.get("duration_ms") or 0)
        start_ms = cursor
        end_ms = start_ms + duration_ms
        timeline.append(
            TimelineEntry(
                segment_id=str(item.get("segment_id", "")),
                speaker=str(item.get("speaker", "narrator")),
                text=str(item.get("text", "")),
                start_ms=start_ms,
                end_ms=end_ms,
                duration_ms=duration_ms,
            )
        )
        cursor = end_ms
        if idx < len(segment_results) - 1:
            cursor += max(0, int(gap_ms))
    return timeline


def timeline_from_source_segment_results(segment_results: list[dict], gap_ms: int) -> list[TimelineEntry]:
    timeline: list[TimelineEntry] = []
    cursor = 0
    for idx, item in enumerate(segment_results):
        duration_ms = max(0, int(item.get("duration_ms") or 0))
        raw_start = item.get("source_start_ms")
        try:
            parsed_start = max(0, int(raw_start)) if raw_start is not None else None
        except Exception:
            parsed_start = None
        start_ms = parsed_start if parsed_start is not None else cursor
        end_ms = start_ms + duration_ms
        timeline.append(
            TimelineEntry(
                segment_id=str(item.get("segment_id", "")),
                speaker=str(item.get("speaker", "narrator")),
                text=str(item.get("text", "")),
                start_ms=start_ms,
                end_ms=end_ms,
                duration_ms=duration_ms,
            )
        )
        cursor = max(cursor, end_ms)
        if idx < len(segment_results) - 1 and parsed_start is None:
            cursor += max(0, int(gap_ms))
    return timeline


def finalize_rebuild_full(
    *,
    output_dir: Path,
    project_id: str,
    config,
    segment_inputs: list[dict],
    task_segments: dict,
    combined_frames: bytearray,
    sample_rate: int,
    wav_export_path: Path,
    mp3_export_path: Path,
    srt_path: Path,
    lrc_path: Path,
    full_peaks_path: Path,
    use_source_timeline: bool = False,
) -> dict:
    timeline: list[TimelineEntry] | None = None
    try:
        mixed_audio, timeline = MixerEngine().mix_segments(
            segment_inputs=segment_inputs,
            gap_ms=int(config.gap_duration_ms),
            crossfade_ms=30,
            normalize=True,
            target_sample_rate=24000,
            use_source_timeline=bool(use_source_timeline),
        )
        with wav_export_path.open("wb") as wav_out:
            mixed_audio.export(wav_out, format="wav")
    except Exception:
        with wave.open(str(wav_export_path), "wb") as full_wav:
            full_wav.setnchannels(1)
            full_wav.setsampwidth(2)
            full_wav.setframerate(sample_rate)
            full_wav.writeframes(bytes(combined_frames) or b"\x00\x00" * sample_rate)
        if use_source_timeline:
            timeline = timeline_from_source_segment_results(list(task_segments.values()), int(config.gap_duration_ms))
        else:
            timeline = timeline_from_segment_results(list(task_segments.values()), int(config.gap_duration_ms))

    legacy_wav = output_dir / f"{project_id}.wav"
    shutil.copyfile(wav_export_path, legacy_wav)

    full_peaks_payload = build_peaks_payload(wav_path=wav_export_path, levels=[1024, 2048, 4096])
    full_peaks_path.write_text(json.dumps(full_peaks_payload, ensure_ascii=False), encoding="utf-8")

    srt_path.write_text(timeline_to_srt(timeline or []), encoding="utf-8")
    lrc_path.write_text(timeline_to_lrc(timeline or []), encoding="utf-8")
    shutil.copyfile(srt_path, output_dir / f"{project_id}.srt")
    shutil.copyfile(lrc_path, output_dir / f"{project_id}.lrc")

    final_format = "wav"
    mp3_fallback_to_wav = False
    if config.output_format == "mp3":
        converted = False
        try:
            from pydub import AudioSegment

            with wav_export_path.open("rb") as wav_in:
                wav_audio = AudioSegment.from_file(wav_in, format="wav")
            with mp3_export_path.open("wb") as mp3_out:
                wav_audio.export(mp3_out, format="mp3")
            converted = mp3_export_path.exists() and mp3_export_path.stat().st_size > 0
        except Exception:
            converted = False
        if converted:
            final_format = "mp3"
            shutil.copyfile(mp3_export_path, output_dir / f"{project_id}.mp3")
        else:
            mp3_fallback_to_wav = True
    elif mp3_export_path.exists():
        mp3_export_path.unlink(missing_ok=True)

    return {
        "final_format": final_format,
        "mp3_fallback_to_wav": mp3_fallback_to_wav,
    }


def resolve_partial_final_format(
    *,
    output_dir: Path,
    project,
    output_format: str,
) -> str:
    final_format = "wav"
    existing_mp3 = from_output_relpath(output_dir, project.audio_assets.full_mp3_relpath)
    existing_wav = from_output_relpath(output_dir, project.audio_assets.full_wav_relpath)
    if output_format == "mp3" and existing_mp3 and existing_mp3.exists():
        final_format = "mp3"
    elif existing_wav and existing_wav.exists():
        final_format = "wav"
    elif existing_mp3 and existing_mp3.exists():
        final_format = "mp3"
    return final_format


def update_project_audio_assets_after_synthesis(
    *,
    project,
    task_id: str,
    rebuild_full: bool,
    segment_assets: dict,
    output_dir: Path,
    wav_export_path: Path,
    mp3_export_path: Path,
    srt_path: Path,
    lrc_path: Path,
    full_peaks_path: Path,
) -> None:
    if rebuild_full:
        project.audio_assets.latest_task_id = task_id
        project.audio_assets.full_rebuild_required = False
        project.audio_assets.full_wav_relpath = to_output_relpath(output_dir=output_dir, path=wav_export_path)
        project.audio_assets.full_mp3_relpath = (
            to_output_relpath(output_dir=output_dir, path=mp3_export_path) if mp3_export_path.exists() else None
        )
        project.audio_assets.subtitle_srt_relpath = to_output_relpath(output_dir=output_dir, path=srt_path)
        project.audio_assets.subtitle_lrc_relpath = to_output_relpath(output_dir=output_dir, path=lrc_path)
        if full_peaks_path.exists():
            project.audio_assets.full_peaks_relpath = to_output_relpath(output_dir=output_dir, path=full_peaks_path)
            project.audio_assets.full_peaks_version = 1
            project.audio_assets.full_peaks_levels = [1024, 2048, 4096]
        project.audio_assets.segments = segment_assets
    else:
        project.audio_assets.latest_task_id = task_id
        project.audio_assets.segments.update(segment_assets)
    project.audio_assets.archive_schema_version = 2
