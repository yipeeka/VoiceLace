from __future__ import annotations

import asyncio
import importlib.metadata
import wave
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.engine.tts_overrides import normalize_tts_overrides
from backend.models import SynthesisConfig, VoicePreset


SUPPORTED_ENGLISH_INSTRUCTS = {
    "american accent",
    "australian accent",
    "british accent",
    "canadian accent",
    "child",
    "chinese accent",
    "elderly",
    "female",
    "high pitch",
    "indian accent",
    "japanese accent",
    "korean accent",
    "low pitch",
    "male",
    "middle-aged",
    "moderate pitch",
    "portuguese accent",
    "russian accent",
    "teenager",
    "very high pitch",
    "very low pitch",
    "whisper",
    "young adult",
}


class TTSEngine:
    # OmniVoice outputs 24 kHz mono PCM regardless of input.
    # Exposed as a class-level constant so callers don't need to hard-code it.
    SAMPLE_RATE: int = 24000

    def __init__(self) -> None:
        self.is_loaded = False
        self.model_path = "k2-fsa/OmniVoice"
        self.device = "cpu"
        self.backend_name = "mock"
        self.last_error = ""
        self.sample_rate: int = TTSEngine.SAMPLE_RATE
        self._model: Any | None = None
        self._torch: Any | None = None
        self._audio_patch_applied = False

    async def load_model(self, model_path: str, device: str) -> None:
        self.model_path = model_path or settings.default_tts_model_path or self.model_path
        self.device = device or settings.default_tts_device or self.device

        try:
            import torch
            from omnivoice import OmniVoice
            self._install_omnivoice_audio_patch(torch)
        except ImportError as exc:
            self._fallback_or_raise(f"未安装 OmniVoice 相关依赖: {exc}")
            return

        try:
            dtype = torch.float16 if self.device.startswith("cuda") else torch.float32
            self._model = OmniVoice.from_pretrained(
                self.model_path,
                device_map=self.device,
                dtype=dtype,
            )
            self._torch = torch
            self._install_sage_attention(torch)
            self.is_loaded = True
            self.backend_name = "omnivoice"
            self.last_error = ""
        except Exception as exc:
            self._fallback_or_raise(f"加载 OmniVoice 失败: {exc}")

    async def unload_model(self) -> None:
        self.is_loaded = False
        self._model = None
        self._torch = None

    async def synthesize_to_file(
        self,
        text: str,
        output_path: Path,
        preset: VoicePreset | None = None,
        config: SynthesisConfig | None = None,
        tts_overrides: dict[str, Any] | None = None,
    ) -> Path:
        return await asyncio.to_thread(
            self._synthesize_to_file_sync,
            text,
            output_path,
            preset,
            config,
            tts_overrides,
        )

    def _synthesize_to_file_sync(
        self,
        text: str,
        output_path: Path,
        preset: VoicePreset | None = None,
        config: SynthesisConfig | None = None,
        tts_overrides: dict[str, Any] | None = None,
    ) -> Path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        if self.backend_name == "omnivoice" and self._model is not None and self._torch is not None:
            kwargs: dict[str, Any] = {"text": text}
            if config is not None:
                kwargs["num_step"] = int(config.num_step)
                kwargs["guidance_scale"] = float(config.guidance_scale)
                kwargs["denoise"] = bool(config.denoise)
            if preset:
                if preset.voice_mode == "clone" and preset.ref_audio_path:
                    kwargs["ref_audio"] = preset.ref_audio_path
                    if preset.ref_text:
                        kwargs["ref_text"] = preset.ref_text
                    # Clone preset-level defaults for inference params.
                    # These can still be overridden by segment tts_overrides.
                    if preset.clone_denoise is not None:
                        kwargs["denoise"] = bool(preset.clone_denoise)
                    if preset.clone_num_step is not None:
                        kwargs["num_step"] = int(preset.clone_num_step)
                    if preset.clone_guidance_scale is not None:
                        kwargs["guidance_scale"] = float(preset.clone_guidance_scale)
                else:
                    instruct = self._sanitize_instruct(preset.to_instruct_string())
                    if instruct:
                        kwargs["instruct"] = instruct
                if preset.speed and preset.speed != 1.0:
                    kwargs["speed"] = preset.speed
            normalized_tts_overrides = normalize_tts_overrides(tts_overrides)
            kwargs.update(normalized_tts_overrides)

            try:
                audio = self._model.generate(**kwargs)
                waveform = self._to_pcm16_bytes(audio)
                with wave.open(str(output_path), "wb") as wav_file:
                    wav_file.setnchannels(1)
                    wav_file.setsampwidth(2)
                    wav_file.setframerate(self.sample_rate)
                    wav_file.writeframes(waveform)
                return output_path
            except Exception as exc:
                self._fallback_or_raise(f"OmniVoice 运行失败: {exc}")

        self._write_mock_silence(output_path)
        return output_path

    def _sanitize_instruct(self, instruct: str) -> str:
        if not instruct:
            return ""
        items = [item.strip() for item in instruct.split(",") if item.strip()]
        filtered = [item for item in items if item.lower() in SUPPORTED_ENGLISH_INSTRUCTS]
        return ", ".join(filtered)

    _sage_attention_applied = False

    def _install_sage_attention(self, torch_module: Any) -> None:
        if TTSEngine._sage_attention_applied:
            return
        try:
            from sageattention import sageattn
            import torch.nn.functional as F
            _original_sdpa = F.scaled_dot_product_attention

            def _sage_sdpa(query, key, value, attn_mask=None, dropout_p=0.0, is_causal=False, scale=None, **kwargs):
                # SageAttention doesn't support attn_mask or dropout; fall back for those cases
                if attn_mask is not None or dropout_p > 0.0:
                    return _original_sdpa(query, key, value, attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale, **kwargs)
                try:
                    return sageattn(query, key, value, is_causal=is_causal, smooth_k=True)
                except Exception:
                    return _original_sdpa(query, key, value, attn_mask=attn_mask, dropout_p=dropout_p, is_causal=is_causal, scale=scale, **kwargs)

            F.scaled_dot_product_attention = _sage_sdpa
            TTSEngine._sage_attention_applied = True
            import logging
            logging.getLogger(__name__).info("SageAttention 2 已启用，替换 torch SDPA")
        except ImportError:
            import logging
            logging.getLogger(__name__).info("sageattention 未安装，使用默认 SDPA")
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning(f"SageAttention 安装失败: {exc}，使用默认 SDPA")

    def _fallback_or_raise(self, message: str) -> None:
        self.last_error = message
        if not settings.allow_mock_fallback:
            raise RuntimeError(message)
        self.is_loaded = True
        self.backend_name = "mock"
        self._model = None

    def _write_mock_silence(self, output_path: Path) -> None:
        with wave.open(str(output_path), "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(b"\x00\x00" * self.sample_rate)

    def _install_omnivoice_audio_patch(self, torch_module: Any) -> None:
        if self._audio_patch_applied:
            return
        # OmniVoice 0.1.4+ already switched to soundfile+librosa upstream.
        # Keep our legacy patch only for older versions to avoid API/shape mismatches.
        try:
            raw_version = importlib.metadata.version("omnivoice")
        except Exception:
            raw_version = ""

        def _parse_version_tuple(value: str) -> tuple[int, ...]:
            parts: list[int] = []
            for token in value.split("."):
                num = ""
                for ch in token:
                    if ch.isdigit():
                        num += ch
                    else:
                        break
                if not num:
                    break
                parts.append(int(num))
            return tuple(parts)

        if _parse_version_tuple(raw_version) >= (0, 1, 4):
            self._audio_patch_applied = True
            return

        try:
            import numpy as np
            from omnivoice.models import omnivoice as omnivoice_model_module
            from omnivoice.utils import audio as omnivoice_audio_module
            from pydub import AudioSegment
            import soundfile as sf
        except Exception:
            return
        try:
            import librosa  # type: ignore
        except Exception:
            librosa = None
        try:
            import torchaudio  # type: ignore
        except Exception:
            torchaudio = None

        def _resample_waveform(waveform, prompt_sampling_rate: int, sampling_rate: int):
            if prompt_sampling_rate == sampling_rate:
                return waveform
            if librosa is not None:
                arr = waveform.detach().cpu().numpy()
                arr = librosa.resample(arr, orig_sr=prompt_sampling_rate, target_sr=sampling_rate, axis=-1)
                return torch_module.from_numpy(arr).to(dtype=waveform.dtype)
            if torchaudio is not None:
                return torchaudio.functional.resample(
                    waveform,
                    orig_freq=prompt_sampling_rate,
                    new_freq=sampling_rate,
                )
            # Last fallback without extra deps: linear interpolation in torch.
            # Shape expected by interpolate: [N, C, T]
            import torch.nn.functional as F

            source = waveform.unsqueeze(0)
            target_len = int(source.shape[-1] * (sampling_rate / max(prompt_sampling_rate, 1)))
            target_len = max(target_len, 1)
            resampled = F.interpolate(source, size=target_len, mode="linear", align_corners=False)
            return resampled.squeeze(0)

        def _load_audio_compat(audio_path: str, sampling_rate: int):
            waveform = None
            prompt_sampling_rate = None
            try:
                audio_data, prompt_sampling_rate = sf.read(
                    audio_path,
                    dtype="float32",
                    always_2d=True,
                )
                waveform = torch_module.from_numpy(audio_data.T)
            except Exception:
                try:
                    if torchaudio is None:
                        raise RuntimeError("torchaudio unavailable")
                    waveform, prompt_sampling_rate = torchaudio.load(audio_path, backend="soundfile")
                except Exception:
                    aseg = AudioSegment.from_file(audio_path)
                    audio_data = np.array(aseg.get_array_of_samples()).astype(np.float32) / 32768.0
                    if aseg.channels == 1:
                        waveform = torch_module.from_numpy(audio_data).unsqueeze(0)
                    else:
                        waveform = torch_module.from_numpy(audio_data.reshape(-1, aseg.channels).T)
                    prompt_sampling_rate = aseg.frame_rate

            if prompt_sampling_rate != sampling_rate:
                waveform = _resample_waveform(waveform, int(prompt_sampling_rate), int(sampling_rate))
            if waveform.shape[0] > 1:
                waveform = torch_module.mean(waveform, dim=0, keepdim=True)
            return waveform

        omnivoice_audio_module.load_audio = _load_audio_compat
        omnivoice_model_module.load_audio = _load_audio_compat
        self._audio_patch_applied = True

    def _to_pcm16_bytes(self, generated_audio: Any) -> bytes:
        import numpy as np

        sample = generated_audio
        inferred_rate: int | None = None

        if isinstance(sample, dict):
            payload = sample
            if isinstance(payload.get("sample_rate"), (int, float)):
                inferred_rate = int(payload["sample_rate"])
            for key in ("audio", "wav", "waveform", "samples"):
                if key in payload:
                    sample = payload[key]
                    break

        if isinstance(sample, tuple) and len(sample) == 2 and isinstance(sample[1], (int, float)):
            inferred_rate = int(sample[1])
            sample = sample[0]

        if isinstance(sample, (list, tuple)) and sample:
            sample = sample[0]

        if hasattr(sample, "detach"):
            arr = sample.detach().cpu().numpy()
        else:
            arr = np.asarray(sample)

        if arr.size == 0:
            raise RuntimeError("OmniVoice 返回空音频数据")

        while arr.ndim > 1 and arr.shape[0] == 1:
            arr = arr[0]
        if arr.ndim > 1:
            # Mix channels to mono conservatively.
            axis = 0 if arr.shape[0] <= arr.shape[-1] else -1
            arr = arr.mean(axis=axis)

        if arr.dtype.kind in ("i", "u"):
            info = np.iinfo(arr.dtype)
            max_abs = max(abs(info.min), info.max) or 1
            arr = arr.astype(np.float32) / float(max_abs)
        else:
            arr = arr.astype(np.float32)

        arr = np.nan_to_num(arr, nan=0.0, posinf=1.0, neginf=-1.0)
        arr = np.clip(arr, -1.0, 1.0)

        if inferred_rate and inferred_rate > 0:
            self.sample_rate = inferred_rate

        return (arr * 32767.0).astype("<i2").tobytes()
