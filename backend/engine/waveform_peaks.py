from __future__ import annotations

import hashlib
from pathlib import Path
import wave


def compute_file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def _to_int16(sample: int, width: int) -> int:
    if width == 2:
        if sample > 32767:
            return 32767
        if sample < -32768:
            return -32768
        return sample
    if width == 1:
        return (sample - 128) * 256
    # Fallback for unusual sample widths.
    max_val = (1 << (width * 8 - 1)) - 1
    min_val = -(1 << (width * 8 - 1))
    scaled = int((sample / max(max_val, 1)) * 32767)
    if scaled > 32767:
        return 32767
    if scaled < -32768:
        return -32768
    if sample < min_val:
        return -32768
    return scaled


def _iter_mono_int16_samples(wav_file: wave.Wave_read):
    sample_width = wav_file.getsampwidth()
    channels = wav_file.getnchannels()
    frame_count = wav_file.getnframes()
    chunk_size = 4096
    frames_left = frame_count
    while frames_left > 0:
        to_read = min(chunk_size, frames_left)
        raw = wav_file.readframes(to_read)
        if not raw:
            break
        frame_bytes = sample_width * channels
        for i in range(0, len(raw), frame_bytes):
            frame = raw[i:i + frame_bytes]
            if len(frame) < frame_bytes:
                continue
            acc = 0
            for ch in range(channels):
                offset = ch * sample_width
                sample_bytes = frame[offset:offset + sample_width]
                if sample_width == 1:
                    val = int.from_bytes(sample_bytes, byteorder="little", signed=False)
                else:
                    val = int.from_bytes(sample_bytes, byteorder="little", signed=True)
                acc += _to_int16(val, sample_width)
            yield int(acc / max(channels, 1))
        frames_left -= to_read


def _build_minmax_levels(samples: list[int], bins: int) -> list[int]:
    if bins <= 0:
        return []
    total = len(samples)
    if total <= 0:
        return [0, 0] * bins
    result: list[int] = []
    for idx in range(bins):
        start = int(idx * total / bins)
        end = int((idx + 1) * total / bins)
        if end <= start:
            end = min(total, start + 1)
        window = samples[start:end]
        if not window:
            result.extend([0, 0])
            continue
        result.extend([min(window), max(window)])
    return result


def build_peaks_payload(
    *,
    wav_path: Path,
    bins: int | None = None,
    levels: list[int] | None = None,
) -> dict:
    with wave.open(str(wav_path), "rb") as wav_file:
        frame_rate = wav_file.getframerate()
        channels = wav_file.getnchannels()
        frame_count = wav_file.getnframes()
        duration_ms = int((frame_count / frame_rate) * 1000) if frame_rate else 0
        samples = list(_iter_mono_int16_samples(wav_file))

    level_bins = []
    if levels:
        level_bins = sorted({int(v) for v in levels if int(v) > 0})
    elif bins and bins > 0:
        level_bins = [int(bins)]
    else:
        level_bins = [96]

    level_map = {}
    for level in level_bins:
        level_map[str(level)] = _build_minmax_levels(samples, level)

    primary = level_bins[0]
    return {
        "version": 1,
        "format": "minmax_i16",
        "duration_ms": duration_ms,
        "sample_rate": frame_rate,
        "channels": channels,
        "bins": primary,
        "levels": level_map,
    }

