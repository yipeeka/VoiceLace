from __future__ import annotations

import asyncio
import csv
from dataclasses import asdict, dataclass
from enum import Enum
import gc
import io
import os
import subprocess
import time
from typing import Awaitable, Callable

from backend.config import settings

CONFIG_SECRET_MASK = "********"
SECRET_CONFIG_FIELDS = (
    "openai_api_key",
    "openai_compatible_api_key",
    "gemini_api_key",
    "pyannote_auth_token",
)


def public_orchestrator_config(config: "OrchestratorConfig") -> dict:
    payload = asdict(config)
    for field in SECRET_CONFIG_FIELDS:
        value = str(payload.get(field) or "")
        payload[f"{field}_configured"] = bool(value)
        payload[field] = CONFIG_SECRET_MASK if value else ""
    return payload


class ModelState(str, Enum):
    IDLE = "idle"
    LOADING_LLM = "loading_llm"
    LLM_READY = "llm_ready"
    LLM_WORKING = "llm_working"
    UNLOADING_LLM = "unloading_llm"
    LOADING_TTS = "loading_tts"
    TTS_READY = "tts_ready"
    TTS_WORKING = "tts_working"
    UNLOADING_TTS = "unloading_tts"
    LOADING_MUSIC = "loading_music"
    MUSIC_READY = "music_ready"
    MUSIC_WORKING = "music_working"
    UNLOADING_MUSIC = "unloading_music"
    LOADING_ASR = "loading_asr"
    ASR_READY = "asr_ready"
    ASR_WORKING = "asr_working"
    UNLOADING_ASR = "unloading_asr"


