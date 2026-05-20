from __future__ import annotations

import math
import subprocess
from pathlib import Path
from typing import Any, Iterable

from backend.models import Project
from backend.persistence import append_project_event, load_project, save_project

from .tts_path_service import project_source_audio_dir, to_output_relpath
from .tts_stale_service import from_output_relpath

SOURCE_AUDIO_BITRATE = "64k"
SOURCE_AUDIO_SAMPLE_RATE = "22050"
SOURCE_AUDIO_WAV_SAMPLE_RATE = "44100"


def _coerce_ms(value: Any) -> int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return int(round(number))


def _segment_source_range(segment: Any) -> tuple[int, int] | None:
    start_ms = _coerce_ms(getattr(segment, "source_start_ms", None))
    end_ms = _coerce_ms(getattr(segment, "source_end_ms", None))
    if end_ms is None:
        duration_ms = _coerce_ms(getattr(segment, "source_duration_ms", None))
        if start_ms is not None and duration_ms is not None:
            end_ms = start_ms + duration_ms
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        return None
    text = str(getattr(segment, "text", "") or "").strip()
    if not text:
        return None
    return start_ms, end_ms


def _dict_source_range(segment: dict[str, Any]) -> tuple[int, int] | None:
    start_ms = _coerce_ms(segment.get("source_start_ms", segment.get("start_ms")))
    end_ms = _coerce_ms(segment.get("source_end_ms", segment.get("end_ms")))
    if end_ms is None:
        duration_ms = _coerce_ms(segment.get("source_duration_ms", segment.get("duration_ms")))
        if start_ms is not None and duration_ms is not None:
            end_ms = start_ms + duration_ms
    if start_ms is None or end_ms is None or end_ms <= start_ms:
        return None
    text = str(segment.get("text") or segment.get("source_text") or "").strip()
    if not text:
        return None
    return start_ms, end_ms


def compute_source_audio_window_from_segments(segments: Iterable[Any]) -> tuple[int, int]:
    ranges: list[tuple[int, int]] = []
    for segment in segments:
        if isinstance(segment, dict):
            item = _dict_source_range(segment)
        else:
            item = _segment_source_range(segment)
        if item:
            ranges.append(item)
    if not ranges:
        raise ValueError("没有可用于裁剪原音频的有效 source 时间轴片段。")
    start_ms = min(start for start, _end in ranges)
    end_ms = max(end for _start, end in ranges)
    if end_ms <= start_ms:
        raise ValueError("source 时间轴范围无效，无法保存原音频。")
    return start_ms, end_ms


def _probe_audio_duration_ms(input_path: Path) -> int | None:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(input_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, check=True)
        duration = float(str(proc.stdout or "").strip())
    except Exception:
        return None
    if not math.isfinite(duration) or duration <= 0:
        return None
    return int(round(duration * 1000))


def _run_ffmpeg_trim_to_mp3(input_path: Path, output_path: Path, *, start_ms: int, end_ms: int) -> None:
    duration_ms = max(1, int(end_ms) - int(start_ms))
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(input_path),
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-t",
        f"{duration_ms / 1000:.3f}",
        "-vn",
        "-ac",
        "1",
        "-ar",
        SOURCE_AUDIO_SAMPLE_RATE,
        "-b:a",
        SOURCE_AUDIO_BITRATE,
        str(output_path),
    ]
    try:
        subprocess.run(cmd, capture_output=True, check=True)
    except FileNotFoundError as exc:
        raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH。") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"ffmpeg 裁剪原音频失败：{stderr or exc}") from exc
    if not output_path.exists() or output_path.stat().st_size <= 0:
        raise RuntimeError("ffmpeg 未生成有效的原音频 mp3。")


def _run_ffmpeg_trim_to_wav(input_path: Path, output_path: Path, *, start_ms: int, end_ms: int) -> None:
    duration_ms = max(1, int(end_ms) - int(start_ms))
    cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(input_path),
        "-ss",
        f"{start_ms / 1000:.3f}",
        "-t",
        f"{duration_ms / 1000:.3f}",
        "-vn",
        "-ac",
        "2",
        "-ar",
        SOURCE_AUDIO_WAV_SAMPLE_RATE,
        "-c:a",
        "pcm_s16le",
        str(output_path),
    ]
    try:
        subprocess.run(cmd, capture_output=True, check=True)
    except FileNotFoundError as exc:
        raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH。") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or b"").decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"ffmpeg 裁剪原音频 WAV 失败：{stderr or exc}") from exc
    if not output_path.exists() or output_path.stat().st_size <= 44:
        raise RuntimeError("ffmpeg 未生成有效的原音频 wav。")


def save_project_source_audio_mp3(
    *,
    project: Project,
    input_path: Path,
    audio_name: str | None,
    output_dir: Path,
    segments: Iterable[Any] | None = None,
) -> Project:
    source_segments = list(segments if segments is not None else (project.script.segments or []))
    try:
        _window_start_ms, window_end_ms = compute_source_audio_window_from_segments(source_segments)
    except ValueError:
        window_end_ms = 0
    start_ms = 0
    end_ms = _probe_audio_duration_ms(Path(input_path)) or window_end_ms
    if end_ms <= start_ms:
        raise ValueError("无法确定原音频时长，不能保存 source audio。")
    source_dir = project_source_audio_dir(output_dir=output_dir, project_id=project.id)
    source_dir.mkdir(parents=True, exist_ok=True)
    wav_path = source_dir / "source.wav"
    mp3_path = source_dir / "source.mp3"
    _run_ffmpeg_trim_to_wav(Path(input_path), wav_path, start_ms=start_ms, end_ms=end_ms)
    _run_ffmpeg_trim_to_mp3(Path(input_path), mp3_path, start_ms=start_ms, end_ms=end_ms)
    project.audio_assets.source_audio_wav_relpath = to_output_relpath(output_dir=output_dir, path=wav_path)
    project.audio_assets.source_audio_mp3_relpath = to_output_relpath(output_dir=output_dir, path=mp3_path)
    project.audio_assets.source_audio_name = Path(audio_name or input_path.name or "source_audio").name
    project.audio_assets.source_audio_start_ms = int(start_ms)
    project.audio_assets.source_audio_end_ms = int(end_ms)
    project.audio_assets.source_audio_duration_ms = int(end_ms - start_ms)
    return project


def upload_project_source_audio(
    *,
    project_id: str,
    input_path: Path,
    audio_name: str | None,
    projects_dir: Path,
    output_dir: Path,
) -> Project:
    project = load_project(projects_dir, project_id)
    save_project_source_audio_mp3(
        project=project,
        input_path=input_path,
        audio_name=audio_name,
        output_dir=output_dir,
    )
    saved = save_project(projects_dir, project)
    append_project_event(
        projects_dir,
        saved.id,
        {
            "source": "project",
            "status": saved.status,
            "event": {
                "type": "source_audio_saved",
                "message": "已保存裁剪后的识别原音频",
                "start_ms": saved.audio_assets.source_audio_start_ms,
                "end_ms": saved.audio_assets.source_audio_end_ms,
                "duration_ms": saved.audio_assets.source_audio_duration_ms,
            },
        },
    )
    return saved


def resolve_project_source_audio_path(*, project_id: str, projects_dir: Path, output_dir: Path) -> Path:
    project = load_project(projects_dir, project_id)
    path = from_output_relpath(output_dir, project.audio_assets.source_audio_mp3_relpath)
    if not path or not path.exists() or not path.is_file():
        raise FileNotFoundError("项目没有可播放的识别原音频。")
    return path
