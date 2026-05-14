import { create } from "zustand";

import { api } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { getLanguage } from "../i18n/core";
import { MESSAGES } from "../i18n/messages";
import { useUiStore } from "./useUiStore";

function t(key, params = {}) {
  const language = getLanguage();
  const dict = MESSAGES[language] || MESSAGES.zh;
  const template = dict[key] || MESSAGES.en?.[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
}

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
      const message = getErrorMessage(error, t("store.voice.error.loadPresets"));
      set({ isLoading: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.loadPresets"), message), tone: "error" });
      throw error;
    }
  },
  createPreset: async (payload) => {
    set({ isSaving: true, error: "" });
    try {
      const preset = await api.post("/voices/presets", payload);
      set((state) => ({ presets: [...state.presets, preset], isSaving: false }));
      useUiStore.getState().pushToast({ title: t("store.voice.toast.presetCreated", { name: preset.name }), tone: "success" });
      return preset;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.createPreset"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.createPreset"), message), tone: "error" });
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
      useUiStore.getState().pushToast({ title: t("store.voice.toast.presetUpdated", { name: preset.name }), tone: "success" });
      return preset;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.updatePreset"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.updatePreset"), message), tone: "error" });
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
      useUiStore.getState().pushToast({ title: t("store.voice.toast.presetDeleted"), tone: "success" });
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.deletePreset"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.deletePreset"), message), tone: "error" });
      throw error;
    }
  },
  reorderPresets: async (orderedIds) => {
    const previousPresets = useVoiceStore.getState().presets;
    set({ isSaving: true, error: "", presets: reorderByIds(previousPresets, orderedIds) });
    try {
      const presets = await api.post("/voices/presets/reorder", { preset_ids: orderedIds });
      set({ presets, isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.voice.toast.presetOrderSaved"), tone: "success" });
      return presets;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.reorderPresets"));
      set({ presets: previousPresets, isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.reorderPresets"), message), tone: "error" });
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
      useUiStore.getState().pushToast({ title: t("store.voice.toast.assignmentsSaved"), tone: "success" });
      return assignments;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.saveAssignments"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.saveAssignments"), message), tone: "error" });
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
        title: t("store.voice.toast.previewGenerated", { backend: backendName.toUpperCase() }),
        tone: "success",
      });
      return url;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.preview"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.preview"), message), tone: "error" });
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
      useUiStore.getState().pushToast({ title: t("store.voice.toast.referenceUploaded"), tone: "success" });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.upload"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.upload"), message), tone: "error" });
      throw error;
    }
  },
  transcribeAudio: async (audioPath) => {
    set({ isTranscribing: true, error: "" });
    try {
      const result = await api.post("/voices/transcribe", { audio_path: audioPath });
      set({ transcribedRefText: result.text || "", isTranscribing: false });
      useUiStore.getState().pushToast({ title: t("store.voice.toast.transcribeDone"), tone: "success" });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.transcribe"));
      set({ isTranscribing: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.transcribe"), message), tone: "error" });
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
      useUiStore.getState().pushToast({ title: t("store.voice.toast.qualityChecked"), tone: "success" });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.qualityCheck"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.qualityCheck"), message), tone: "error" });
      throw error;
    }
  },
  fetchPresetRecommendations: async ({ projectId, backend = "omnivoice", limit = 3, source = "secondary_local" }) => {
    set({ isLoading: true, error: "" });
    try {
      const result = await api.post("/voices/recommend", {
        project_id: projectId,
        backend,
        limit,
        source,
      });
      set({ presetRecommendations: result, isLoading: false });
      const sourceUsed = (result?.source_used || source || "").trim();
      if (sourceUsed === "rule_fallback") {
        useUiStore.getState().pushToast({ title: t("store.voice.toast.llmFallbackToRule"), tone: "warning" });
      }
      return result;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.recommend"));
      set({ isLoading: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.recommend"), message), tone: "error" });
      throw error;
    }
  },
  unloadRecommendationModel: async (source = "secondary_local") => {
    set({ isSaving: true, error: "" });
    try {
      const sourceName = (source || "secondary_local").trim();
      const endpoint = sourceName === "primary_local" ? "/system/unload-llm" : "/llm/translation-engine/unload";
      const result = await api.post(endpoint, {});
      set({ isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.voice.toast.recommendModelUnloaded"), tone: "success" });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, t("store.voice.error.unloadRecommendModel"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.voice.error.unloadRecommendModel"), message), tone: "error" });
      throw error;
    }
  },
}));
