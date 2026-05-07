from __future__ import annotations

import asyncio
import gc
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
        if not str(model_dir or "").strip():
            return {
                "valid": False,
                "model_dir": "",
                "exists": False,
                "missing": required_entries,
                "message": "音乐模型目录未配置",
            }
        if not resolved_model_dir.exists() or not resolved_model_dir.is_dir():
            return {
                "valid": False,
                "model_dir": str(resolved_model_dir),
                "exists": False,
                "missing": required_entries,
                "message": f"音乐模型目录不存在: {resolved_model_dir}",
            }

        missing: list[str] = []
        for entry in required_entries:
            if not (resolved_model_dir / entry).exists():
                missing.append(entry)
        return {
            "valid": len(missing) == 0,
            "model_dir": str(resolved_model_dir),
            "exists": True,
            "missing": missing,
            "message": "" if len(missing) == 0 else f"模型目录缺少必要文件/目录: {', '.join(missing)}",
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
        prompt: str,
        output_path: Path,
        lyrics: str = "",
        audio_duration: float = 10.0,
        vocal_language: str = "en",
        num_inference_steps: int = 8,
        seed: int | None = None,
        bpm: int | None = None,
        keyscale: str | None = None,
        timesignature: str | None = None,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._generate_to_file_sync,
            prompt,
            output_path,
            lyrics,
            audio_duration,
            vocal_language,
            num_inference_steps,
            seed,
            bpm,
            keyscale,
            timesignature,
        )

    def _generate_to_file_sync(
        self,
        prompt: str,
        output_path: Path,
        lyrics: str,
        audio_duration: float,
        vocal_language: str,
        num_inference_steps: int,
        seed: int | None,
        bpm: int | None,
        keyscale: str | None,
        timesignature: str | None,
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
            "lyrics": lyrics or "",
            "audio_duration": float(audio_duration),
            "vocal_language": vocal_language or "en",
            "num_inference_steps": int(num_inference_steps),
            "generator": generator,
            "output_type": "pt",
        }
        if bpm is not None:
            kwargs["bpm"] = int(bpm)
        if keyscale:
            kwargs["keyscale"] = keyscale
        if timesignature:
            kwargs["timesignature"] = timesignature

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
                "output_path": str(output_path),
            }
        except Exception as exc:
            self.last_error = f"音乐生成失败: {exc}"
            raise RuntimeError(self.last_error) from exc
