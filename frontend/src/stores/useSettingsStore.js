import { create } from "zustand";
import { api } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { useUiStore } from "./useUiStore";

function normalizeOrchestratorConfig(raw) {
  if (!raw) {
    return null;
  }
  return {
    ...raw,
    auto_serial: Boolean(raw.auto_serial),
    auto_unload_llm_after_parse: Boolean(raw.auto_unload_llm_after_parse ?? true),
    auto_load_tts_before_synth: Boolean(raw.auto_load_tts_before_synth ?? true),
    debug_stale_report: Boolean(raw.debug_stale_report ?? false),
    enable_llama_cpp_think_mode: Boolean(raw.enable_llama_cpp_think_mode ?? true),
    llm_backend: raw.llm_backend ?? "llama_cpp",
    llm_model_path: raw.llm_model_path ?? "",
    llm_clip_model_path: raw.llm_clip_model_path ?? "",
    llm_api_model: raw.llm_api_model ?? "",
    llm_n_ctx: Number(raw.llm_n_ctx ?? 8192),
    llm_n_gpu_layers: Number(raw.llm_n_gpu_layers ?? -1),
    llm_threads: Number(raw.llm_threads ?? 0),
    llm_temperature: Number(raw.llm_temperature ?? 0.2),
    llm_top_p: Number(raw.llm_top_p ?? 0.9),
    llm_top_k: Number(raw.llm_top_k ?? 40),
    llm_min_p: Number(raw.llm_min_p ?? 0),
    llm_presence_penalty: Number(raw.llm_presence_penalty ?? 0),
    llm_repeat_penalty: Number(raw.llm_repeat_penalty ?? 1),
    llm_max_tokens: Number(raw.llm_max_tokens ?? 2048),
    secondary_llm_model_path: raw.secondary_llm_model_path ?? "",
    secondary_llm_clip_model_path: raw.secondary_llm_clip_model_path ?? "",
    secondary_llm_n_ctx: Number(raw.secondary_llm_n_ctx ?? 4096),
    secondary_llm_n_gpu_layers: Number(raw.secondary_llm_n_gpu_layers ?? -1),
    secondary_llm_threads: Number(raw.secondary_llm_threads ?? 0),
    secondary_llm_temperature: Number(raw.secondary_llm_temperature ?? 0.2),
    secondary_llm_top_p: Number(raw.secondary_llm_top_p ?? 0.9),
    secondary_llm_top_k: Number(raw.secondary_llm_top_k ?? 40),
    secondary_llm_min_p: Number(raw.secondary_llm_min_p ?? 0),
    secondary_llm_presence_penalty: Number(raw.secondary_llm_presence_penalty ?? 0),
    secondary_llm_repeat_penalty: Number(raw.secondary_llm_repeat_penalty ?? 1),
    secondary_llm_max_tokens: Number(raw.secondary_llm_max_tokens ?? 1024),
    secondary_enable_llama_cpp_think_mode: Boolean(raw.secondary_enable_llama_cpp_think_mode ?? false),
    tts_model_path: raw.tts_model_path ?? "",
    voxcpm_tts_model_path: raw.voxcpm_tts_model_path ?? "openbmb/VoxCPM2",
    tts_device: raw.tts_device ?? "cuda:0",
    music_enabled: Boolean(raw.music_enabled ?? false),
    music_model_dir: raw.music_model_dir ?? "",
    music_device_mode: raw.music_device_mode ?? "cpu_offload",
    asr_model_path: raw.asr_model_path ?? "base",
    asr_device: raw.asr_device ?? "cuda:0",
    pyannote_model_id: raw.pyannote_model_id ?? "pyannote/speaker-diarization-community-1",
    pyannote_auth_token: raw.pyannote_auth_token ?? "",
    pyannote_device: raw.pyannote_device ?? "cuda:0",
    default_system_prompt: raw.default_system_prompt ?? "",
  };
}

function toOrchestratorPayload(config) {
  return {
    auto_serial: Boolean(config.auto_serial ?? true),
    auto_unload_llm_after_parse: Boolean(config.auto_unload_llm_after_parse ?? true),
    auto_load_tts_before_synth: Boolean(config.auto_load_tts_before_synth ?? true),
    debug_stale_report: Boolean(config.debug_stale_report ?? false),
    enable_llama_cpp_think_mode: Boolean(config.enable_llama_cpp_think_mode ?? true),
    llm_model_path: config.llm_model_path ?? "",
    llm_clip_model_path: config.llm_clip_model_path ?? "",
    llm_backend: config.llm_backend ?? "llama_cpp",
    llm_api_model: config.llm_api_model ?? "",
    llm_n_ctx: Number(config.llm_n_ctx ?? 8192),
    llm_n_gpu_layers: Number(config.llm_n_gpu_layers ?? -1),
    llm_threads: Number(config.llm_threads ?? 0),
    llm_temperature: Number(config.llm_temperature ?? 0.2),
    llm_top_p: Number(config.llm_top_p ?? 0.9),
    llm_top_k: Number(config.llm_top_k ?? 40),
    llm_min_p: Number(config.llm_min_p ?? 0),
    llm_presence_penalty: Number(config.llm_presence_penalty ?? 0),
    llm_repeat_penalty: Number(config.llm_repeat_penalty ?? 1),
    llm_max_tokens: Number(config.llm_max_tokens ?? 2048),
    secondary_llm_model_path: config.secondary_llm_model_path ?? "",
    secondary_llm_clip_model_path: config.secondary_llm_clip_model_path ?? "",
    secondary_llm_n_ctx: Number(config.secondary_llm_n_ctx ?? 4096),
    secondary_llm_n_gpu_layers: Number(config.secondary_llm_n_gpu_layers ?? -1),
    secondary_llm_threads: Number(config.secondary_llm_threads ?? 0),
    secondary_llm_temperature: Number(config.secondary_llm_temperature ?? 0.2),
    secondary_llm_top_p: Number(config.secondary_llm_top_p ?? 0.9),
    secondary_llm_top_k: Number(config.secondary_llm_top_k ?? 40),
    secondary_llm_min_p: Number(config.secondary_llm_min_p ?? 0),
    secondary_llm_presence_penalty: Number(config.secondary_llm_presence_penalty ?? 0),
    secondary_llm_repeat_penalty: Number(config.secondary_llm_repeat_penalty ?? 1),
    secondary_llm_max_tokens: Number(config.secondary_llm_max_tokens ?? 1024),
    secondary_enable_llama_cpp_think_mode: Boolean(config.secondary_enable_llama_cpp_think_mode ?? false),
    tts_model_path: config.tts_model_path ?? "",
    voxcpm_tts_model_path: config.voxcpm_tts_model_path ?? "openbmb/VoxCPM2",
    tts_device: config.tts_device ?? "cuda:0",
    music_enabled: Boolean(config.music_enabled ?? false),
    music_model_dir: config.music_model_dir ?? "",
    music_device_mode: config.music_device_mode ?? "cpu_offload",
    asr_model_path: config.asr_model_path ?? "base",
    asr_device: config.asr_device ?? "cuda:0",
    pyannote_model_id: config.pyannote_model_id ?? "pyannote/speaker-diarization-community-1",
    pyannote_auth_token: config.pyannote_auth_token ?? "",
    pyannote_device: config.pyannote_device ?? "cuda:0",
  };
}

