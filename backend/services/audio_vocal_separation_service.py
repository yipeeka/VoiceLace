from __future__ import annotations

import asyncio
from dataclasses import dataclass
import os
from pathlib import Path
import subprocess
import sys


ALLOWED_DEMUCS_MODELS = {"htdemucs", "htdemucs_ft"}


@dataclass(slots=True)
class VocalSeparationResult:
    audio_path: Path
    enabled: bool
    used: bool
    model: str
    repo_dir: str
    warnings: list[str]
    background_path: Path | None = None

    def to_payload(self) -> dict:
        return {
            "enabled": self.enabled,
            "used": self.used,
            "model": self.model,
            "repo_dir": self.repo_dir,
            "warnings": list(self.warnings),
            "background_path": str(self.background_path) if self.background_path else "",
        }


def normalize_demucs_model(value: str | None) -> str:
    model = str(value or "htdemucs").strip().lower()
    if model not in ALLOWED_DEMUCS_MODELS:
        return "htdemucs"
    return model


def build_vocal_separation_status(*, enabled: bool, model: str, repo_dir: str, device: str, last_error: str = "") -> dict:
    normalized_model = normalize_demucs_model(model)
    repo_text = str(repo_dir or "").strip()
    repo_path = Path(repo_text).expanduser() if repo_text else None
    repo_exists = bool(repo_path and repo_path.exists() and repo_path.is_dir())
    return {
        "enabled": bool(enabled),
        "model": normalized_model,
        "repo_dir": repo_text,
        "repo_dir_exists": repo_exists,
        "device": str(device or "").strip(),
        "available": bool(repo_exists),
        "last_error": str(last_error or ""),
    }


async def prepare_vocal_audio_for_asr(
    audio_path: Path,
    *,
    enabled: bool,
    model: str,
    repo_dir: str,
    device: str,
    work_dir: Path,
) -> VocalSeparationResult:
    normalized_model = normalize_demucs_model(model)
    repo_text = str(repo_dir or "").strip()
    if not enabled:
        return VocalSeparationResult(audio_path=audio_path, enabled=False, used=False, model=normalized_model, repo_dir=repo_text, warnings=[])

    warnings: list[str] = []
    repo_path = Path(repo_text).expanduser() if repo_text else None
    if repo_path is None:
        warnings.append("Demucs 模型目录未配置，已使用原音频继续识别。")
        return VocalSeparationResult(audio_path=audio_path, enabled=True, used=False, model=normalized_model, repo_dir=repo_text, warnings=warnings)
    if not repo_path.exists() or not repo_path.is_dir():
        warnings.append(f"Demucs 模型目录不存在：{repo_path}，已使用原音频继续识别。")
        return VocalSeparationResult(audio_path=audio_path, enabled=True, used=False, model=normalized_model, repo_dir=repo_text, warnings=warnings)

    try:
        separated = await asyncio.to_thread(
            _run_demucs_two_stem_separation,
            audio_path,
            work_dir=work_dir,
            model=normalized_model,
            repo_path=repo_path,
            device=str(device or "cpu").strip() or "cpu",
        )
        return VocalSeparationResult(
            audio_path=separated["vocals"],
            enabled=True,
            used=True,
            model=normalized_model,
            repo_dir=str(repo_path),
            warnings=[],
            background_path=separated.get("no_vocals"),
        )
    except Exception as exc:
        warnings.append(f"Demucs 人声分离失败，已使用原音频继续识别：{exc}")
        return VocalSeparationResult(audio_path=audio_path, enabled=True, used=False, model=normalized_model, repo_dir=str(repo_path), warnings=warnings)


