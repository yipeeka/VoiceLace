import { create } from "zustand";
import { api } from "../utils/api";

export const useSettingsStore = create((set, get) => ({
  systemStatus: null,
  orchestratorConfig: null,
  setSystemStatus: (systemStatus) => set({ systemStatus }),

  refreshSystemStatus: async () => {
    try {
      const status = await api.get("/system/status");
      set({ systemStatus: status });
    } catch {
      // fail silently — backend may not be fully up yet
    }
  },

  loadOrchestratorConfig: async () => {
    try {
      const status = await api.get("/system/status");
      const raw = status?.config ?? null;
      const config = raw
        ? {
            ...raw,
            tts_model_dir: raw.tts_model_path ?? "",
            auto_serial_mode: Boolean(raw.auto_serial),
            enable_llama_cpp_think_mode: Boolean(raw.enable_llama_cpp_think_mode ?? true),
            llm_n_layer: Number(raw.llm_n_gpu_layers ?? -1),
            llm_threads: Number(raw.llm_threads ?? 0),
            llm_temperature: Number(raw.llm_temperature ?? 0.2),
            llm_top_p: Number(raw.llm_top_p ?? 0.9),
            llm_top_k: Number(raw.llm_top_k ?? 40),
            llm_min_p: Number(raw.llm_min_p ?? 0),
            llm_presence_penalty: Number(raw.llm_presence_penalty ?? 0),
            llm_repeat_penalty: Number(raw.llm_repeat_penalty ?? 1),
            llm_max_tokens: Number(raw.llm_max_tokens ?? 2048),
            llm_backend: raw.llm_backend ?? "llama_cpp",
            llm_api_model: raw.llm_api_model ?? "",
            asr_model_path: raw.asr_model_path ?? "base",
            asr_device: raw.asr_device ?? "cuda:0",
            default_system_prompt: raw.default_system_prompt ?? "",
          }
        : null;
      set({ orchestratorConfig: config });
      return config;
    } catch {
      return null;
    }
  },

  saveOrchestratorConfig: async (config) => {
    try {
      const payload = {
        auto_serial: Boolean(config.auto_serial ?? config.auto_serial_mode),
        auto_unload_llm_after_parse: Boolean(config.auto_unload_llm_after_parse ?? true),
        auto_load_tts_before_synth: Boolean(config.auto_load_tts_before_synth ?? true),
        enable_llama_cpp_think_mode: Boolean(config.enable_llama_cpp_think_mode ?? true),
        llm_model_path: config.llm_model_path ?? "",
        llm_backend: config.llm_backend ?? "llama_cpp",
        llm_api_model: config.llm_api_model ?? "",
        llm_n_ctx: Number(config.llm_n_ctx ?? 8192),
        llm_n_gpu_layers: Number(config.llm_n_layer ?? config.llm_n_gpu_layers ?? -1),
        llm_threads: Number(config.llm_threads ?? 0),
        llm_temperature: Number(config.llm_temperature ?? 0.2),
        llm_top_p: Number(config.llm_top_p ?? 0.9),
        llm_top_k: Number(config.llm_top_k ?? 40),
        llm_min_p: Number(config.llm_min_p ?? 0),
        llm_presence_penalty: Number(config.llm_presence_penalty ?? 0),
        llm_repeat_penalty: Number(config.llm_repeat_penalty ?? 1),
        llm_max_tokens: Number(config.llm_max_tokens ?? 2048),
        tts_model_path: config.tts_model_path ?? config.tts_model_dir ?? "",
        tts_device: config.tts_device ?? "cuda:0",
        asr_model_path: config.asr_model_path ?? "base",
        asr_device: config.asr_device ?? "cuda:0",
      };
      const saved = await api.put("/system/orchestrator/config", payload);
      set({
        orchestratorConfig: {
          ...saved,
          tts_model_dir: saved.tts_model_path ?? "",
          auto_serial_mode: Boolean(saved.auto_serial),
          enable_llama_cpp_think_mode: Boolean(saved.enable_llama_cpp_think_mode ?? true),
          llm_n_layer: Number(saved.llm_n_gpu_layers ?? -1),
          llm_threads: Number(saved.llm_threads ?? 0),
          llm_temperature: Number(saved.llm_temperature ?? 0.2),
          llm_top_p: Number(saved.llm_top_p ?? 0.9),
          llm_top_k: Number(saved.llm_top_k ?? 40),
          llm_min_p: Number(saved.llm_min_p ?? 0),
          llm_presence_penalty: Number(saved.llm_presence_penalty ?? 0),
          llm_repeat_penalty: Number(saved.llm_repeat_penalty ?? 1),
          llm_max_tokens: Number(saved.llm_max_tokens ?? 2048),
          llm_backend: saved.llm_backend ?? "llama_cpp",
          llm_api_model: saved.llm_api_model ?? "",
          asr_model_path: saved.asr_model_path ?? "base",
          asr_device: saved.asr_device ?? "cuda:0",
          default_system_prompt: "",
        },
      });
      return saved;
    } catch {
      return null;
    }
  },

  resetOrchestratorConfig: async () => {
    try {
      const saved = await api.post("/system/orchestrator/config/reset", {});
      set({
        orchestratorConfig: {
          ...saved,
          tts_model_dir: saved.tts_model_path ?? "",
          auto_serial_mode: Boolean(saved.auto_serial),
          enable_llama_cpp_think_mode: Boolean(saved.enable_llama_cpp_think_mode ?? true),
          llm_n_layer: Number(saved.llm_n_gpu_layers ?? -1),
          llm_threads: Number(saved.llm_threads ?? 0),
          llm_temperature: Number(saved.llm_temperature ?? 0.2),
          llm_top_p: Number(saved.llm_top_p ?? 0.9),
          llm_top_k: Number(saved.llm_top_k ?? 40),
          llm_min_p: Number(saved.llm_min_p ?? 0),
          llm_presence_penalty: Number(saved.llm_presence_penalty ?? 0),
          llm_repeat_penalty: Number(saved.llm_repeat_penalty ?? 1),
          llm_max_tokens: Number(saved.llm_max_tokens ?? 2048),
          llm_backend: saved.llm_backend ?? "llama_cpp",
          llm_api_model: saved.llm_api_model ?? "",
          asr_model_path: saved.asr_model_path ?? "base",
          asr_device: saved.asr_device ?? "cuda:0",
          default_system_prompt: "",
        },
      });
      return saved;
    } catch {
      return null;
    }
  },

  manualUnloadLLM: async () => {
    try {
      await api.post("/system/unload-llm", {});
      await get().refreshSystemStatus();
    } catch {
      // ignore
    }
  },

  manualUnloadTTS: async () => {
    try {
      await api.post("/system/unload-tts", {});
      await get().refreshSystemStatus();
    } catch {
      // ignore
    }
  },
}));
