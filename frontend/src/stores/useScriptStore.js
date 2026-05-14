import { create } from "zustand";

import { api, getWsBaseUrl } from "../utils/api.js";
import { formatError, getErrorMessage } from "../utils/errors.js";
import { getLanguage } from "../i18n/core.js";
import { MESSAGES } from "../i18n/messages.js";
import { runTaskChannel } from "../utils/taskChannel.js";
import { createTaskChannelBridge } from "../utils/taskChannelBridge.js";
import { useUiStore } from "./useUiStore.js";

function t(key, params = {}) {
  const language = getLanguage();
  const dict = MESSAGES[language] || MESSAGES.zh;
  const template = dict[key] || MESSAGES.en?.[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
}

const DEFAULT_PARSE_MODE = "verified_five_step_pipeline";
const PARSE_MODE_STORAGE_KEY = "beautyvoice.parse_mode";
const SUPPORTED_PARSE_MODES = new Set([
  "two_step_pipeline",
  "legacy_single_pass",
  "read_aloud_single_voice",
  "verified_five_step_pipeline",
]);

export const useScriptStore = create((set, get) => ({
  sourceText: "",
  llmStreamOutput: "",
  parseProgress: 0,
  parseMode: readParseModeFromStorage(),
  parseStage: "",
  parseStageLabel: "",
  parseStageProgress: 0,
  status: "idle",
  connectionStatus: "idle",
  modelStatus: "",
  lastSyncError: "",
  parseTaskId: null,
  parseStats: null,
  isParsing: false,
  isSaving: false,
  error: "",
  script: {
    title: "",
    source_text: "",
    segments: [],
    characters: [],
    metadata: {},
  },
  setSourceText: (sourceText) => set({ sourceText }),
  setLlmStreamOutput: (llmStreamOutput) => set({ llmStreamOutput }),
  setScript: (script) => set({ script }),
  setParseMode: (parseMode) => {
    const normalized = normalizeParseMode(parseMode);
    writeParseModeToStorage(normalized);
    set({ parseMode: normalized });
  },
  loadProjectScript: async (projectId) => {
    const script = await api.get(`/projects/${projectId}/script`);
    set({ script, sourceText: script.source_text || "" });
    return script;
  },
  parseText: async ({ text, projectId, prompt, parseMode }) => {
    const normalizedMode = normalizeParseMode(parseMode || get().parseMode);
    writeParseModeToStorage(normalizedMode);
    set({
      isParsing: true,
      status: "starting",
      connectionStatus: "connecting",
      modelStatus: t("store.script.status.connecting"),
      lastSyncError: "",
      error: "",
      parseProgress: 5,
      parseMode: normalizedMode,
      parseStage: "initializing",
      parseStageLabel: t("store.script.stage.preparing"),
      parseStageProgress: 5,
      llmStreamOutput: "",
      parseTaskId: null,
      parseStats: null,
    });
    try {
      const { task_id: taskId } = await api.post("/llm/parse", {
        text,
        system_prompt: prompt,
        project_id: projectId,
        parse_mode: normalizedMode,
      });
      set({ parseTaskId: taskId });
      const wsUrl = `${getWsBaseUrl()}/ws/llm-stream/${taskId}`;

      const finalizeWithScript = (script) => {
        set({
          isParsing: false,
          status: "done",
          modelStatus: "",
          lastSyncError: "",
          parseProgress: 100,
          parseStage: "done",
          parseStageLabel: t("store.script.stage.done"),
          parseStageProgress: 100,
          script,
          llmStreamOutput: JSON.stringify(script, null, 2),
          parseTaskId: null,
        });
        useUiStore.getState().pushToast({ title: t("store.script.toast.parseDoneWithCount", { count: script.segments.length }), tone: "success" });
        return script;
      };

      const channelBridge = createTaskChannelBridge({
        set,
        getStatus: () => useScriptStore.getState().status,
        maxReconnectRetries: 5,
        exhaustedMessage: t("store.script.error.connClosed"),
        timeoutMessage: t("store.script.error.timeout"),
        onReconnectOpenExtra: async () => {
          set((state) => ({
            llmStreamOutput: `${state.llmStreamOutput}${t("store.script.log.systemReconnected")}\n`,
          }));
        },
        onReconnectScheduledExtra: ({ reconnectAttempts, delay }) => {
          set((state) => ({
            llmStreamOutput: `${state.llmStreamOutput}\n${t("store.script.log.systemReconnectScheduled", { delay, attempt: reconnectAttempts })}\n`,
          }));
        },
        onExhaustedExtra: () => {
          set({
            isParsing: false,
            status: "error",
            modelStatus: "",
            error: t("store.script.error.connClosed"),
            parseProgress: 0,
            parseTaskId: null,
          });
        },
        onTimeoutExtra: () => {
          set({
            isParsing: false,
            status: "error",
            modelStatus: "",
            error: t("store.script.error.timeout"),
            parseProgress: 0,
            parseTaskId: null,
          });
        },
      });

      return await runTaskChannel({
        wsUrl,
        timeoutMs: 20 * 60 * 1000,
        maxTimeoutExtensions: 12,
        maxReconnectRetries: 5,
        baseDelayMs: 1000,
        shouldReconnect: channelBridge.shouldReconnect,
        onConnectionStatus: channelBridge.onConnectionStatus,
        onOpen: channelBridge.onOpen,
        syncTaskState: async ({ done }) => {
          try {
            const state = await api.get(`/llm/parse/${taskId}`);
            if (state && Array.isArray(state.segments)) {
              try {
                const statsResp = await api.get(`/llm/parse/${taskId}/stats`);
                const normalized = normalizeParseStats(statsResp?.parse_stats || null);
                if (normalized) {
                  set((prev) => ({
                    parseStats: normalized,
                    llmStreamOutput: prev.parseStats
                      ? prev.llmStreamOutput
                      : `${prev.llmStreamOutput}${buildParseStatsSummary(normalized)}`,
                  }));
                }
              } catch {
                // ignore stats pull failure in sync path
              }
              done(finalizeWithScript(state));
              return true;
            }
            if (state?.status) {
              set({
                status: state.status,
                modelStatus: state.status === "cancel_requested" ? t("store.script.status.canceling") : t("store.script.status.syncing"),
                lastSyncError: "",
                parseMode: normalizeParseMode(state.parse_mode || normalizedMode),
                parseStage: state.stage || "",
                parseStageLabel: state.stage_label || "",
                parseStageProgress: Number(state.stage_progress || 0) || 0,
              });
            }
            return false;
          } catch (error) {
            set({ lastSyncError: getErrorMessage(error, t("store.script.error.syncFailed")) });
            return false;
          }
        },
        onReconnectScheduled: ({ reconnectAttempts, delay }) => {
          channelBridge.onReconnectScheduled({ reconnectAttempts, delay });
        },
        onReconnectExhausted: channelBridge.onReconnectExhausted,
        onTimeout: channelBridge.onTimeout,
        onMessage: ({ msg, done, fail }) => {
          switch (msg.type) {
            case "task_status":
              set((state) => ({
                status: msg.status || state.status,
                modelStatus: t("store.script.status.taskState", { status: msg.status || state.status }),
                llmStreamOutput: `${t("store.script.status.taskState", { status: msg.status })}\n`,
                parseMode: normalizeParseMode(msg.parse_mode || state.parseMode),
              }));
              break;
            case "model_loading":
            case "model_loaded":
            case "model_unloading":
            case "model_unloaded":
              set((state) => ({
                modelStatus: msg.message || msg.type,
                llmStreamOutput: `${state.llmStreamOutput}${msg.message || msg.type}\n`,
              }));
              break;
            case "chunk":
              set((state) => ({
                llmStreamOutput: `${state.llmStreamOutput}${msg.data}`,
              }));
              break;
            case "progress":
              set({ parseProgress: msg.percent || 0 });
              break;
            case "chunk_progress":
              set((state) => ({
                parseProgress: msg.percent || state.parseProgress || 0,
                llmStreamOutput: `${state.llmStreamOutput}\n[Chunk ${msg.chunk}/${msg.total_chunks}] ${msg.percent}%\n`,
              }));
              break;
            case "chunk_start":
              set((state) => ({
                parseProgress: msg.percent || state.parseProgress || 0,
                llmStreamOutput: `${state.llmStreamOutput}\n${t("store.script.log.chunkStart", { chunk: msg.chunk, total: msg.total_chunks })}\n`,
              }));
              break;
            case "complete":
              void (async () => {
                try {
                  const statsResp = await api.get(`/llm/parse/${taskId}/stats`);
                  const normalized = normalizeParseStats(statsResp?.parse_stats || null);
                  if (!normalized) {
                    return;
                  }
                  set((state) => ({
                    parseStats: normalized,
                    llmStreamOutput: state.parseStats
                      ? state.llmStreamOutput
                      : `${state.llmStreamOutput}${buildParseStatsSummary(normalized)}`,
                  }));
                } catch {
                  // ignore stats pull failure; parse result already available
                }
              })();
              done(finalizeWithScript(msg.data));
              break;
            case "parse_stats": {
              const stats = normalizeParseStats(msg.data || {});
              if (!stats) {
                break;
              }
              const summary = buildParseStatsSummary(stats);
              set((state) => ({
                parseStats: stats,
                llmStreamOutput: `${state.llmStreamOutput}${summary}`,
              }));
              break;
            }
            case "parse_stage":
              set((state) => ({
                parseMode: normalizeParseMode(msg.parse_mode || state.parseMode),
                parseStage: msg.stage || "",
                parseStageLabel: msg.stage_label || "",
                parseStageProgress: Number(msg.stage_progress || 0) || 0,
                modelStatus: msg.stage_label || state.modelStatus,
                llmStreamOutput: `${state.llmStreamOutput}\n${t("store.script.log.stageUpdate", { stage: msg.stage_label || msg.stage || t("store.script.stage.update"), progress: msg.stage_progress || 0 })}\n`,
              }));
              break;
            case "error":
              set({
                isParsing: false,
                status: "error",
                modelStatus: "",
                error: msg.message || t("store.script.error.parseFailed"),
                parseProgress: 0,
                parseStage: "",
                parseStageLabel: "",
                parseStageProgress: 0,
                parseTaskId: null,
                parseStats: null,
              });
              fail(new Error(msg.message || t("store.script.error.parseFailed")));
              break;
            case "canceled":
              set((state) => ({
                isParsing: false,
                status: "canceled",
                modelStatus: t("store.script.status.canceled"),
                parseProgress: 0,
                parseStage: "",
                parseStageLabel: "",
                parseStageProgress: 0,
                parseTaskId: null,
                parseStats: null,
                llmStreamOutput: `${state.llmStreamOutput}\n${t("store.script.log.parseCanceled")}\n`,
              }));
              done(null);
              break;
            case "cancel_requested":
              set((state) => ({
                status: "cancel_requested",
                modelStatus: t("store.script.status.canceling"),
                llmStreamOutput: `${state.llmStreamOutput}\n${t("store.script.log.canceling")}\n`,
              }));
              break;
            default:
              break;
          }
        },
      });
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.parseFailed"));
      set({
        isParsing: false,
        status: "error",
        connectionStatus: "closed",
        modelStatus: "",
        lastSyncError: "",
        error: message,
        parseProgress: 0,
        parseStage: "",
        parseStageLabel: "",
        parseStageProgress: 0,
        parseTaskId: null,
        parseStats: null,
      });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.parseFailed"), message), tone: "error" });
      throw error;
    }
  },
  cancelParse: async () => {
    const taskId = useScriptStore.getState().parseTaskId;
    if (!taskId) {
      return { status: "idle" };
    }
    const result = await api.post(`/llm/parse/${taskId}/cancel`, {});
    set({ status: "cancel_requested", modelStatus: t("store.script.status.canceling"), connectionStatus: "open" });
    useUiStore.getState().pushToast({ title: t("store.script.toast.cancelRequested"), tone: "default" });
    return result;
  },
  updateSegment: async ({ projectId, segmentId, segment }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.put(`/projects/${projectId}/script/segments/${segmentId}`, segment);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.segmentSaved"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.saveSegment"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.saveSegment"), message), tone: "error" });
      throw error;
    }
  },
  addSegment: async ({ projectId, segment }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.post(`/projects/${projectId}/script/segments`, segment);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.segmentAdded"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.addSegment"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.addSegment"), message), tone: "error" });
      throw error;
    }
  },
  deleteSegment: async ({ projectId, segmentId }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.delete(`/projects/${projectId}/script/segments/${segmentId}`);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.segmentDeleted"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.deleteSegment"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.deleteSegment"), message), tone: "error" });
      throw error;
    }
  },
  replaceScript: async ({ projectId, script }) => {
    set({ isSaving: true, error: "" });
    try {
      const updated = await api.put(`/projects/${projectId}/script`, script);
      set({ script: updated, sourceText: updated.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.scriptImported"), tone: "success" });
      return updated;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.importScript"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.importScript"), message), tone: "error" });
      throw error;
    }
  },
  saveScript: async ({ projectId, script }) => {
    set({ isSaving: true, error: "" });
    try {
      const updated = await api.put(`/projects/${projectId}/script`, script);
      set({ script: updated, sourceText: updated.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.scriptSaved"), tone: "success" });
      return updated;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.saveScript"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.saveScript"), message), tone: "error" });
      throw error;
    }
  },
  renameCharacter: async ({ projectId, fromName, toName }) => {
    set({ isSaving: true, error: "" });
    try {
      const result = await api.post(`/projects/${projectId}/script/rename-character`, {
        from_name: fromName,
        to_name: toName,
      });
      const script = result?.script || await api.get(`/projects/${projectId}/script`);
      set({ script, sourceText: script.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.renameCharacterDone"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.renameCharacter"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.renameCharacter"), message), tone: "error" });
      throw error;
    }
  },
  mergeCharacter: async ({ projectId, sourceName, targetName }) => {
    set({ isSaving: true, error: "" });
    try {
      const result = await api.post(`/projects/${projectId}/script/merge-character`, {
        source_name: sourceName,
        target_name: targetName,
      });
      const script = result?.script || await api.get(`/projects/${projectId}/script`);
      set({ script, sourceText: script.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.mergeCharacterDone"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.mergeCharacter"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.mergeCharacter"), message), tone: "error" });
      throw error;
    }
  },
  batchUpdateSegments: async ({ projectId, segmentIds, emotion, type }) => {
    set({ isSaving: true, error: "" });
    try {
      const result = await api.post(`/projects/${projectId}/script/batch-update`, {
        segment_ids: segmentIds || [],
        emotion: emotion ?? null,
        type: type ?? null,
      });
      const script = result?.script || await api.get(`/projects/${projectId}/script`);
      set({ script, sourceText: script.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.batchUpdateDone"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.batchUpdate"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.batchUpdate"), message), tone: "error" });
      throw error;
    }
  },
  searchReplaceSegments: async ({ projectId, find, replace, caseSensitive, segmentIds }) => {
    set({ isSaving: true, error: "" });
    try {
      const result = await api.post(`/projects/${projectId}/script/search-replace`, {
        find,
        replace: replace ?? "",
        case_sensitive: Boolean(caseSensitive),
        segment_ids: segmentIds || [],
      });
      const script = result?.script || await api.get(`/projects/${projectId}/script`);
      set({ script, sourceText: script.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.searchReplaceDone"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.searchReplace"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.searchReplace"), message), tone: "error" });
      throw error;
    }
  },
  splitSegment: async ({ projectId, segmentId, cursor }) => {
    set({ isSaving: true, error: "" });
    try {
      const result = await api.post(`/projects/${projectId}/script/split-segment`, {
        segment_id: segmentId,
        cursor,
      });
      const script = result?.script || await api.get(`/projects/${projectId}/script`);
      set({ script, sourceText: script.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.splitDone"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.splitSegment"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.splitSegment"), message), tone: "error" });
      throw error;
    }
  },
  mergeSegments: async ({ projectId, firstSegmentId, secondSegmentId }) => {
    set({ isSaving: true, error: "" });
    try {
      const result = await api.post(`/projects/${projectId}/script/merge-segments`, {
        first_segment_id: firstSegmentId,
        second_segment_id: secondSegmentId,
      });
      const script = result?.script || await api.get(`/projects/${projectId}/script`);
      set({ script, sourceText: script.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: t("store.script.toast.mergeSegmentsDone"), tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, t("store.script.error.mergeSegments"));
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError(t("store.script.error.mergeSegments"), message), tone: "error" });
      throw error;
    }
  },
}));

function normalizeParseStats(stats) {
  if (!stats || typeof stats !== "object") {
    return null;
  }
  return {
    mode: stats.mode || "unknown",
    parse_mode: normalizeParseMode(stats.parse_mode || DEFAULT_PARSE_MODE),
    stage: stats.stage || "",
    stage_label: stats.stage_label || "",
    stage_progress: Number(stats.stage_progress || 0) || 0,
    step_stats: stats.step_stats && typeof stats.step_stats === "object" ? stats.step_stats : {},
    total_chunks: Number.isFinite(Number(stats.total_chunks)) ? Number(stats.total_chunks) : null,
    duration_ms: Number.isFinite(Number(stats.duration_ms)) ? Number(stats.duration_ms) : null,
    repair_used_count: Number.isFinite(Number(stats.repair_used_count)) ? Number(stats.repair_used_count) : 0,
    fallback_count: Number.isFinite(Number(stats.fallback_count)) ? Number(stats.fallback_count) : 0,
    backend: stats.backend || "",
    ...stats,
  };
}

function buildParseStatsSummary(stats) {
  if (!stats) {
    return "";
  }
  return `[System] Parse stats: parse_mode=${stats.parse_mode || DEFAULT_PARSE_MODE}, mode=${stats.mode || "unknown"}, chunks=${stats.total_chunks ?? "?"}, duration_ms=${stats.duration_ms ?? "?"}, repair=${stats.repair_used_count ?? 0}, fallback=${stats.fallback_count ?? 0}\n`;
}

function normalizeParseMode(value) {
  return SUPPORTED_PARSE_MODES.has(value) ? value : DEFAULT_PARSE_MODE;
}

function readParseModeFromStorage() {
  try {
    const raw = window.localStorage.getItem(PARSE_MODE_STORAGE_KEY) || "";
    return normalizeParseMode(raw);
  } catch {
    return DEFAULT_PARSE_MODE;
  }
}

function writeParseModeToStorage(value) {
  try {
    window.localStorage.setItem(PARSE_MODE_STORAGE_KEY, normalizeParseMode(value));
  } catch {
    // Ignore storage failures.
  }
}