async def prepare_background_audio_for_remix(
    audio_path: Path,
    *,
    enabled: bool,
    model: str,
    repo_dir: str,
    device: str,
    work_dir: Path,
) -> VocalSeparationResult:
    normalized_model = normalize_demucs_model(model)
    repo_text = str(repo_dir or "").strip()
    warnings: list[str] = []
    if not enabled:
        warnings.append("Demucs 背景声提取未启用。")
        return VocalSeparationResult(audio_path=audio_path, enabled=False, used=False, model=normalized_model, repo_dir=repo_text, warnings=warnings)

    repo_path = Path(repo_text).expanduser() if repo_text else None
    if repo_path is None:
        warnings.append("Demucs 模型目录未配置，无法提取背景声。")
        return VocalSeparationResult(audio_path=audio_path, enabled=True, used=False, model=normalized_model, repo_dir=repo_text, warnings=warnings)
    if not repo_path.exists() or not repo_path.is_dir():
        warnings.append(f"Demucs 模型目录不存在：{repo_path}，无法提取背景声。")
        return VocalSeparationResult(audio_path=audio_path, enabled=True, used=False, model=normalized_model, repo_dir=repo_text, warnings=warnings)

    try:
        separated = await asyncio.to_thread(
            _run_demucs_two_stem_separation,
            audio_path,
            work_dir=work_dir,
            model=normalized_model,
            repo_path=repo_path,
            device=str(device or "cpu").strip() or "cpu",
        )
    except Exception as exc:
        warnings.append(f"Demucs 背景声提取失败：{exc}")
        return VocalSeparationResult(audio_path=audio_path, enabled=True, used=False, model=normalized_model, repo_dir=str(repo_path), warnings=warnings)

    background = separated.get("no_vocals")
    if background is None:
        warnings.append("未找到 Demucs 输出 no_vocals.wav。")
        return VocalSeparationResult(audio_path=audio_path, enabled=True, used=False, model=normalized_model, repo_dir=str(repo_path), warnings=warnings)

    return VocalSeparationResult(
        audio_path=background,
        enabled=True,
        used=True,
        model=normalized_model,
        repo_dir=str(repo_path),
        warnings=[],
        background_path=background,
    )


def _run_demucs_two_stem_separation(audio_path: Path, *, work_dir: Path, model: str, repo_path: Path, device: str) -> dict[str, Path]:
    work_dir.mkdir(parents=True, exist_ok=True)
    normalized_input = work_dir / "input.wav"
    demucs_out = work_dir / "demucs"

    ffmpeg_cmd = [
        "ffmpeg",
        "-v",
        "error",
        "-nostdin",
        "-y",
        "-i",
        str(audio_path),
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        str(normalized_input),
    ]
    subprocess.run(ffmpeg_cmd, capture_output=True, check=True)

    demucs_cmd = [
        sys.executable,
        "-m",
        "demucs.separate",
        "--repo",
        str(repo_path),
        "-n",
        model,
        "--two-stems",
        "vocals",
        "--device",
        device,
        "--out",
        str(demucs_out),
        str(normalized_input),
    ]
    demucs_env = os.environ.copy()
    demucs_env["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"
    demucs_env.pop("TORCH_FORCE_WEIGHTS_ONLY_LOAD", None)
    proc = subprocess.run(demucs_cmd, capture_output=True, text=True, check=False, env=demucs_env)
    if proc.returncode != 0:
        stderr = str(proc.stderr or "").strip()
        stdout = str(proc.stdout or "").strip()
        raise RuntimeError(stderr or stdout or f"Demucs exited with code {proc.returncode}")

    vocals_candidates = sorted(demucs_out.glob(f"**/{normalized_input.stem}/vocals.wav"))
    if not vocals_candidates:
        vocals_candidates = sorted(demucs_out.glob("**/vocals.wav"))
    if not vocals_candidates:
        raise RuntimeError("未找到 Demucs 输出 vocals.wav")
    background_candidates = sorted(demucs_out.glob(f"**/{normalized_input.stem}/no_vocals.wav"))
    if not background_candidates:
        background_candidates = sorted(demucs_out.glob("**/no_vocals.wav"))
    result = {"vocals": vocals_candidates[0]}
    if background_candidates:
        result["no_vocals"] = background_candidates[0]
    return result


def _run_demucs_vocal_separation(audio_path: Path, *, work_dir: Path, model: str, repo_path: Path, device: str) -> Path:
    return _run_demucs_two_stem_separation(
        audio_path,
        work_dir=work_dir,
        model=model,
        repo_path=repo_path,
        device=device,
    )["vocals"]
