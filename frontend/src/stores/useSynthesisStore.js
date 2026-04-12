import { create } from "zustand";

import { API_ORIGIN, api, getWsBaseUrl } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { useUiStore } from "./useUiStore";

export const useSynthesisStore = create((set) => ({
  taskId: null,
  status: "idle",
  modelStatus: "",
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
      status: "running",
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
      set({ taskId, status: "queued" });
      const wsUrl = `${getWsBaseUrl()}/ws/tts-progress/${taskId}`;

      return await new Promise((resolve, reject) => {
        let ws = null;
        let finished = false;
        let reconnectAttempts = 0;
        const maxReconnectRetries = 5;
        const baseDelay = 1000;

        const completeWithResult = (result) => {
          const exportPath =
            result.export_url || `/api/v1/tts/export?project_id=${projectId}&format=${config.output_format || "wav"}`;
          set({
            isRunning: false,
            status: "done",
            modelStatus: "",
            progress: result.progress || { current: 0, total: 0 },
            segmentResults: result.segments || {},
            fullAudioUrl: `${API_ORIGIN}${exportPath}`,
            subtitleSrtUrl: result.subtitle_srt_url ? `${API_ORIGIN}${result.subtitle_srt_url}` : null,
            subtitleLrcUrl: result.subtitle_lrc_url ? `${API_ORIGIN}${result.subtitle_lrc_url}` : null,
          });
          useUiStore.getState().pushToast({ title: `合成完成，共 ${result.progress?.total || 0} 段`, tone: "success" });
          ws?.close();
          resolve(result);
        };

        const syncTaskState = async () => {
          try {
            const state = await api.get(`/tts/synthesize/${taskId}`);
            if (state?.status === "done") {
              finished = true;
              window.clearTimeout(timeout);
              completeWithResult(state);
              return true;
            }
            if (state?.status === "error") {
              throw new Error(state.error || "合成失败");
            }
            set({
              status: state?.status || "running",
              progress: state?.progress || { current: 0, total: 0 },
            });
            return false;
          } catch {
            return false;
          }
        };

        const scheduleReconnect = () => {
          if (finished) {
            return;
          }
          if (reconnectAttempts >= maxReconnectRetries) {
            window.clearTimeout(timeout);
            set({
              isRunning: false,
              status: "error",
              error: "合成连接已关闭（重连失败）",
            });
            reject(new Error("合成连接已关闭（重连失败）"));
            return;
          }
          reconnectAttempts += 1;
          const delay = baseDelay * (2 ** (reconnectAttempts - 1));
          set({
            modelStatus: `连接中断，${delay}ms 后重连 (${reconnectAttempts}/${maxReconnectRetries})...`,
          });
          window.setTimeout(async () => {
            if (finished) {
              return;
            }
            const recovered = await syncTaskState();
            if (recovered) {
              return;
            }
            connect();
          }, delay);
        };

        const connect = () => {
          ws = new WebSocket(wsUrl);

          ws.onopen = async () => {
            if (reconnectAttempts > 0) {
              set({ modelStatus: "连接已恢复，正在同步任务状态..." });
              await syncTaskState();
            }
          };

          ws.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            switch (msg.type) {
              case "task_status":
                set({ status: msg.status });
                break;
              case "cancel_requested":
                set({
                  status: "cancel_requested",
                  modelStatus: msg.message || "正在取消合成任务...",
                });
                break;
              case "canceled":
                finished = true;
                window.clearTimeout(timeout);
                set({
                  isRunning: false,
                  status: "canceled",
                  modelStatus: msg.message || "合成任务已取消",
                });
                ws?.close();
                resolve({ status: "canceled", task_id: taskId });
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
                finished = true;
                window.clearTimeout(timeout);
                completeWithResult(msg.data);
                break;
              case "error":
                finished = true;
                window.clearTimeout(timeout);
                set({
                  isRunning: false,
                  status: "error",
                  error: msg.message || "合成失败",
                });
                ws?.close();
                reject(new Error(msg.message || "合成失败"));
                break;
              default:
                break;
            }
          };

          ws.onerror = () => {
            // reconnect handled by onclose
          };

          ws.onclose = () => {
            if (!finished) {
              const currentStatus = useSynthesisStore.getState().status;
              if (currentStatus === "cancel_requested" || currentStatus === "canceled") {
                return;
              }
              scheduleReconnect();
            }
          };
        };

        const timeout = window.setTimeout(() => {
          if (!finished) {
            ws?.close();
            reject(new Error("合成任务等待超时"));
          }
        }, 40 * 60 * 1000);
        connect();
      });
    } catch (error) {
      const message = getErrorMessage(error, "合成失败");
      set({
        isRunning: false,
        status: "error",
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
      modelStatus: "任务取消中...",
    });
    useUiStore.getState().pushToast({ title: "已请求取消合成任务", tone: "default" });
    return result;
  },
  reset: () =>
    set({
      taskId: null,
      status: "idle",
      modelStatus: "",
      progress: { current: 0, total: 0 },
      segmentResults: {},
      fullAudioUrl: null,
      subtitleSrtUrl: null,
      subtitleLrcUrl: null,
      isRunning: false,
      error: "",
    }),
}));
