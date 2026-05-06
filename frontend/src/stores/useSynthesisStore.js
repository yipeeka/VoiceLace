import { create } from "zustand";

import { API_ORIGIN, api, getWsBaseUrl } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { runTaskChannel } from "../utils/taskChannel";
import { createTaskChannelBridge } from "../utils/taskChannelBridge";
import { useUiStore } from "./useUiStore";

const buildSegmentResult = (msg) => ({
  segment_id: msg.segment_id,
  index: msg.index,
  speaker: msg.speaker,
  text: msg.text,
  status: msg.status,
  duration_ms: msg.duration_ms,
  audio_url: msg.audio_url,
  peaks: msg.peaks || null,
});

const runSynthesisFlow = async ({
  set,
  projectId,
  config,
  taskKind,
  endpoint,
  statusEndpoint,
  payload,
  resetSegmentResults,
  mergeSegmentResults,
  resetAudioUrls,
  queueMessage,
  segmentVerb,
  exhaustedMessage,
  timeoutMessage,
  syncErrorMessage,
  cancelRequestedMessage,
  canceledMessage,
  failureMessage,
  completeToastTitle,
}) => {
  const startupState = {
    isRunning: true,
    taskKind,
    status: "starting",
    connectionStatus: "connecting",
    modelStatus: "正在建立连接...",
    lastSyncError: "",
    error: "",
    progress: { current: 0, total: 0 },
  };
  if (resetAudioUrls) {
    startupState.fullAudioUrl = null;
    startupState.subtitleSrtUrl = null;
    startupState.subtitleLrcUrl = null;
  }
  if (resetSegmentResults) {
    startupState.segmentResults = {};
  }
  set(startupState);

  try {
    const { task_id: taskId } = await api.post(endpoint, payload);
    set({ taskId, status: "queued", modelStatus: queueMessage });
    const wsUrl = `${getWsBaseUrl()}/ws/tts-progress/${taskId}`;

    const completeWithResult = (result) => {
      const resolvedKind = result.kind || taskKind || "synthesis";
      const exportPath =
        result.processed_export_url ||
        result.export_url ||
        `/api/v1/tts/export?project_id=${projectId}&format=${config.output_format || "wav"}&variant=raw`;
      const resolvedAudioUrl = `${API_ORIGIN}${exportPath}`;
      set((state) => ({
        isRunning: false,
        taskKind: resolvedKind,
        status: "done",
        modelStatus: "",
        lastSyncError: "",
        progress: result.progress || { current: 0, total: 0 },
        segmentResults: mergeSegmentResults
          ? {
              ...state.segmentResults,
              ...(result.segments || {}),
            }
          : result.segments || {},
        fullAudioUrl: resolvedAudioUrl,
        rawAudioUrl: resolvedKind === "postprocess" ? state.rawAudioUrl : resolvedAudioUrl,
        processedAudioUrl: resolvedKind === "postprocess" ? resolvedAudioUrl : null,
        chapterExports:
          resolvedKind === "postprocess" && Array.isArray(result.chapter_exports) ? result.chapter_exports : [],
        audioVariant: resolvedKind === "postprocess" ? "processed" : "raw",
        subtitleSrtUrl: result.subtitle_srt_url ? `${API_ORIGIN}${result.subtitle_srt_url}` : null,
        subtitleLrcUrl: result.subtitle_lrc_url ? `${API_ORIGIN}${result.subtitle_lrc_url}` : null,
      }));
      useUiStore.getState().pushToast({ title: completeToastTitle(result), tone: "success" });
      return result;
    };

    const channelBridge = createTaskChannelBridge({
      set,
      getStatus: () => useSynthesisStore.getState().status,
      maxReconnectRetries: 5,
      exhaustedMessage,
      timeoutMessage,
      onReconnectOpenExtra: async () => {
        set({ modelStatus: "连接已恢复，正在同步任务状态..." });
      },
      onExhaustedExtra: () => {
        set({
          isRunning: false,
          status: "error",
          modelStatus: "",
          error: exhaustedMessage,
        });
      },
      onTimeoutExtra: () => {
        set({
          isRunning: false,
          status: "error",
          modelStatus: "",
          error: timeoutMessage,
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
          const state = await api.get(`${statusEndpoint}/${taskId}`);
          if (state?.status === "done") {
            done(completeWithResult(state));
            return true;
          }
          if (state?.status === "canceled") {
            set({
              isRunning: false,
              status: "canceled",
              modelStatus: canceledMessage,
              lastSyncError: "",
            });
            done({ status: "canceled", task_id: taskId });
            return true;
          }
          if (state?.status === "error") {
            fail(new Error(state.error || failureMessage));
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
          set({ lastSyncError: getErrorMessage(error, syncErrorMessage) });
          return false;
        }
      },
      onReconnectScheduled: channelBridge.onReconnectScheduled,
      onReconnectExhausted: channelBridge.onReconnectExhausted,
      onTimeout: channelBridge.onTimeout,
      onMessage: ({ msg, done, fail }) => {
        switch (msg.type) {
          case "task_status":
            if (msg.status === "canceled") {
              set({
                isRunning: false,
                status: "canceled",
                modelStatus: canceledMessage,
                lastSyncError: "",
              });
              done({ status: "canceled", task_id: taskId });
              break;
            }
            set({
              status: msg.status,
              modelStatus: `任务状态：${msg.status}`,
            });
            break;
          case "cancel_requested":
            set({
              status: "cancel_requested",
              modelStatus: msg.message || cancelRequestedMessage,
            });
            break;
          case "canceled":
            set({
              isRunning: false,
              status: "canceled",
              modelStatus: msg.message || canceledMessage,
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
          case "postprocess_stage":
            set({
              status: "running",
              modelStatus: msg.message || "后处理进行中",
            });
            break;
          case "segment_start":
            set({
              status: "running",
              modelStatus: `正在${segmentVerb}第 ${msg.index + 1}/${msg.total} 段`,
            });
            break;
          case "segment_done":
            set((state) => ({
              segmentResults: {
                ...state.segmentResults,
                [msg.segment_id]: buildSegmentResult(msg),
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
              error: msg.message || failureMessage,
            });
            fail(new Error(msg.message || failureMessage));
            break;
          default:
            break;
        }
      },
    });
  } catch (error) {
    const message = getErrorMessage(error, failureMessage);
    set({
      isRunning: false,
      status: "error",
      connectionStatus: "closed",
      modelStatus: "",
      lastSyncError: "",
      error: message,
    });
    useUiStore.getState().pushToast({ title: formatError(failureMessage, message), tone: "error" });
    throw error;
  }
};

export const useSynthesisStore = create((set) => ({
  taskId: null,
  taskKind: "synthesis",
  status: "idle",
  connectionStatus: "idle",
  modelStatus: "",
  lastSyncError: "",
  progress: { current: 0, total: 0 },
  segmentResults: {},
  fullAudioUrl: null,
  rawAudioUrl: null,
  processedAudioUrl: null,
  chapterExports: [],
  audioVariant: "raw",
  subtitleSrtUrl: null,
  subtitleLrcUrl: null,
  isRunning: false,
  error: "",
  config: {
    tts_backend: "omnivoice",
    num_step: 32,
    guidance_scale: 2,
    denoise: true,
    omnivoice: {
      num_step: 32,
      guidance_scale: 2,
      denoise: true,
    },
    voxcpm2: {
      inference_timesteps: 10,
      cfg_value: 2,
      denoise: false,
      normalize: true,
    },
    gap_duration_ms: 300,
    output_format: "wav",
    postprocess_enabled: false,
    loudness_normalize: true,
    target_lufs: -16,
    trim_silence_enabled: false,
    trim_threshold_db: -45,
    trim_min_silence_ms: 120,
    fade_in_ms: 40,
    fade_out_ms: 80,
    mp3_bitrate_kbps: 192,
    chapter_markers: [],
    bgm_track: {
      relpath: "",
      gain_db: 0,
      loop: true,
      ducking_enabled: false,
      ducking_db: 8,
    },
    ambience_track: {
      relpath: "",
      gain_db: 0,
      loop: true,
      ducking_enabled: false,
      ducking_db: 8,
    },
  },
  startSynthesis: async ({ projectId, config }) => {
    return await runSynthesisFlow({
      set,
      projectId,
      config,
      taskKind: "synthesis",
      endpoint: "/tts/synthesize",
      statusEndpoint: "/tts/synthesize",
      payload: {
        project_id: projectId,
        config,
      },
      resetSegmentResults: true,
      mergeSegmentResults: false,
      resetAudioUrls: true,
      queueMessage: "任务已创建，等待执行",
      segmentVerb: "合成",
      exhaustedMessage: "合成连接已关闭（重连失败）",
      timeoutMessage: "合成任务等待超时",
      syncErrorMessage: "合成状态同步失败",
      cancelRequestedMessage: "正在取消合成任务...",
      canceledMessage: "合成任务已取消",
      failureMessage: "合成失败",
      completeToastTitle: (result) => `合成完成，共 ${result.progress?.total || 0} 段`,
    });
  },
  startPartialSynthesis: async ({ projectId, config, segmentIds, rebuildFull = true }) => {
    if (!Array.isArray(segmentIds) || !segmentIds.length) {
      throw new Error("segmentIds is required");
    }
    return await runSynthesisFlow({
      set,
      projectId,
      config,
      taskKind: "synthesis",
      endpoint: "/tts/synthesize/segments",
      statusEndpoint: "/tts/synthesize",
      payload: {
        project_id: projectId,
        config,
        segment_ids: segmentIds,
        rebuild_full: rebuildFull,
      },
      resetSegmentResults: false,
      mergeSegmentResults: true,
      resetAudioUrls: true,
      queueMessage: "局部任务已创建，等待执行",
      segmentVerb: "处理",
      exhaustedMessage: "局部合成连接已关闭（重连失败）",
      timeoutMessage: "局部合成任务等待超时",
      syncErrorMessage: "局部合成状态同步失败",
      cancelRequestedMessage: "正在取消局部合成任务...",
      canceledMessage: "局部合成任务已取消",
      failureMessage: "局部合成失败",
      completeToastTitle: (result) =>
        `重新生成完成，重建 ${result.generated_count || 0} 段，复用 ${result.reused_count || 0} 段`,
    });
  },
  startPostprocess: async ({ projectId, config }) => {
    return await runSynthesisFlow({
      set,
      projectId,
      config,
      taskKind: "postprocess",
      endpoint: `/tts/projects/${projectId}/postprocess`,
      statusEndpoint: "/tts/postprocess",
      payload: {
        project_id: projectId,
        config,
      },
      resetSegmentResults: false,
      mergeSegmentResults: true,
      resetAudioUrls: false,
      queueMessage: "后处理任务已创建，等待执行",
      segmentVerb: "后处理",
      exhaustedMessage: "后处理连接已关闭（重连失败）",
      timeoutMessage: "后处理任务等待超时",
      syncErrorMessage: "后处理状态同步失败",
      cancelRequestedMessage: "正在取消后处理任务...",
      canceledMessage: "后处理任务已取消",
      failureMessage: "后处理失败",
      completeToastTitle: () => "后处理完成",
    });
  },
  cancelSynthesis: async () => {
    const taskId = useSynthesisStore.getState().taskId;
    const taskKind = useSynthesisStore.getState().taskKind || "synthesis";
    const taskLabel = taskKind === "postprocess" ? "后处理任务" : "合成任务";
    if (!taskId) {
      return { status: "idle" };
    }
    const result = await api.post(`/tts/synthesize/${taskId}/cancel`, {});
    const backendStatus = result?.status;
    if (backendStatus === "done") {
      set({
        isRunning: false,
        status: "done",
        connectionStatus: "open",
        modelStatus: "任务已完成",
      });
      useUiStore.getState().pushToast({ title: "任务已完成，无需取消", tone: "default" });
      return result;
    }
    if (backendStatus === "canceled") {
      set({
        isRunning: false,
        status: "canceled",
        connectionStatus: "open",
        modelStatus: `${taskLabel}已取消`,
      });
      useUiStore.getState().pushToast({ title: `${taskLabel}已取消`, tone: "default" });
      return result;
    }
    if (backendStatus === "error") {
      set({
        isRunning: false,
        status: "error",
        connectionStatus: "open",
        modelStatus: "",
        error: result?.error || "任务取消失败",
      });
      useUiStore.getState().pushToast({ title: "取消失败，任务已报错", tone: "error" });
      return result;
    }

    set({
      isRunning: true,
      status: "cancel_requested",
      connectionStatus: "open",
      modelStatus: "任务取消中...",
    });
    useUiStore.getState().pushToast({ title: `已请求取消${taskLabel}`, tone: "default" });
    // Fallback: if WS event is missed, reconcile status once.
    setTimeout(async () => {
      const state = useSynthesisStore.getState();
      if (state.taskId !== taskId || state.status !== "cancel_requested") {
        return;
      }
      try {
        const synced = await api.get(taskKind === "postprocess" ? `/tts/postprocess/${taskId}` : `/tts/synthesize/${taskId}`);
        if (synced?.status === "canceled") {
          set({
            isRunning: false,
            status: "canceled",
            modelStatus: `${taskLabel}已取消`,
            lastSyncError: "",
          });
        } else if (synced?.status === "done") {
          set({
            isRunning: false,
            status: "done",
            modelStatus: "任务已完成",
            lastSyncError: "",
          });
        } else if (synced?.status === "error") {
          set({
            isRunning: false,
            status: "error",
            modelStatus: "",
            error: synced?.error || "合成失败",
            lastSyncError: "",
          });
        }
      } catch {
        // Keep current status; websocket may still deliver updates.
      }
    }, 1500);
    return result;
  },
  reset: () =>
    set({
      taskId: null,
      taskKind: "synthesis",
      status: "idle",
      connectionStatus: "idle",
      modelStatus: "",
      lastSyncError: "",
      progress: { current: 0, total: 0 },
      segmentResults: {},
      fullAudioUrl: null,
      rawAudioUrl: null,
      processedAudioUrl: null,
      chapterExports: [],
      audioVariant: "raw",
      subtitleSrtUrl: null,
      subtitleLrcUrl: null,
      isRunning: false,
      error: "",
    }),
  setAudioVariant: (variant) =>
    set((state) => {
      const normalized = variant === "processed" ? "processed" : "raw";
      const fullAudioUrl =
        normalized === "processed"
          ? state.processedAudioUrl || state.rawAudioUrl
          : state.rawAudioUrl || state.fullAudioUrl;
      return {
        audioVariant: normalized,
        fullAudioUrl: fullAudioUrl || null,
      };
    }),
}));
