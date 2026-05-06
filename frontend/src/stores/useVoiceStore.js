import { create } from "zustand";

import { api } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { useUiStore } from "./useUiStore";

function reorderByIds(items, orderedIds) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const seen = new Set();
  const ordered = [];

  orderedIds.forEach((id) => {
    if (seen.has(id) || !itemMap.has(id)) {
      return;
    }
    seen.add(id);
    ordered.push(itemMap.get(id));
  });

  items.forEach((item) => {
    if (!seen.has(item.id)) {
      ordered.push(item);
    }
  });

  return ordered;
}

export const useVoiceStore = create((set) => ({
  presets: [],
  assignments: {},
  previewAudioUrl: null,
  previewAudioBlob: null,
  previewMeta: null,
  previewSlots: {
    a: { presetId: "", audioUrl: null, audioBlob: null, meta: null, backend: "omnivoice" },
    b: { presetId: "", audioUrl: null, audioBlob: null, meta: null, backend: "omnivoice" },
  },
  presetRecommendations: null,
  uploadedRefAudioPath: "",
  lastReferenceQualityReport: null,
  transcribedRefText: "",
  isLoading: false,
  isSaving: false,
  isTranscribing: false,
  error: "",
  setPresets: (presets) => set({ presets }),
  setAssignments: (assignments) => set({ assignments }),
  setPreviewSlotPreset: (slot, presetId) =>
    set((state) => ({
      previewSlots: {
        ...state.previewSlots,
        [slot]: {
          ...(state.previewSlots?.[slot] || {}),
          presetId: presetId || "",
        },
      },
    })),
  setPreviewSlotBackend: (slot, backend) =>
    set((state) => ({
      previewSlots: {
        ...state.previewSlots,
        [slot]: {
          ...(state.previewSlots?.[slot] || {}),
          backend: (backend || "omnivoice").toLowerCase(),
        },
      },
    })),
  clearPresetRecommendations: () => set({ presetRecommendations: null }),
  assignVoice: (characterName, presetId) =>
    set((state) => ({
      assignments: {
        ...state.assignments,
        [characterName]: presetId,
      },
    })),
  loadPresets: async () => {
    set({ isLoading: true, error: "" });
    try {
      const presets = await api.get("/voices/presets");
      set({ presets, isLoading: false });
      return presets;
    } catch (error) {
      const message = getErrorMessage(error, "声音预设加载失败");
      set({ isLoading: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("声音预设加载失败", message), tone: "error" });
      throw error;
    }
  },
  createPreset: async (payload) => {
    set({ isSaving: true, error: "" });
    try {
      const preset = await api.post("/voices/presets", payload);
      set((state) => ({ presets: [...state.presets, preset], isSaving: false }));
      useUiStore.getState().pushToast({ title: `已创建预设：${preset.name}`, tone: "success" });
      return preset;
    } catch (error) {
      const message = getErrorMessage(error, "创建预设失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("创建预设失败", message), tone: "error" });
      throw error;
    }
  },
  updatePreset: async (presetId, payload) => {
    set({ isSaving: true, error: "" });
    try {
      const preset = await api.put(`/voices/presets/${presetId}`, payload);
      set((state) => ({
        presets: state.presets.map((item) => (item.id === presetId ? preset : item)),
        isSaving: false,
      }));
      useUiStore.getState().pushToast({ title: `已更新预设：${preset.name}`, tone: "success" });
      return preset;
    } catch (error) {
      const message = getErrorMessage(error, "更新预设失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("更新预设失败", message), tone: "error" });
      throw error;
    }
  },
  deletePreset: async (presetId) => {
    set({ isSaving: true, error: "" });
    try {
      await api.delete(`/voices/presets/${presetId}`);
      set((state) => ({
        presets: state.presets.filter((preset) => preset.id !== presetId),
        assignments: Object.fromEntries(Object.entries(state.assignments).filter(([, id]) => id !== presetId)),
        previewSlots: {
          a:
            state.previewSlots?.a?.presetId === presetId
              ? { presetId: "", audioUrl: null, audioBlob: null, meta: null, backend: "omnivoice" }
              : state.previewSlots?.a,
          b:
            state.previewSlots?.b?.presetId === presetId
              ? { presetId: "", audioUrl: null, audioBlob: null, meta: null, backend: "omnivoice" }
              : state.previewSlots?.b,
        },
        isSaving: false,
      }));
      useUiStore.getState().pushToast({ title: "声音预设已删除", tone: "success" });
    } catch (error) {
      const message = getErrorMessage(error, "删除预设失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("删除预设失败", message), tone: "error" });
      throw error;
    }
  },
  reorderPresets: async (orderedIds) => {
    const previousPresets = useVoiceStore.getState().presets;
    set({ isSaving: true, error: "", presets: reorderByIds(previousPresets, orderedIds) });
    try {
      const presets = await api.post("/voices/presets/reorder", { preset_ids: orderedIds });
      set({ presets, isSaving: false });
      useUiStore.getState().pushToast({ title: "预设顺序已保存", tone: "success" });
      return presets;
    } catch (error) {
      const message = getErrorMessage(error, "调整预设顺序失败");
      set({ presets: previousPresets, isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("调整预设顺序失败", message), tone: "error" });
      throw error;
    }
  },
  saveAssignments: async (projectId) => {
    set({ isSaving: true, error: "" });
    try {
      const assignments = await api.put(`/projects/${projectId}/voice-assignments`, {
        assignments: { ...useVoiceStore.getState().assignments },
      });
      set({ isSaving: false });
      useUiStore.getState().pushToast({ title: "角色声音分配已保存", tone: "success" });
      return assignments;
    } catch (error) {
      const message = getErrorMessage(error, "保存分配失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("保存分配失败", message), tone: "error" });
      throw error;
    }
  },
  previewVoice: async ({ preset, text, ttsBackend, sourceMode, slot = "" }) => {
    set({ isSaving: true, error: "" });
    try {
      const backendName = (ttsBackend || "omnivoice").toLowerCase();
      const blob = await api.postBlob("/voices/preview", {
        preset,
        text,
        tts_backend: backendName,
      });
      const previousUrl = slot
        ? useVoiceStore.getState().previewSlots?.[slot]?.audioUrl
        : useVoiceStore.getState().previewAudioUrl;
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      const url = URL.createObjectURL(blob);
      if (slot) {
        set((state) => ({
          previewSlots: {
            ...state.previewSlots,
            [slot]: {
              ...(state.previewSlots?.[slot] || {}),
              presetId: preset?.id || "",
              backend: backendName,
              audioUrl: url,
              audioBlob: blob,
              meta: {
                backend: backendName,
                source_mode: sourceMode || "design",
                text: text || "",
              },
            },
          },
          isSaving: false,
        }));
      } else {
        set({
          previewAudioUrl: url,
          previewAudioBlob: blob,
          previewMeta: {
            backend: backendName,
            source_mode: sourceMode || "design",
            text: text || "",
          },
          isSaving: false,
        });
      }
      useUiStore.getState().pushToast({
        title: `试听音频已生成（${backendName.toUpperCase()}）`,
        tone: "success",
      });
      return url;
    } catch (error) {
      const message = getErrorMessage(error, "试听失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("试听失败", message), tone: "error" });
      throw error;
    }
  },
  uploadReferenceAudio: async (file) => {
    set({ isSaving: true, error: "" });
    try {
      const result = await api.uploadFile("/voices/upload-ref", file);
      set({
        uploadedRefAudioPath: result.file_path,
        lastReferenceQualityReport: result.quality_report || null,
        isSaving: false,
      });
      useUiStore.getState().pushToast({ title: "参考音频上传成功", tone: "success" });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, "上传失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("上传失败", message), tone: "error" });
      throw error;
    }
  },
  transcribeAudio: async (audioPath) => {
    set({ isTranscribing: true, error: "" });
    try {
      const result = await api.post("/voices/transcribe", { audio_path: audioPath });
      set({ transcribedRefText: result.text || "", isTranscribing: false });
      useUiStore.getState().pushToast({ title: "ASR 转写完成", tone: "success" });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, "转写失败");
      set({ isTranscribing: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("转写失败", message), tone: "error" });
      throw error;
    }
  },
  checkPresetQuality: async (presetId, backend) => {
    set({ isSaving: true, error: "" });
    try {
      const payload = backend ? { backend } : {};
      const result = await api.post(`/voices/presets/${presetId}/quality-check`, payload);
      const updatedReports = result?.quality_reports || {};
      set((state) => ({
        presets: state.presets.map((item) =>
          item.id === presetId
            ? {
                ...item,
                quality_reports: {
                  ...(item.quality_reports || {}),
                  ...updatedReports,
                },
              }
            : item
        ),
        isSaving: false,
      }));
      useUiStore.getState().pushToast({ title: "参考音频质量检测完成", tone: "success" });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, "质量检测失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("质量检测失败", message), tone: "error" });
      throw error;
    }
  },
  fetchPresetRecommendations: async ({ projectId, backend = "omnivoice", limit = 3 }) => {
    set({ isLoading: true, error: "" });
    try {
      const result = await api.post("/voices/recommend", {
        project_id: projectId,
        backend,
        limit,
      });
      set({ presetRecommendations: result, isLoading: false });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, "推荐失败");
      set({ isLoading: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("推荐失败", message), tone: "error" });
      throw error;
    }
  },
}));
