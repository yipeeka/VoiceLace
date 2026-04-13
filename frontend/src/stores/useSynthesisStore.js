import { create } from "zustand";

import { API_ORIGIN, api, getWsBaseUrl } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { runTaskChannel } from "../utils/taskChannel";
import { createTaskChannelBridge } from "../utils/taskChannelBridge";
import { useUiStore } from "./useUiStore";

export const useSynthesisStore = create((set) => ({
  taskId: null,
  status: "idle",
  connectionStatus: "idle",
  modelStatus: "",
  lastSyncError: "",
  progress: { current: 0, total: 0 },
  segmentResults: {},
  fullAudioUrl: null,
  subtitleSrtUrl: null,
  subtitleLrcUrl: null,
  isRunning: false,
  error: "",
  config: {
    num_step: 32,
    guidance_scale: 2,
    denoise: true,
    gap_duration_ms: 500,
    output_format: "wav",
  },
  startSynthesis: async ({ projectId, config }) => {
    set({
      isRunning: true,
      status: "starting",
      connectionStatus: "connecting",
      modelStatus: "正在建立连接...",
      lastSyncError: "",
      error: "",
      progress: { current: 0, total: 0 },
      segmentResults: {},
      fullAudioUrl: null,
      subtitleSrtUrl: null,
      subtitleLrcUrl: null,
    });
    try {
      const { task_id: taskId } = await api.post("/tts/synthesize", {
        project_id: projectId,
        config,
      });
      set({ taskId, status: "queued", modelStatus: "任务已创建，等待执行" });
      const wsUrl = `${getWsBaseUrl()}/ws/tts-progress/${taskId}`;

      const completeWithResult = (result) => {
        const exportPath =
          result.export_url || `/api/v1/tts/export?project_id=${projectId}&format=${config.output_format || "wav"}`;
        set({
          isRunning: false,
          status: "done",
          modelStatus: "",
          lastSyncError: "",
          progress: result.progress || { current: 0, total: 0 },
          segmentResults: result.segments || {},
          fullAudioUrl: `${API_ORIGIN}${exportPath}`,
          subtitleSrtUrl: result.subtitle_srt_url ? `${API_ORIGIN}${result.subtitle_srt_url}` : null,
          subtitleLrcUrl: result.subtitle_lrc_url ? `${API_ORIGIN}${result.subtitle_lrc_url}` : null,
        });
        useUiStore.getState().pushToast({ title: `合成完成，共 ${result.progress?.total || 0} 段`, tone: "success" });
        return result;
      };

      const channelBridge = createTaskChannelBridge({
        set,
        getStatus: () => useSynthesisStore.getState().status,
        maxReconnectRetries: 5,
        exhaustedMessage: "合成连接已关闭（重连失败）",
        timeoutMessage: "合成任务等待超时",
        onReconnectOpenExtra: async () => {
          set({ modelStatus: "连接已恢复，正在同步任务状态..." });
        },
        onExhaustedExtra: () => {
          set({
            isRunning: false,
            status: "error",
            modelStatus: "",
            error: "合成连接已关闭（重连失败）",
          });
        },
        onTimeoutExtra: () => {
          set({
            isRunning: false,
            status: "error",
            modelStatus: "",
            error: "合成任务等待超时",
          });
        },
      });

      return await runTaskChannel({
        wsUrl,
        timeoutMs: 40 * 60 * 1000,
        maxReconnectRetries: 5,
        baseDelayMs: 1000,
        shouldReconnect: channelBridge.shouldReconnect,
        onConnectionStatus: channelBridge.onConnectionStatus,
        onOpen: channelBridge.onOpen,
        syncTaskState: async ({ done, fail }) => {
          try {
            const state = await api.get(`/tts/synthesize/${taskId}`);
            if (state?.status === "done") {
              done(completeWithResult(state));
              return true;
            }
            if (state?.status === "error") {
              fail(new Error(state.error || "合成失败"));
              return true;
            }
            set({
              status: state?.status || "running",
              modelStatus: "任务状态同步中",
              lastSyncError: "",
              progress: state?.progress || { current: 0, total: 0 },
            });
            return false;
          } catch (error) {
            set({ lastSyncError: getErrorMessage(error, "合成状态同步失败") });
            return false;
          }
        },
        onReconnectScheduled: channelBridge.onReconnectScheduled,
        onReconnectExhausted: channelBridge.onReconnectExhausted,
        onTimeout: channelBridge.onTimeout,
        onMessage: ({ msg, done, fail }) => {
          switch (msg.type) {
            case "task_status":
              set({
                status: msg.status,
                modelStatus: `任务状态：${msg.status}`,
              });
              break;
            case "cancel_requested":
              set({
                status: "cancel_requested",
                modelStatus: msg.message || "正在取消合成任务...",
              });
              break;
            case "canceled":
              set({
                isRunning: false,
                status: "canceled",
                modelStatus: msg.message || "合成任务已取消",
              });
              done({ status: "canceled", task_id: taskId });
              break;
            case "model_loading":
            case "model_loaded":
            case "model_unloading":
            case "model_unloaded":
              set({
                modelStatus: msg.message || msg.type,
              });
              break;
            case "segment_start":
              set({
                status: "running",
                modelStatus: `正在合成第 ${msg.index + 1}/${msg.total} 段`,
              });
              break;
            case "segment_done":
              set((state) => ({
                segmentResults: {
                  ...state.segmentResults,
                  [msg.segment_id]: {
                    segment_id: msg.segment_id,
                    index: msg.index,
                    speaker: msg.speaker,
                    text: msg.text,
                    status: msg.status,
                    duration_ms: msg.duration_ms,
                    audio_url: msg.audio_url,
                  },
                },
              }));
              break;
            case "progress":
              set({
                progress: {
                  current: msg.current || 0,
                  total: msg.total || 0,
                },
              });
              break;
            case "complete":
              done(completeWithResult(msg.data));
              break;
            case "error":
              set({
                isRunning: false,
                status: "error",
                modelStatus: "",
                error: msg.message || "合成失败",
              });
              fail(new Error(msg.message || "合成失败"));
              break;
            default:
              break;
          }
        },
      });
    } catch (error) {
      const message = getErrorMessage(error, "合成失败");
      set({
        isRunning: false,
        status: "error",
        connectionStatus: "closed",
        modelStatus: "",
        lastSyncError: "",
        error: message,
      });
      useUiStore.getState().pushToast({ title: formatError("合成失败", message), tone: "error" });
      throw error;
    }
  },
  cancelSynthesis: async () => {
    const taskId = useSynthesisStore.getState().taskId;
    if (!taskId) {
      return { status: "idle" };
    }
    const result = await api.post(`/tts/synthesize/${taskId}/cancel`, {});
    set({
      isRunning: true,
      status: "cancel_requested",
      connectionStatus: "open",
      modelStatus: "任务取消中...",
    });
    useUiStore.getState().pushToast({ title: "已请求取消合成任务", tone: "default" });
    return result;
  },
  reset: () =>
    set({
      taskId: null,
      status: "idle",
      connectionStatus: "idle",
      modelStatus: "",
      lastSyncError: "",
      progress: { current: 0, total: 0 },
      segmentResults: {},
      fullAudioUrl: null,
      subtitleSrtUrl: null,
      subtitleLrcUrl: null,
      isRunning: false,
      error: "",
    }),
}));
