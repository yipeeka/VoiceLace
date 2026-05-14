import { create } from "zustand";

import { API_ORIGIN, api, getWsBaseUrl } from "../utils/api";
import { formatError, getErrorMessage } from "../utils/errors";
import { getLanguage } from "../i18n/core";
import { MESSAGES } from "../i18n/messages";
import { runTaskChannel } from "../utils/taskChannel";
import { createTaskChannelBridge } from "../utils/taskChannelBridge";
import { useUiStore } from "./useUiStore";

function t(key, params = {}) {
  const language = getLanguage();
  const dict = MESSAGES[language] || MESSAGES.zh;
  const template = dict[key] || MESSAGES.en?.[key] || key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
}

const buildSegmentResult = (msg) => ({
  segment_id: msg.segment_id,
  index: msg.index,
  speaker: msg.speaker,
  text: msg.text,
  status: msg.status,
  duration_ms: msg.duration_ms,
  audio_url: msg.audio_url,
  error: msg.error || "",
  attempts: Number(msg.attempts || 0),
  peaks: msg.peaks || null,
});

const appendVersionParam = (url, versionKey) => {
  if (!url) return url;
  const normalizedKey = String(versionKey || Date.now());
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(normalizedKey)}`;
};

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
    modelStatus: t("store.synth.status.connecting"),
    lastSyncError: "",
    error: "",
    progress: { current: 0, total: 0 },
    queuePosition: 0,
    failedCount: 0,
    retryCount: 0,
    effectiveSegmentConcurrency: 1,
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
      const resolvedStatus = result.status || "done";
      const exportPath =
        result.processed_export_url ||
        result.export_url ||
        `/api/v1/tts/export?project_id=${projectId}&format=${config.output_format || "wav"}&variant=raw`;
      const resolvedVersionKey = result.finished_at || result.task_id || taskId || Date.now();
      const resolvedAudioUrl = appendVersionParam(`${API_ORIGIN}${exportPath}`, resolvedVersionKey);
      set((state) => ({
        isRunning: false,
        taskKind: resolvedKind,
        status: resolvedStatus,
        modelStatus: "",
        lastSyncError: "",
        progress: result.progress || { current: 0, total: 0 },
        queuePosition: Number(result.queue_position || 0),
        failedCount: Number(result.failed_count || 0),
        retryCount: Number(result.retry_count || 0),
        effectiveSegmentConcurrency: Number(result.effective_segment_concurrency || 1),
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
      useUiStore.getState().pushToast({
        title: completeToastTitle(result),
        tone: resolvedStatus === "partial_failed" ? "warning" : "success",
      });
      return result;
    };

    const channelBridge = createTaskChannelBridge({
      set,
      getStatus: () => useSynthesisStore.getState().status,
      maxReconnectRetries: 5,
      exhaustedMessage,
      timeoutMessage,
      onReconnectOpenExtra: async () => {
        set({ modelStatus: t("store.synth.status.reconnectedSyncing") });
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
          if (state?.status === "done" || state?.status === "partial_failed") {
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
            modelStatus: t("store.synth.status.syncing"),
            lastSyncError: "",
            progress: state?.progress || { current: 0, total: 0 },
            queuePosition: Number(state?.queue_position || 0),
            failedCount: Number(state?.failed_count || 0),
            retryCount: Number(state?.retry_count || 0),
            effectiveSegmentConcurrency: Number(state?.effective_segment_concurrency || 1),
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
              modelStatus: msg.status === "queued" ? t("store.synth.status.queued") : t("store.synth.status.taskState", { status: msg.status }),
              queuePosition: Number(msg.queue_position || 0),
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
              modelStatus: msg.message || t("store.synth.status.postprocessing"),
            });
            break;
          case "segment_start":
            set({
              status: "running",
              modelStatus: t("store.synth.status.segmentProgress", { verb: segmentVerb, current: msg.index + 1, total: msg.total }),
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
          case "segment_failed":
            set((state) => ({
              segmentResults: {
                ...state.segmentResults,
                [msg.segment_id]: {
                  segment_id: msg.segment_id,
                  index: msg.index,
                  speaker: msg.speaker,
                  text: msg.text,
                  status: "failed",
                  duration_ms: 0,
                  audio_url: null,
                  error: msg.error || "",
                  attempts: Number(msg.attempts || 0),
                },
              },
              failedCount: Number((state.failedCount || 0) + 1),
            }));
            break;
          case "progress":
            set({
              progress: {
                current: msg.current || 0,
                total: msg.total || 0,
              },
              failedCount: Number(msg.failed_count || useSynthesisStore.getState().failedCount || 0),
              retryCount: Number(msg.retry_count || useSynthesisStore.getState().retryCount || 0),
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
  queuePosition: 0,
  failedCount: 0,
  retryCount: 0,
  effectiveSegmentConcurrency: 1,
  queueSnapshot: { running: null, queued: [], queued_count: 0 },
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
    tts_auto_retry: true,
    tts_retry_attempts: 2,
    tts_segment_concurrency: 1,
    timeline_lock_enabled: false,
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
      queueMessage: t("store.synth.queue.created"),
      segmentVerb: t("store.synth.verb.synthesize"),
      exhaustedMessage: t("store.synth.error.connClosed"),
      timeoutMessage: t("store.synth.error.timeout"),
      syncErrorMessage: t("store.synth.error.syncFailed"),
      cancelRequestedMessage: t("store.synth.status.canceling"),
      canceledMessage: t("store.synth.status.canceled"),
      failureMessage: t("store.synth.error.failed"),
      completeToastTitle: (result) =>
        result.status === "partial_failed"
          ? t("store.synth.toast.partialDoneFailedCount", { count: result.failed_count || 0 })
          : t("store.synth.toast.doneTotalCount", { count: result.progress?.total || 0 }),
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
      queueMessage: t("store.synth.queue.partialCreated"),
      segmentVerb: t("store.synth.verb.process"),
      exhaustedMessage: t("store.synth.error.partialConnClosed"),
      timeoutMessage: t("store.synth.error.partialTimeout"),
      syncErrorMessage: t("store.synth.error.partialSyncFailed"),
      cancelRequestedMessage: t("store.synth.status.partialCanceling"),
      canceledMessage: t("store.synth.status.partialCanceled"),
      failureMessage: t("store.synth.error.partialFailed"),
      completeToastTitle: (result) =>
        result.status === "partial_failed"
          ? t("store.synth.toast.partialRegenerateFailedCount", { count: result.failed_count || 0 })
          : t("store.synth.toast.regenerateDone", { generated: result.generated_count || 0, reused: result.reused_count || 0 }),
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
      queueMessage: t("store.synth.queue.postprocessCreated"),
      segmentVerb: t("store.synth.verb.postprocess"),
      exhaustedMessage: t("store.synth.error.postprocessConnClosed"),
      timeoutMessage: t("store.synth.error.postprocessTimeout"),
      syncErrorMessage: t("store.synth.error.postprocessSyncFailed"),
      cancelRequestedMessage: t("store.synth.status.postprocessCanceling"),
      canceledMessage: t("store.synth.status.postprocessCanceled"),
      failureMessage: t("store.synth.error.postprocessFailed"),
      completeToastTitle: () => t("store.synth.toast.postprocessDone"),
    });
  },
  startRetryFailed: async ({ projectId, config }) => {
    return await runSynthesisFlow({
      set,
      projectId,
      config,
      taskKind: "synthesis",
      endpoint: `/tts/projects/${projectId}/retry-failed`,
      statusEndpoint: "/tts/synthesize",
      payload: {},
      resetSegmentResults: false,
      mergeSegmentResults: true,
      resetAudioUrls: false,
      queueMessage: t("store.synth.queue.retryFailedCreated"),
      segmentVerb: t("store.synth.verb.retry"),
      exhaustedMessage: t("store.synth.error.retryConnClosed"),
      timeoutMessage: t("store.synth.error.retryTimeout"),
      syncErrorMessage: t("store.synth.error.retrySyncFailed"),
      cancelRequestedMessage: t("store.synth.status.retryCanceling"),
      canceledMessage: t("store.synth.status.retryCanceled"),
      failureMessage: t("store.synth.error.retryFailed"),
      completeToastTitle: (result) =>
        result.status === "partial_failed"
          ? t("store.synth.toast.retryStillFailed", { count: result.failed_count || 0 })
          : t("store.synth.toast.retryDone"),
    });
  },
  startResumeSynthesis: async ({ projectId, config }) => {
    return await runSynthesisFlow({
      set,
      projectId,
      config,
      taskKind: "synthesis",
      endpoint: `/tts/projects/${projectId}/resume`,
      statusEndpoint: "/tts/synthesize",
      payload: {},
      resetSegmentResults: false,
      mergeSegmentResults: true,
      resetAudioUrls: false,
      queueMessage: t("store.synth.queue.resumeCreated"),
      segmentVerb: t("store.synth.verb.resume"),
      exhaustedMessage: t("store.synth.error.resumeConnClosed"),
      timeoutMessage: t("store.synth.error.resumeTimeout"),
      syncErrorMessage: t("store.synth.error.resumeSyncFailed"),
      cancelRequestedMessage: t("store.synth.status.resumeCanceling"),
      canceledMessage: t("store.synth.status.resumeCanceled"),
      failureMessage: t("store.synth.error.resumeFailed"),
      completeToastTitle: (result) =>
        result.status === "partial_failed"
          ? t("store.synth.toast.resumeStillFailed", { count: result.failed_count || 0 })
          : t("store.synth.toast.resumeDone"),
    });
  },
  fetchQueueSnapshot: async () => {
    const payload = await api.get("/tts/queue");
    set({ queueSnapshot: payload || { running: null, queued: [], queued_count: 0 } });
    return payload;
  },
  cancelSynthesis: async () => {
    const taskId = useSynthesisStore.getState().taskId;
    const taskKind = useSynthesisStore.getState().taskKind || "synthesis";
    const taskLabel = taskKind === "postprocess" ? t("store.synth.label.postprocessTask") : t("store.synth.label.synthesisTask");
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
        modelStatus: t("store.synth.status.done"),
      });
      useUiStore.getState().pushToast({ title: t("store.synth.toast.alreadyDoneNoCancel"), tone: "default" });
      return result;
    }
    if (backendStatus === "canceled") {
      set({
        isRunning: false,
        status: "canceled",
        connectionStatus: "open",
        modelStatus: t("store.synth.status.taskCanceled", { task: taskLabel }),
      });
      useUiStore.getState().pushToast({ title: t("store.synth.status.taskCanceled", { task: taskLabel }), tone: "default" });
      return result;
    }
    if (backendStatus === "error") {
      set({
        isRunning: false,
        status: "error",
        connectionStatus: "open",
        modelStatus: "",
        error: result?.error || t("store.synth.error.cancelFailed"),
      });
      useUiStore.getState().pushToast({ title: t("store.synth.toast.cancelFailedTaskErrored"), tone: "error" });
      return result;
    }

    set({
      isRunning: true,
      status: "cancel_requested",
      connectionStatus: "open",
      modelStatus: t("store.synth.status.cancelingTask"),
    });
    useUiStore.getState().pushToast({ title: t("store.synth.toast.cancelRequested", { task: taskLabel }), tone: "default" });
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
            modelStatus: t("store.synth.status.taskCanceled", { task: taskLabel }),
            lastSyncError: "",
          });
        } else if (synced?.status === "done" || synced?.status === "partial_failed") {
          set({
            isRunning: false,
            status: synced?.status,
            modelStatus: synced?.status === "partial_failed" ? t("store.synth.status.partialDone") : t("store.synth.status.done"),
            lastSyncError: "",
          });
        } else if (synced?.status === "error") {
          set({
            isRunning: false,
            status: "error",
            modelStatus: "",
            error: synced?.error || t("store.synth.error.failed"),
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
      queuePosition: 0,
      failedCount: 0,
      retryCount: 0,
      effectiveSegmentConcurrency: 1,
      queueSnapshot: { running: null, queued: [], queued_count: 0 },
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
