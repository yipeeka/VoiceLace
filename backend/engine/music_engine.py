from __future__ import annotations

import asyncio
import gc
import json
from pathlib import Path
from typing import Any


class MusicEngine:
    SAMPLE_RATE: int = 48000

    def __init__(self) -> None:
        self.is_loaded = False
        self.model_dir = ""
        self.device_mode = "cpu_offload"
        self.backend_name = "unloaded"
        self.last_error = ""
        self.sample_rate = MusicEngine.SAMPLE_RATE
        self._pipeline: Any | None = None
        self._torch: Any | None = None

    def needs_reload(self, *, model_dir: str, device_mode: str) -> bool:
        if not self.is_loaded:
            return False
        target_model_dir = str(Path(model_dir or "").expanduser())
        target_device_mode = (device_mode or "cpu_offload").strip().lower()
        return target_model_dir != self.model_dir or target_device_mode != self.device_mode

    @staticmethod
    def validate_model_dir(model_dir: str) -> dict[str, Any]:
        resolved_model_dir = Path(model_dir or "").expanduser().resolve()
        required_entries = [
            "model_index.json",
            "transformer",
            "condition_encoder",
            "text_encoder",
            "tokenizer",
            "vae",
            "scheduler",
        ]
        report_base = {
            "is_turbo": False,
            "supports_lego_complete": True,
        }
        if not str(model_dir or "").strip():
            return {
                "valid": False,
                "model_dir": "",
                "exists": False,
                "missing": required_entries,
                "message": "音乐模型目录未配置",
                **report_base,
            }
        if not resolved_model_dir.exists() or not resolved_model_dir.is_dir():
            return {
                "valid": False,
                "model_dir": str(resolved_model_dir),
                "exists": False,
                "missing": required_entries,
                "message": f"音乐模型目录不存在: {resolved_model_dir}",
                **report_base,
            }

        missing: list[str] = []
        for entry in required_entries:
            if not (resolved_model_dir / entry).exists():
                missing.append(entry)
        transformer_config_path = resolved_model_dir / "transformer" / "config.json"
        is_turbo = False
        try:
            if transformer_config_path.exists():
                transformer_cfg = json.loads(transformer_config_path.read_text(encoding="utf-8"))
                is_turbo = bool(transformer_cfg.get("is_turbo")) or str(transformer_cfg.get("model_version", "")).strip().lower() == "turbo"
        except Exception:
            is_turbo = "turbo" in str(resolved_model_dir).lower()
        supports_lego_complete = not is_turbo

        return {
            "valid": len(missing) == 0,
            "model_dir": str(resolved_model_dir),
            "exists": True,
            "missing": missing,
            "message": "" if len(missing) == 0 else f"模型目录缺少必要文件/目录: {', '.join(missing)}",
            "is_turbo": is_turbo,
            "supports_lego_complete": supports_lego_complete,
        }

    async def load_model(self, model_dir: str, device_mode: str = "cpu_offload") -> None:
        validation = self.validate_model_dir(model_dir)
        if not validation["valid"]:
            raise RuntimeError(validation["message"])
        resolved_model_dir = Path(validation["model_dir"])

        requested_mode = (device_mode or "cpu_offload").strip().lower()
        if requested_mode not in {"cpu_offload", "cuda", "cpu"}:
            requested_mode = "cpu_offload"

        try:
            import torch
            from diffusers import AceStepPipeline
        except Exception as exc:  # pragma: no cover - env-dependent
            self.last_error = f"导入音乐推理依赖失败: {exc}"
            raise RuntimeError(self.last_error) from exc

        try:
            dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
            pipeline = AceStepPipeline.from_pretrained(
                str(resolved_model_dir),
                torch_dtype=dtype,
                local_files_only=True,
            )

            if torch.cuda.is_available():
                if requested_mode == "cpu_offload":
                    pipeline.enable_model_cpu_offload()
                elif requested_mode == "cuda":
                    pipeline = pipeline.to("cuda")
                else:
                    pipeline = pipeline.to("cpu")
            else:
                pipeline = pipeline.to("cpu")

            self._pipeline = pipeline
            self._torch = torch
            self.is_loaded = True
            self.model_dir = str(resolved_model_dir)
            self.device_mode = requested_mode
            self.backend_name = "acestep_diffusers"
            self.last_error = ""
            self.sample_rate = int(getattr(self._pipeline, "sample_rate", MusicEngine.SAMPLE_RATE) or MusicEngine.SAMPLE_RATE)
        except Exception as exc:
            self.last_error = f"加载音乐模型失败: {exc}"
            self._pipeline = None
            self._torch = None
            self.is_loaded = False
            self.backend_name = "error"
            raise RuntimeError(self.last_error) from exc

    async def unload_model(self) -> None:
        pipeline = self._pipeline
        self.is_loaded = False
        self._pipeline = None
        self._torch = None
        self.backend_name = "unloaded"
        self.last_error = ""
        if pipeline is not None:
            del pipeline
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass

    async def generate_to_file(
        self,
        *,
        task_type: str = "text2music",
        prompt: str,
        output_path: Path,
        lyrics: str = "",
        audio_duration: float = 10.0,
        vocal_language: str = "en",
        num_inference_steps: int = 8,
        seed: int | None = None,
        source_audio_path: Path | None = None,
        reference_audio_path: Path | None = None,
        bpm: int | None = None,
        keyscale: str | None = None,
        timesignature: str | None = None,
        track_name: str | None = None,
        complete_track_classes: list[str] | None = None,
        repainting_start: float | None = None,
        repainting_end: float | None = None,
        audio_cover_strength: float = 1.0,
        guidance_scale: float = 7.0,
        shift: float = 3.0,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._generate_to_file_sync,
            task_type,
            prompt,
            output_path,
            lyrics,
            audio_duration,
            vocal_language,
            num_inference_steps,
            seed,
            source_audio_path,
            reference_audio_path,
            bpm,
            keyscale,
            timesignature,
            track_name,
            complete_track_classes,
            repainting_start,
            repainting_end,
            audio_cover_strength,
            guidance_scale,
            shift,
        )

    def _load_audio_tensor(self, path: Path, torch_module):
        import librosa

        audio_np, _ = librosa.load(str(path), sr=self.sample_rate, mono=False)
        if getattr(audio_np, "ndim", 0) == 1:
            audio_np = audio_np[None, :]
        return torch_module.from_numpy(audio_np).to(dtype=torch_module.float32)

    def _generate_to_file_sync(
        self,
        task_type: str,
        prompt: str,
        output_path: Path,
        lyrics: str,
        audio_duration: float,
        vocal_language: str,
        num_inference_steps: int,
        seed: int | None,
        source_audio_path: Path | None,
        reference_audio_path: Path | None,
        bpm: int | None,
        keyscale: str | None,
        timesignature: str | None,
        track_name: str | None,
        complete_track_classes: list[str] | None,
        repainting_start: float | None,
        repainting_end: float | None,
        audio_cover_strength: float,
        guidance_scale: float,
        shift: float,
    ) -> dict[str, Any]:
        if self._pipeline is None or not self.is_loaded:
            raise RuntimeError("音乐模型未加载")
        if not str(prompt or "").strip():
            raise RuntimeError("prompt 不能为空")

        output_path.parent.mkdir(parents=True, exist_ok=True)

        torch_module = self._torch
        generator = None
        resolved_seed = seed if seed is not None else 0
        if torch_module is not None:
            if torch_module.cuda.is_available():
                generator = torch_module.Generator(device="cuda").manual_seed(int(resolved_seed))
            else:
                generator = torch_module.Generator(device="cpu").manual_seed(int(resolved_seed))

        kwargs: dict[str, Any] = {
            "prompt": prompt,
            "task_type": (task_type or "text2music").strip().lower(),
            "lyrics": lyrics or "",
            "audio_duration": float(audio_duration),
            "vocal_language": vocal_language or "en",
            "num_inference_steps": int(num_inference_steps),
            "generator": generator,
            "guidance_scale": float(guidance_scale),
            "shift": float(shift),
            "audio_cover_strength": float(audio_cover_strength),
            "output_type": "pt",
        }
        if bpm is not None:
            kwargs["bpm"] = int(bpm)
        if keyscale:
            kwargs["keyscale"] = keyscale
        if timesignature:
            kwargs["timesignature"] = timesignature
        if track_name:
            kwargs["track_name"] = track_name
        if complete_track_classes:
            kwargs["complete_track_classes"] = [str(item).strip() for item in complete_track_classes if str(item).strip()]
        if repainting_start is not None:
            kwargs["repainting_start"] = float(repainting_start)
        if repainting_end is not None:
            kwargs["repainting_end"] = float(repainting_end)
        if source_audio_path is not None:
            kwargs["src_audio"] = self._load_audio_tensor(source_audio_path, torch_module)
        if reference_audio_path is not None:
            kwargs["reference_audio"] = self._load_audio_tensor(reference_audio_path, torch_module)

        try:
            result = self._pipeline(**kwargs)
            audio_tensor = result.audios[0]
            audio_np = audio_tensor.T.detach().cpu().float().numpy()
            import soundfile as sf

            sf.write(str(output_path), audio_np, self.sample_rate)
            return {
                "sample_rate": self.sample_rate,
                "channels": int(audio_np.shape[1]) if audio_np.ndim == 2 else 1,
                "frames": int(audio_np.shape[0]) if audio_np.ndim >= 1 else 0,
                "duration_seconds": float(audio_np.shape[0] / self.sample_rate) if audio_np.ndim >= 1 else 0.0,
                "seed": int(resolved_seed),
                "task_type": kwargs["task_type"],
                "output_path": str(output_path),
            }
        except Exception as exc:
            self.last_error = f"音乐生成失败: {exc}"
            raise RuntimeError(self.last_error) from exc
