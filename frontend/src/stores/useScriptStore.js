import { create } from "zustand";

import { api, getWsBaseUrl } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { runTaskChannel } from "../utils/taskChannel";
import { createTaskChannelBridge } from "../utils/taskChannelBridge";
import { useUiStore } from "./useUiStore";

export const useScriptStore = create((set) => ({
  sourceText: "",
  llmStreamOutput: "",
  parseProgress: 0,
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
  loadProjectScript: async (projectId) => {
    const script = await api.get(`/projects/${projectId}/script`);
    set({ script, sourceText: script.source_text || "" });
    return script;
  },
  parseText: async ({ text, projectId, prompt }) => {
    set({
      isParsing: true,
      status: "starting",
      connectionStatus: "connecting",
      modelStatus: "正在建立连接...",
      lastSyncError: "",
      error: "",
      parseProgress: 5,
      llmStreamOutput: "",
      parseTaskId: null,
      parseStats: null,
    });
    try {
      const { task_id: taskId } = await api.post("/llm/parse", {
        text,
        system_prompt: prompt,
        project_id: projectId,
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
          script,
          llmStreamOutput: JSON.stringify(script, null, 2),
          parseTaskId: null,
        });
        useUiStore.getState().pushToast({ title: `解析完成，生成 ${script.segments.length} 个片段`, tone: "success" });
        return script;
      };

      const channelBridge = createTaskChannelBridge({
        set,
        getStatus: () => useScriptStore.getState().status,
        maxReconnectRetries: 5,
        exhaustedMessage: "解析连接已关闭（重连失败）",
        timeoutMessage: "解析任务等待超时",
        onReconnectOpenExtra: async () => {
          set((state) => ({
            llmStreamOutput: `${state.llmStreamOutput}[系统] 连接已恢复。\n`,
          }));
        },
        onReconnectScheduledExtra: ({ reconnectAttempts, delay }) => {
          set((state) => ({
            llmStreamOutput: `${state.llmStreamOutput}\n[系统] 连接中断，${delay}ms 后尝试重连 (${reconnectAttempts}/5)...\n`,
          }));
        },
        onExhaustedExtra: () => {
          set({
            isParsing: false,
            status: "error",
            modelStatus: "",
            error: "解析连接已关闭（重连失败）",
            parseProgress: 0,
            parseTaskId: null,
          });
        },
        onTimeoutExtra: () => {
          set({
            isParsing: false,
            status: "error",
            modelStatus: "",
            error: "解析任务等待超时",
            parseProgress: 0,
            parseTaskId: null,
          });
        },
      });

      return await runTaskChannel({
        wsUrl,
        timeoutMs: 20 * 60 * 1000,
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
                modelStatus: state.status === "cancel_requested" ? "正在中断解析任务..." : "任务状态同步中",
                lastSyncError: "",
              });
            }
            return false;
          } catch (error) {
            set({ lastSyncError: getErrorMessage(error, "解析状态同步失败") });
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
                modelStatus: `任务状态：${msg.status || state.status}`,
                llmStreamOutput: `任务状态：${msg.status}\n`,
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
                llmStreamOutput: `${state.llmStreamOutput}\n[Chunk ${msg.chunk}/${msg.total_chunks}] 开始处理...\n`,
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
            case "error":
              set({
                isParsing: false,
                status: "error",
                modelStatus: "",
                error: msg.message || "解析失败",
                parseProgress: 0,
                parseTaskId: null,
                parseStats: null,
              });
              fail(new Error(msg.message || "解析失败"));
              break;
            case "canceled":
              set((state) => ({
                isParsing: false,
                status: "canceled",
                modelStatus: "解析任务已中断",
                parseProgress: 0,
                parseTaskId: null,
                parseStats: null,
                llmStreamOutput: `${state.llmStreamOutput}\n[系统] 解析已中断\n`,
              }));
              done(null);
              break;
            case "cancel_requested":
              set((state) => ({
                status: "cancel_requested",
                modelStatus: "正在中断解析任务...",
                llmStreamOutput: `${state.llmStreamOutput}\n[系统] 正在中断...\n`,
              }));
              break;
            default:
              break;
          }
        },
      });
    } catch (error) {
      const message = getErrorMessage(error, "解析失败");
      set({
        isParsing: false,
        status: "error",
        connectionStatus: "closed",
        modelStatus: "",
        lastSyncError: "",
        error: message,
        parseProgress: 0,
        parseTaskId: null,
        parseStats: null,
      });
      useUiStore.getState().pushToast({ title: formatError("解析失败", message), tone: "error" });
      throw error;
    }
  },
  cancelParse: async () => {
    const taskId = useScriptStore.getState().parseTaskId;
    if (!taskId) {
      return { status: "idle" };
    }
    const result = await api.post(`/llm/parse/${taskId}/cancel`, {});
    set({ status: "cancel_requested", modelStatus: "正在中断解析任务...", connectionStatus: "open" });
    useUiStore.getState().pushToast({ title: "已请求取消解析任务", tone: "default" });
    return result;
  },
  updateSegment: async ({ projectId, segmentId, segment }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.put(`/projects/${projectId}/script/segments/${segmentId}`, segment);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: "片段已保存", tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, "保存片段失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("保存片段失败", message), tone: "error" });
      throw error;
    }
  },
  addSegment: async ({ projectId, segment }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.post(`/projects/${projectId}/script/segments`, segment);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: "已新增片段", tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, "新增片段失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("新增片段失败", message), tone: "error" });
      throw error;
    }
  },
  deleteSegment: async ({ projectId, segmentId }) => {
    set({ isSaving: true, error: "" });
    try {
      await api.delete(`/projects/${projectId}/script/segments/${segmentId}`);
      const script = await api.get(`/projects/${projectId}/script`);
      set({ script, isSaving: false });
      useUiStore.getState().pushToast({ title: "片段已删除", tone: "success" });
      return script;
    } catch (error) {
      const message = getErrorMessage(error, "删除片段失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("删除片段失败", message), tone: "error" });
      throw error;
    }
  },
  replaceScript: async ({ projectId, script }) => {
    set({ isSaving: true, error: "" });
    try {
      const updated = await api.put(`/projects/${projectId}/script`, script);
      set({ script: updated, sourceText: updated.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: "剧本导入成功", tone: "success" });
      return updated;
    } catch (error) {
      const message = getErrorMessage(error, "剧本导入失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("剧本导入失败", message), tone: "error" });
      throw error;
    }
  },
  saveScript: async ({ projectId, script }) => {
    set({ isSaving: true, error: "" });
    try {
      const updated = await api.put(`/projects/${projectId}/script`, script);
      set({ script: updated, sourceText: updated.source_text || "", isSaving: false });
      useUiStore.getState().pushToast({ title: "剧本已保存", tone: "success" });
      return updated;
    } catch (error) {
      const message = getErrorMessage(error, "保存剧本失败");
      set({ isSaving: false, error: message });
      useUiStore.getState().pushToast({ title: formatError("保存剧本失败", message), tone: "error" });
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
  return `[系统] 解析统计: mode=${stats.mode || "unknown"}, chunks=${stats.total_chunks ?? "?"}, duration_ms=${stats.duration_ms ?? "?"}, repair=${stats.repair_used_count ?? 0}, fallback=${stats.fallback_count ?? 0}\n`;
}