@dataclass(slots=True)
class OrchestratorConfig:
    auto_serial: bool = settings.default_auto_serial
    auto_unload_llm_after_parse: bool = settings.default_auto_unload_llm_after_parse
    auto_load_tts_before_synth: bool = settings.default_auto_load_tts_before_synth
    debug_stale_report: bool = settings.default_debug_stale_report
    mcp_enabled: bool = settings.default_mcp_enabled
    mcp_mount_path: str = settings.default_mcp_mount_path
    enable_llama_cpp_think_mode: bool = settings.default_enable_llama_cpp_think_mode
    llm_backend: str = settings.default_llm_backend
    llm_model_path: str = settings.default_llm_model_path
    llm_clip_model_path: str = settings.default_llm_clip_model_path
    llm_api_model: str = settings.default_llm_api_model
    openai_api_key: str = settings.openai_api_key
    openai_base_url: str = settings.openai_base_url
    openai_model: str = settings.openai_model
    openai_compatible_api_key: str = settings.openai_compatible_api_key
    openai_compatible_base_url: str = settings.openai_compatible_base_url
    openai_compatible_model: str = settings.openai_compatible_model
    gemini_api_key: str = settings.gemini_api_key
    gemini_base_url: str = settings.gemini_base_url
    gemini_model: str = settings.gemini_model
    llm_n_ctx: int = settings.default_llm_n_ctx
    llm_n_gpu_layers: int = settings.default_llm_n_gpu_layers
    llm_threads: int = settings.default_llm_threads
    llm_temperature: float = settings.default_llm_temperature
    llm_top_p: float = settings.default_llm_top_p
    llm_top_k: int = settings.default_llm_top_k
    llm_min_p: float = settings.default_llm_min_p
    llm_presence_penalty: float = settings.default_llm_presence_penalty
    llm_repeat_penalty: float = settings.default_llm_repeat_penalty
    llm_max_tokens: int = settings.default_llm_max_tokens
    secondary_llm_model_path: str = settings.default_secondary_llm_model_path
    secondary_llm_clip_model_path: str = settings.default_secondary_llm_clip_model_path
    secondary_llm_n_ctx: int = settings.default_secondary_llm_n_ctx
    secondary_llm_n_gpu_layers: int = settings.default_secondary_llm_n_gpu_layers
    secondary_llm_threads: int = settings.default_secondary_llm_threads
    secondary_llm_temperature: float = settings.default_secondary_llm_temperature
    secondary_llm_top_p: float = settings.default_secondary_llm_top_p
    secondary_llm_top_k: int = settings.default_secondary_llm_top_k
    secondary_llm_min_p: float = settings.default_secondary_llm_min_p
    secondary_llm_presence_penalty: float = settings.default_secondary_llm_presence_penalty
    secondary_llm_repeat_penalty: float = settings.default_secondary_llm_repeat_penalty
    secondary_llm_max_tokens: int = settings.default_secondary_llm_max_tokens
    secondary_enable_llama_cpp_think_mode: bool = settings.default_secondary_enable_llama_cpp_think_mode
    tts_model_path: str = settings.default_tts_model_path
    voxcpm_tts_model_path: str = settings.default_voxcpm_tts_model_path
    tts_device: str = settings.default_tts_device
    music_enabled: bool = settings.default_music_enabled
    music_turbo_model_dir: str = settings.default_music_turbo_model_dir
    music_base_model_dir: str = settings.default_music_base_model_dir
    music_model_variant: str = settings.default_music_model_variant
    music_model_dir: str = settings.default_music_model_dir
    music_device_mode: str = settings.default_music_device_mode
    asr_backend: str = settings.default_asr_backend
    asr_model_path: str = settings.default_asr_model_path
    asr_device: str = settings.default_asr_device
    asr_vocal_separation_enabled: bool = settings.default_asr_vocal_separation_enabled
    asr_vocal_separation_model: str = settings.default_asr_vocal_separation_model
    asr_vocal_separation_repo_dir: str = settings.default_asr_vocal_separation_repo_dir
    asr_vocal_separation_device: str = settings.default_asr_vocal_separation_device
    qwen3_asr_crispasr_exe: str = settings.default_qwen3_asr_crispasr_exe
    qwen3_asr_model_path: str = settings.default_qwen3_asr_model_path
    qwen3_asr_forced_aligner_model_path: str = settings.default_qwen3_asr_forced_aligner_model_path
    qwen3_asr_threads: int = settings.default_qwen3_asr_threads
    qwen3_asr_language: str = settings.default_qwen3_asr_language
    qwen3_asr_enable_timestamps: bool = settings.default_qwen3_asr_enable_timestamps
    qwen3_asr_preview_max_line_length: int = settings.default_qwen3_asr_preview_max_line_length
    firered_asr_model_path: str = ""
    firered_asr_threads: int = 0
    firered_asr_language: str = "auto"
    firered_asr_enable_timestamps: bool = True
    firered_asr_enable_punctuation: bool = False
    firered_asr_punc_model_path: str = ""
    pyannote_model_id: str = settings.default_pyannote_model_id
    pyannote_auth_token: str = settings.default_pyannote_auth_token
    pyannote_device: str = settings.default_pyannote_device
    default_system_prompt: str = ""


@dataclass(slots=True)
class GpuInfo:
    device_name: str = "unknown"
    name: str = "unknown"
    total_vram_mb: int = 0
    used_vram_mb: int = 0
    free_vram_mb: int = 0
    system_used_vram_mb: int = 0
    system_free_vram_mb: int = 0
    process_used_vram_mb: int = 0
    torch_allocated_mb: int = 0
    torch_reserved_mb: int = 0
    system_vram_source: str = "torch"
    process_vram_source: str = "torch"


Listener = Callable[[dict], Awaitable[None]]