export const useSettingsStore = create((set, get) => ({
  systemStatus: null,
  orchestratorConfig: null,
  settingsError: "",
  setSystemStatus: (systemStatus) => set({ systemStatus }),
  clearSettingsError: () => set({ settingsError: "" }),

  refreshSystemStatus: async () => {
    try {
      const status = await api.get("/system/status");
      set({ systemStatus: status, settingsError: "" });
      return status;
    } catch (error) {
      const message = getErrorMessage(error, "系统状态刷新失败");
      set({ settingsError: message });
      return null;
    }
  },

  loadOrchestratorConfig: async () => {
    try {
      const status = await api.get("/system/status");
      const config = normalizeOrchestratorConfig(status?.config ?? null);
      set({ orchestratorConfig: config, settingsError: "" });
      return config;
    } catch (error) {
      const message = getErrorMessage(error, "加载模型配置失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("加载模型配置失败", message), tone: "error" });
      return null;
    }
  },

  saveOrchestratorConfig: async (config) => {
    try {
      const payload = toOrchestratorPayload(config);
      const saved = await api.put("/system/orchestrator/config", payload);
      set({
        settingsError: "",
        orchestratorConfig: normalizeOrchestratorConfig(saved),
      });
      useUiStore.getState().pushToast({ title: "模型调度配置已保存", tone: "success" });
      return saved;
    } catch (error) {
      const message = getErrorMessage(error, "保存模型配置失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("保存模型配置失败", message), tone: "error" });
      return null;
    }
  },

  resetOrchestratorConfig: async () => {
    try {
      const saved = await api.post("/system/orchestrator/config/reset", {});
      set({
        settingsError: "",
        orchestratorConfig: normalizeOrchestratorConfig(saved),
      });
      useUiStore.getState().pushToast({ title: "已恢复默认配置", tone: "success" });
      return saved;
    } catch (error) {
      const message = getErrorMessage(error, "重置模型配置失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("重置模型配置失败", message), tone: "error" });
      return null;
    }
  },

  setCurrentConfigAsDefault: async () => {
    try {
      await api.post("/system/orchestrator/config/defaults/use-current", {});
      set({ settingsError: "" });
      useUiStore.getState().pushToast({ title: "已将当前参数设为默认值", tone: "success" });
      return true;
    } catch (error) {
      const message = getErrorMessage(error, "设置默认配置失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("设置默认配置失败", message), tone: "error" });
      return false;
    }
  },

  manualUnloadLLM: async () => {
    try {
      await api.post("/system/unload-llm", {});
      set({ settingsError: "" });
      useUiStore.getState().pushToast({ title: "LLM 已卸载", tone: "success" });
      await get().refreshSystemStatus();
    } catch (error) {
      const message = getErrorMessage(error, "卸载 LLM 失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("卸载 LLM 失败", message), tone: "error" });
    }
  },

  manualUnloadTTS: async () => {
    try {
      await api.post("/system/unload-tts", {});
      set({ settingsError: "" });
      useUiStore.getState().pushToast({ title: "TTS 已卸载", tone: "success" });
      await get().refreshSystemStatus();
    } catch (error) {
      const message = getErrorMessage(error, "卸载 TTS 失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("卸载 TTS 失败", message), tone: "error" });
    }
  },

  manualUnloadASR: async () => {
    try {
      await api.post("/system/unload-asr", {});
      set({ settingsError: "" });
      useUiStore.getState().pushToast({ title: "ASR 已卸载", tone: "success" });
      await get().refreshSystemStatus();
    } catch (error) {
      const message = getErrorMessage(error, "卸载 ASR 失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("卸载 ASR 失败", message), tone: "error" });
    }
  },

  manualUnloadMusic: async () => {
    try {
      await api.post("/system/unload-music", {});
      set({ settingsError: "" });
      useUiStore.getState().pushToast({ title: "Music 模型已卸载", tone: "success" });
      await get().refreshSystemStatus();
    } catch (error) {
      const message = getErrorMessage(error, "卸载 Music 模型失败");
      set({ settingsError: message });
      useUiStore.getState().pushToast({ title: formatError("卸载 Music 模型失败", message), tone: "error" });
    }
  },
}));