class ModelOrchestrator:
    def __init__(self, llm_engine, tts_engine, music_engine=None, asr_engine=None) -> None:
        self._llm = llm_engine
        self._tts = tts_engine
        self._music = music_engine
        self._asr = asr_engine
        self._state = ModelState.IDLE
        self._lock = asyncio.Lock()
        self._listeners: list[Listener] = []
        self._config = OrchestratorConfig()
        self._windows_process_vram_cache: tuple[float, int, str] = (0.0, 0, "")

    @property
    def state(self) -> ModelState:
        return self._state

    @property
    def config(self) -> OrchestratorConfig:
        return self._config

    @staticmethod
    def _normalize_music_config(config: OrchestratorConfig) -> OrchestratorConfig:
        mcp_mount_path = str(getattr(config, "mcp_mount_path", "/mcp") or "/mcp").strip()
        if not mcp_mount_path.startswith("/"):
            mcp_mount_path = f"/{mcp_mount_path}"
        config.mcp_mount_path = (mcp_mount_path.rstrip("/") or "/mcp") if mcp_mount_path != "/" else "/mcp"

        variant = str(getattr(config, "music_model_variant", "turbo") or "turbo").strip().lower()
        if variant not in {"turbo", "base"}:
            variant = "turbo"
        config.music_model_variant = variant

        legacy_dir = str(getattr(config, "music_model_dir", "") or "").strip()
        turbo_dir = str(getattr(config, "music_turbo_model_dir", "") or "").strip()
        base_dir = str(getattr(config, "music_base_model_dir", "") or "").strip()
        if not turbo_dir and legacy_dir:
            turbo_dir = legacy_dir
        if not base_dir and legacy_dir:
            base_dir = legacy_dir
        config.music_turbo_model_dir = turbo_dir
        config.music_base_model_dir = base_dir

        if variant == "base":
            active_dir = base_dir or turbo_dir or legacy_dir
        else:
            active_dir = turbo_dir or base_dir or legacy_dir
        config.music_model_dir = active_dir

        asr_backend = str(getattr(config, "asr_backend", "whisper") or "whisper").strip().lower()
        if asr_backend in {"qwen3_asr", "qwen3-asr"}:
            asr_backend = "qwen3_crispasr"
        if asr_backend not in {"whisper", "qwen3_crispasr"}:
            asr_backend = "whisper"
        config.asr_backend = asr_backend

        vocal_model = str(getattr(config, "asr_vocal_separation_model", "htdemucs") or "htdemucs").strip().lower()
        if vocal_model not in {"htdemucs", "htdemucs_ft"}:
            vocal_model = "htdemucs"
        config.asr_vocal_separation_model = vocal_model
        config.asr_vocal_separation_repo_dir = str(getattr(config, "asr_vocal_separation_repo_dir", "") or "").strip()
        config.asr_vocal_separation_device = (
            str(getattr(config, "asr_vocal_separation_device", "") or "").strip()
            or str(getattr(config, "asr_device", "") or "cpu").strip()
            or "cpu"
        )

        try:
            config.qwen3_asr_threads = max(0, int(getattr(config, "qwen3_asr_threads", 0) or 0))
        except Exception:
            config.qwen3_asr_threads = 0
        config.qwen3_asr_language = str(getattr(config, "qwen3_asr_language", "auto") or "auto").strip() or "auto"
        config.qwen3_asr_enable_timestamps = bool(getattr(config, "qwen3_asr_enable_timestamps", False))
        try:
            preview_max_line_length = int(getattr(config, "qwen3_asr_preview_max_line_length", -1))
            config.qwen3_asr_preview_max_line_length = -1 if preview_max_line_length == -1 else min(50, max(2, preview_max_line_length))
        except Exception:
            config.qwen3_asr_preview_max_line_length = -1
        return config

    @classmethod
    def get_active_music_model_dir(cls, config: OrchestratorConfig) -> str:
        normalized = cls._normalize_music_config(config)
        return str(normalized.music_model_dir or "")

    def set_config(self, config: OrchestratorConfig) -> None:
        self._config = self._normalize_music_config(config)
        if hasattr(self._llm, "enable_llama_cpp_think_mode"):
            self._llm.enable_llama_cpp_think_mode = config.enable_llama_cpp_think_mode

    @staticmethod
    def _llm_api_load_options(config: OrchestratorConfig) -> dict[str, str]:
        backend = str(getattr(config, "llm_backend", "") or "").strip().lower()
        if backend == "openai":
            return {
                "api_key": config.openai_api_key,
                "api_base_url": config.openai_base_url,
                "api_model": config.openai_model or config.llm_api_model,
            }
        if backend == "gemini":
            return {
                "api_key": config.gemini_api_key,
                "api_base_url": config.gemini_base_url,
                "api_model": config.gemini_model or config.llm_api_model,
            }
        if backend in {"openai_compatible", "openai-compatible", "compatible_openai", "openai_compat"}:
            return {
                "api_key": config.openai_compatible_api_key,
                "api_base_url": config.openai_compatible_base_url,
                "api_model": config.openai_compatible_model or config.llm_api_model,
            }
        return {"api_key": "", "api_base_url": "", "api_model": config.llm_api_model}

    def add_listener(self, callback: Listener) -> None:
        self._listeners.append(callback)

    async def _emit(self, payload: dict) -> None:
        for listener in self._listeners:
            await listener(payload)

    async def _set_state(self, state: ModelState, engine: str | None = None) -> None:
        self._state = state
        await self._emit({"type": "model_state_changed", "engine": engine, "state": state.value, "vram": self.get_gpu_info()})

    @staticmethod
    def release_cuda_memory() -> None:
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                torch.cuda.ipc_collect()
        except Exception:
            pass

    def _read_nvidia_smi_gpu_info(self, device_index: int) -> dict | None:
        try:
            proc = subprocess.run(
                [
                    "nvidia-smi",
                    f"--id={int(device_index)}",
                    "--query-gpu=name,memory.total,memory.used,memory.free",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                check=False,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=3,
            )
        except Exception:
            return None
        if proc.returncode != 0:
            return None
        raw = (proc.stdout or "").strip().splitlines()
        if not raw:
            return None
        parts = [part.strip() for part in raw[0].split(",")]
        if len(parts) < 4:
            return None
        try:
            return {
                "name": ",".join(parts[:-3]).strip(),
                "total": int(float(parts[-3])),
                "used": int(float(parts[-2])),
                "free": int(float(parts[-1])),
            }
        except Exception:
            return None

    def _read_nvidia_smi_process_vram_mb(self) -> int:
        try:
            proc = subprocess.run(
                [
                    "nvidia-smi",
                    "--query-compute-apps=pid,used_memory",
                    "--format=csv,noheader,nounits",
                ],
                capture_output=True,
                check=False,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=3,
            )
        except Exception:
            return 0
        if proc.returncode != 0:
            return 0
        current_pid = os.getpid()
        process_used = 0
        for line in (proc.stdout or "").splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < 2:
                continue
            try:
                pid = int(parts[0])
            except Exception:
                continue
            if pid != current_pid:
                continue
            try:
                process_used = max(process_used, int(float(parts[-1])))
            except Exception:
                continue
        return process_used

    def _read_windows_process_vram_mb(self, *, ttl_seconds: float = 15.0) -> tuple[int, str]:
        if os.name != "nt":
            return 0, ""
        now = time.monotonic()
        expires_at, cached_value, cached_source = self._windows_process_vram_cache
        if now < expires_at:
            return cached_value, cached_source
        counter = f"\\GPU Process Memory(pid_{os.getpid()}*)\\Dedicated Usage"
        try:
            proc = subprocess.run(
                ["typeperf", counter, "-sc", "1"],
                capture_output=True,
                check=False,
                text=True,
                encoding="utf-8",
                errors="ignore",
                timeout=6,
            )
        except Exception:
            self._windows_process_vram_cache = (now + ttl_seconds, 0, "")
            return 0, ""
        if proc.returncode != 0:
            self._windows_process_vram_cache = (now + ttl_seconds, 0, "")
            return 0, ""
        rows: list[list[str]] = []
        try:
            rows = list(csv.reader(io.StringIO(proc.stdout or "")))
        except Exception:
            rows = []
        process_bytes = 0.0
        for row in rows:
            if len(row) < 2:
                continue
            if not str(row[0] or "").strip() or "PDH-CSV" in str(row[0]):
                continue
            for value in row[1:]:
                try:
                    process_bytes += max(0.0, float(str(value or "0").strip()))
                except Exception:
                    continue
            if process_bytes > 0:
                break
        process_mb = int(process_bytes / 1024 / 1024) if process_bytes > 0 else 0
        source = "windows-counter" if process_mb > 0 else ""
        self._windows_process_vram_cache = (now + ttl_seconds, process_mb, source)
        return process_mb, source

    async def update_config(self, payload: OrchestratorConfig) -> dict:
        self._config = self._normalize_music_config(payload)
        if hasattr(self._llm, "enable_llama_cpp_think_mode"):
            self._llm.enable_llama_cpp_think_mode = payload.enable_llama_cpp_think_mode
        return asdict(self._config)

    def get_gpu_info(self) -> dict:
        default = GpuInfo()
        try:
            import torch

            if torch.cuda.is_available():
                dev = torch.cuda.current_device()
                total = int(torch.cuda.get_device_properties(dev).total_memory)
                allocated = int(torch.cuda.memory_allocated(dev))
                reserved = int(torch.cuda.memory_reserved(dev))
                used = max(allocated, reserved)
                free = max(0, total - used)
                name = torch.cuda.get_device_name(dev)
                info = GpuInfo(
                    device_name=name,
                    name=name,
                    total_vram_mb=int(total / 1024 / 1024),
                    used_vram_mb=int(used / 1024 / 1024),
                    free_vram_mb=int(free / 1024 / 1024),
                    system_used_vram_mb=int(used / 1024 / 1024),
                    system_free_vram_mb=int(free / 1024 / 1024),
                    process_used_vram_mb=int(used / 1024 / 1024),
                    torch_allocated_mb=int(allocated / 1024 / 1024),
                    torch_reserved_mb=int(reserved / 1024 / 1024),
                )
                smi_info = self._read_nvidia_smi_gpu_info(int(dev))
                if smi_info:
                    info.name = str(smi_info.get("name") or info.name)
                    info.device_name = info.name
                    info.total_vram_mb = int(smi_info.get("total") or info.total_vram_mb)
                    info.system_used_vram_mb = int(smi_info.get("used") or info.system_used_vram_mb)
                    info.system_free_vram_mb = int(smi_info.get("free") or max(0, info.total_vram_mb - info.system_used_vram_mb))
                    info.used_vram_mb = info.system_used_vram_mb
                    info.free_vram_mb = info.system_free_vram_mb
                    info.system_vram_source = "nvidia-smi"
                    smi_process_used = self._read_nvidia_smi_process_vram_mb()
                    if smi_process_used > 0:
                        info.process_used_vram_mb = smi_process_used
                        info.process_vram_source = "nvidia-smi"
                windows_process_used, windows_process_source = self._read_windows_process_vram_mb()
                if windows_process_used > 0:
                    info.process_used_vram_mb = windows_process_used
                    info.process_vram_source = windows_process_source
                try:
                    import pynvml  # type: ignore

                    pynvml.nvmlInit()
                    handle = pynvml.nvmlDeviceGetHandleByIndex(int(dev))
                    mem_info = pynvml.nvmlDeviceGetMemoryInfo(handle)
                    nvml_name = pynvml.nvmlDeviceGetName(handle)
                    if isinstance(nvml_name, bytes):
                        nvml_name = nvml_name.decode("utf-8", errors="ignore")
                    info.name = str(nvml_name or info.name)
                    info.device_name = info.name
                    info.total_vram_mb = int(int(mem_info.total) / 1024 / 1024)
                    info.system_used_vram_mb = int(int(mem_info.used) / 1024 / 1024)
                    info.system_free_vram_mb = int(int(mem_info.free) / 1024 / 1024)
                    info.used_vram_mb = info.system_used_vram_mb
                    info.free_vram_mb = info.system_free_vram_mb
                    info.system_vram_source = "nvml"
                    current_pid = os.getpid()
                    process_used = 0
                    try:
                        processes = list(pynvml.nvmlDeviceGetComputeRunningProcesses(handle) or [])
                        try:
                            processes.extend(list(pynvml.nvmlDeviceGetGraphicsRunningProcesses(handle) or []))
                        except Exception:
                            pass
                        for proc in processes:
                            if int(getattr(proc, "pid", 0) or 0) != current_pid:
                                continue
                            used_gpu_memory = int(getattr(proc, "usedGpuMemory", 0) or 0)
                            if used_gpu_memory > 0:
                                process_used = max(process_used, int(used_gpu_memory / 1024 / 1024))
                    except Exception:
                        process_used = 0
                    if process_used > 0:
                        info.process_used_vram_mb = process_used
                        info.process_vram_source = "nvml"
                except Exception:
                    pass
                return asdict(
                    info
                )
        except Exception:
            pass
        return asdict(default)

    async def ensure_llm_ready(self) -> None:
        async with self._lock:
            if self._music is not None and getattr(self._music, "is_loaded", False) and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_MUSIC, "music")
                await self._music.unload_model()
                self.release_cuda_memory()
            if self._asr is not None and getattr(self._asr, "is_loaded", False) and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_ASR, "asr")
                await self._asr.unload_model()
                self.release_cuda_memory()
            if self._tts.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
                await self._tts.unload_model()
                self.release_cuda_memory()
            need_reload = False
            api_load_options = self._llm_api_load_options(self._config)
            if getattr(self._llm, "is_loaded", False) and hasattr(self._llm, "needs_reload"):
                need_reload = self._llm.needs_reload(
                    model_path=self._config.llm_model_path,
                    clip_model_path=self._config.llm_clip_model_path,
                    n_ctx=self._config.llm_n_ctx,
                    n_gpu_layers=self._config.llm_n_gpu_layers,
                    backend=self._config.llm_backend,
                    n_threads=self._config.llm_threads,
                    **api_load_options,
                )
            if need_reload:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
                self.release_cuda_memory()
            if not self._llm.is_loaded:
                await self._set_state(ModelState.LOADING_LLM, "llm")
                await self._llm.load_model(
                    model_path=self._config.llm_model_path,
                    clip_model_path=self._config.llm_clip_model_path,
                    n_ctx=self._config.llm_n_ctx,
                    n_gpu_layers=self._config.llm_n_gpu_layers,
                    backend=self._config.llm_backend,
                    n_threads=self._config.llm_threads,
                    **api_load_options,
                )
            await self._set_state(ModelState.LLM_READY, "llm")

    async def ensure_tts_ready(self, *, tts_backend: str = "omnivoice") -> None:
        async with self._lock:
            if self._music is not None and getattr(self._music, "is_loaded", False) and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_MUSIC, "music")
                await self._music.unload_model()
                self.release_cuda_memory()
            if self._asr is not None and getattr(self._asr, "is_loaded", False) and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_ASR, "asr")
                await self._asr.unload_model()
                self.release_cuda_memory()
            if self._llm.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
                self.release_cuda_memory()
            backend = (tts_backend or "omnivoice").strip().lower()
            if backend not in {"omnivoice", "voxcpm2", "mock"}:
                backend = "omnivoice"
            model_path = self._config.tts_model_path
            if backend == "voxcpm2":
                model_path = self._config.voxcpm_tts_model_path

            need_reload = False
            if getattr(self._tts, "is_loaded", False) and hasattr(self._tts, "needs_reload"):
                need_reload = bool(
                    self._tts.needs_reload(
                        backend=backend,
                        model_path=model_path,
                        device=self._config.tts_device,
                    )
                )
            if need_reload:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
                await self._tts.unload_model()
                self.release_cuda_memory()

            if not self._tts.is_loaded:
                await self._set_state(ModelState.LOADING_TTS, "tts")
                await self._tts.load_model(model_path, self._config.tts_device, backend=backend)
            await self._set_state(ModelState.TTS_READY, "tts")

    async def ensure_music_ready(self) -> None:
        if self._music is None:
            raise RuntimeError("Music engine is not configured")
        if not self._config.music_enabled:
            raise RuntimeError("音乐生成功能未启用（music_enabled=false）")
        self._config = self._normalize_music_config(self._config)
        active_model_dir = self.get_active_music_model_dir(self._config)
        async with self._lock:
            if self._asr is not None and getattr(self._asr, "is_loaded", False) and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_ASR, "asr")
                await self._asr.unload_model()
                self.release_cuda_memory()
            if self._llm.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
                self.release_cuda_memory()
            if self._tts.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
                await self._tts.unload_model()
                self.release_cuda_memory()

            need_reload = False
            if getattr(self._music, "is_loaded", False) and hasattr(self._music, "needs_reload"):
                need_reload = bool(
                    self._music.needs_reload(
                        model_dir=active_model_dir,
                        device_mode=self._config.music_device_mode,
                    )
                )
            if need_reload:
                await self._set_state(ModelState.UNLOADING_MUSIC, "music")
                await self._music.unload_model()
                self.release_cuda_memory()
            if not getattr(self._music, "is_loaded", False):
                await self._set_state(ModelState.LOADING_MUSIC, "music")
                await self._music.load_model(
                    active_model_dir,
                    self._config.music_device_mode,
                )
            await self._set_state(ModelState.MUSIC_READY, "music")

    async def ensure_asr_ready(self, *, backend: str | None = None) -> None:
        if self._asr is None:
            raise RuntimeError("ASR engine is not configured")
        target_backend = str(backend or self._config.asr_backend or "whisper").strip().lower() or "whisper"
        async with self._lock:
            if self._music is not None and getattr(self._music, "is_loaded", False) and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_MUSIC, "music")
                await self._music.unload_model()
                self.release_cuda_memory()
            if self._llm.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
                self.release_cuda_memory()
            if self._tts.is_loaded and self._config.auto_serial:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
                await self._tts.unload_model()
                self.release_cuda_memory()
            need_reload = True
            if hasattr(self._asr, "needs_reload"):
                need_reload = bool(
                    self._asr.needs_reload(
                        model_path=self._config.asr_model_path,
                        device=self._config.asr_device,
                        backend=target_backend,
                    )
                )
            if need_reload:
                await self._set_state(ModelState.LOADING_ASR, "asr")
                await self._asr.load_model(
                    model_path=self._config.asr_model_path,
                    device=self._config.asr_device,
                    backend=target_backend,
                )
            await self._set_state(ModelState.ASR_READY, "asr")

    async def unload_llm(self) -> None:
        async with self._lock:
            if self._llm.is_loaded:
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
            self.release_cuda_memory()
            await self._set_state(ModelState.IDLE, "llm")

    async def unload_tts(self) -> None:
        async with self._lock:
            if self._tts.is_loaded:
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
            await self._tts.unload_model()
            self.release_cuda_memory()
            await self._set_state(ModelState.IDLE, "tts")

    async def unload_music(self) -> None:
        if self._music is None:
            return
        async with self._lock:
            if getattr(self._music, "is_loaded", False):
                await self._set_state(ModelState.UNLOADING_MUSIC, "music")
            await self._music.unload_model()
            self.release_cuda_memory()
            await self._set_state(ModelState.IDLE, "music")

    async def unload_asr(self) -> None:
        if self._asr is None:
            return
        async with self._lock:
            if getattr(self._asr, "is_loaded", False):
                await self._set_state(ModelState.UNLOADING_ASR, "asr")
            await self._asr.unload_model()
            self.release_cuda_memory()
            await self._set_state(ModelState.IDLE, "asr")

    async def unload_all(self) -> None:
        async with self._lock:
            if getattr(self._llm, "is_loaded", False):
                await self._set_state(ModelState.UNLOADING_LLM, "llm")
                await self._llm.unload_model()
                self.release_cuda_memory()
            if getattr(self._tts, "is_loaded", False):
                await self._set_state(ModelState.UNLOADING_TTS, "tts")
                await self._tts.unload_model()
                self.release_cuda_memory()
            if self._music is not None and getattr(self._music, "is_loaded", False):
                await self._set_state(ModelState.UNLOADING_MUSIC, "music")
                await self._music.unload_model()
                self.release_cuda_memory()
            if self._asr is not None and getattr(self._asr, "is_loaded", False):
                await self._set_state(ModelState.UNLOADING_ASR, "asr")
                await self._asr.unload_model()
                self.release_cuda_memory()
            self.release_cuda_memory()
            await self._set_state(ModelState.IDLE, "all")

    async def get_status(self) -> dict:
        self._config = self._normalize_music_config(self._config)
        llm_loaded = bool(self._llm.is_loaded)
        tts_loaded = bool(self._tts.is_loaded)
        music_loaded = bool(getattr(self._music, "is_loaded", False)) if self._music is not None else False
        asr_loaded = bool(getattr(self._asr, "is_loaded", False)) if self._asr is not None else False
        llm_error = getattr(self._llm, "last_error", "")
        tts_error = getattr(self._tts, "last_error", "")
        music_error = getattr(self._music, "last_error", "") if self._music is not None else ""
        asr_error = getattr(self._asr, "last_error", "") if self._asr is not None else ""
        llm_backend = getattr(self._llm, "backend_name", "unknown")
        tts_backend = getattr(self._tts, "backend_name", "unknown")
        music_backend = getattr(self._music, "backend_name", "unknown") if self._music is not None else "disabled"
        asr_backend = getattr(self._asr, "backend_name", "unknown") if self._asr is not None else "disabled"
        llm_status = "ready" if llm_loaded else ("error" if llm_error else "idle")
        tts_status = "ready" if tts_loaded else ("error" if tts_error else "idle")
        music_status = "ready" if music_loaded else ("error" if music_error else "idle")
        asr_status = "ready" if asr_loaded else ("error" if asr_error else "idle")
        llm_fallback_active = bool(
            llm_loaded
            and llm_backend == "mock"
            and self._config.llm_backend != "mock"
            and llm_error
        )
        llm_think_mode_effective = bool(getattr(self._llm, "think_mode_effective", False))
        llm_think_mode_support = str(getattr(self._llm, "think_mode_support", "unknown"))
        llm_load_mode = str(getattr(self._llm, "last_load_mode", ""))
        llm_handler_fallback_reason = str(getattr(self._llm, "handler_fallback_reason", ""))
        return {
            "state": self._state.value,
            "auto_serial": self._config.auto_serial,
            "llm_loaded": llm_loaded,
            "tts_loaded": tts_loaded,
            "music_loaded": music_loaded,
            "asr_loaded": asr_loaded,
            "llm_status": llm_status,
            "tts_status": tts_status,
            "music_status": music_status,
            "asr_status": asr_status,
            "llm_backend": llm_backend,
            "tts_backend": tts_backend,
            "music_backend": music_backend,
            "asr_backend": asr_backend,
            "llm_error": llm_error,
            "tts_error": tts_error,
            "music_error": music_error,
            "asr_error": asr_error,
            "llm_fallback_active": llm_fallback_active,
            "llm_think_mode_effective": llm_think_mode_effective,
            "llm_think_mode_support": llm_think_mode_support,
            "llm_load_mode": llm_load_mode,
            "llm_handler_fallback_reason": llm_handler_fallback_reason,
            "gpu": self.get_gpu_info(),
            "config": public_orchestrator_config(self._config),
        }
