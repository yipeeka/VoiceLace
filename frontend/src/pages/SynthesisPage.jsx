import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Redo2, Undo2 } from "lucide-react";

import ScriptSidebarColumn from "../components/script/ScriptSidebarColumn";
import ScriptDiffPreviewDialog from "../components/script/ScriptDiffPreviewDialog";
import Button from "../components/ui/Button";
import { SynthesisGenerateCard, SynthesisPostprocessCard } from "../components/synthesis/SynthesisConfigCard";
import SynthesisTaskStatusCard from "../components/synthesis/SynthesisTaskStatusCard";
import SynthesisFullAudioCard from "../components/synthesis/SynthesisFullAudioCard";
import SynthesisTimelineCard from "../components/synthesis/SynthesisTimelineCard";
import ExportWizardDialog from "../components/synthesis/ExportWizardDialog";
import { usePlaybackQueue } from "../hooks/usePlaybackQueue";
import { useSynthesisActions } from "../hooks/useSynthesisActions";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useSynthesisStore } from "../stores/useSynthesisStore";
import { useUiStore } from "../stores/useUiStore";
import { API_ORIGIN, api } from "../utils/api";
import { buildProjectFilePayload, saveProjectFile } from "../utils/projectFile";
import { buildSegmentEditorDraft, createSegmentDraft, normalizeSegmentFromEditorDraft } from "../utils/segmentEditorState";
import { hasEditingDraftChanges } from "../utils/scriptEditorDirty";
import {
  buildCharacterStats,
  buildSpeakerOptions,
  filterSegmentsBySpeaker,
  filterSegmentsByWorkflowStatus,
  getInsertAnchorLabel,
  pruneSelectedSegmentIds,
} from "../utils/scriptSidebar";
import { computeScriptDiff, normalizeDraftScript } from "../utils/scriptDiff";
import {
  buildRecommendedRegenerateIds,
  buildStaleTargetIds,
  getSegmentStaleLabel,
  resolveSegmentDisplayStatus,
  resolveWorkflowStatus,
} from "../utils/stale";
import { buildSegmentTimingCheck } from "../utils/segmentTiming";

function formatTimeMs(ms) {
  if (!ms || isNaN(ms)) return "0:00";
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STATUS_FILTERS = new Set(["all", "stale", "done", "missing", "failed"]);
const SYNTHESIS_PANELS = new Set(["synthesis", "postprocess"]);
const SEGMENT_BOUNDARY_TOLERANCE_MS = 60;

function readSynthesisQueryState() {
  if (typeof window === "undefined") {
    return { speaker: "all", status: "all", panel: "synthesis" };
  }
  const params = new URLSearchParams(window.location.search);
  const status = params.get("status") || "all";
  const panel = params.get("panel") || "synthesis";
  return {
    speaker: params.get("speaker") || "all",
    status: STATUS_FILTERS.has(status) ? status : "all",
    panel: SYNTHESIS_PANELS.has(panel) ? panel : "synthesis",
  };
}

export default function SynthesisPage() {
  const queryState = useMemo(() => readSynthesisQueryState(), []);
  const {
    currentProject,
    refreshCurrentProject,
    importArchive,
    importWarnings,
    currentProjectFileHandle,
    bindCurrentProjectFile,
  } = useProjectStore();
  const {
    taskId, status, connectionStatus, modelStatus, lastSyncError, progress, queuePosition, failedCount, retryCount,
    effectiveSegmentConcurrency, queueSnapshot,
    segmentResults, fullAudioUrl, rawAudioUrl, processedAudioUrl,
    chapterExports, audioVariant, isRunning, error,
    subtitleSrtUrl, subtitleLrcUrl,
    startSynthesis, startPartialSynthesis, startPostprocess, startBackgroundExtraction, startRetryFailed, startResumeSynthesis, startRebuildFullAudio, fetchQueueSnapshot,
    cancelSynthesis, reset, setAudioVariant,
  } = useSynthesisStore();
  const archiveInputRef = useRef(null);
  const lastProjectIdRef = useRef(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState([]);
  const [staleReport, setStaleReport] = useState(null);
  const [editingSegmentId, setEditingSegmentId] = useState(null);
  const [segmentDraft, setSegmentDraft] = useState(null);
  const [savedScript, setSavedScript] = useState(() => normalizeDraftScript(currentProject?.script));
  const [draftScript, setDraftScript] = useState(() => normalizeDraftScript(currentProject?.script));
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [newSegment, setNewSegment] = useState(() => createSegmentDraft(0));
  const [insertAfterSegmentId, setInsertAfterSegmentId] = useState(null);
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState(queryState.speaker);
  const [activeStatusFilter, setActiveStatusFilter] = useState(queryState.status);
  const [recentlyUpdatedSegmentId, setRecentlyUpdatedSegmentId] = useState(null);
  const [resolvedSegmentDurations, setResolvedSegmentDurations] = useState({});
  const [fullAudioCurrentTime, setFullAudioCurrentTime] = useState(0);
  const [fullAudioSeekSeconds, setFullAudioSeekSeconds] = useState(0);
  const [fullAudioSeekSignal, setFullAudioSeekSignal] = useState(0);
  const [diffPreviewOpen, setDiffPreviewOpen] = useState(false);
  const [isUploadingPostAsset, setIsUploadingPostAsset] = useState(false);
  const [expandedSynthesisPanel, setExpandedSynthesisPanel] = useState(queryState.panel);
  const [systemRuntimeStatus, setSystemRuntimeStatus] = useState(null);
  const [exportWizardOpen, setExportWizardOpen] = useState(false);
  const updatedRowTimerRef = useRef(null);
  const synthesisConfigProjectIdRef = useRef(null);
  const { saveScript, isSaving: isScriptSaving, error: scriptError, script, sourceText } = useScriptStore();
  const setProjectSaveAction = useUiStore((state) => state.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((state) => state.clearProjectSaveAction);
  const pushToast = useUiStore.getState().pushToast;

  const resetHistory = useCallback((nextDraft) => {
    setUndoStack([]);
    setRedoStack([]);
    setDraftScript(nextDraft);
  }, []);

  const applyDraftMutation = useCallback((updater) => {
    setDraftScript((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      if (!next || JSON.stringify(next) === JSON.stringify(current)) {
        return current;
      }
      setUndoStack((stack) => [...stack, current]);
      setRedoStack([]);
      return next;
    });
  }, []);

  const config = useSynthesisStore((s) => s.config ?? {
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
      offset_ms: 0,
    },
    ambience_track: {
      relpath: "",
      gain_db: 0,
      loop: true,
      ducking_enabled: false,
      ducking_db: 8,
      offset_ms: 0,
    },
    tts_auto_retry: true,
    tts_retry_attempts: 2,
    tts_segment_concurrency: 1,
    timeline_lock_enabled: false,
  });

  const setConfig = (updater) =>
    useSynthesisStore.setState((s) => ({ config: { ...(s.config ?? {}), ...updater } }));

  useEffect(() => {
    if (!currentProject?.synthesis_config) {
      return;
    }
    const projectId = currentProject.id || null;
    const isSameProject = synthesisConfigProjectIdRef.current === projectId;
    synthesisConfigProjectIdRef.current = projectId;
    const hasSourceTimeline = Boolean(
      currentProject?.script?.metadata?.dubbing_source ||
      currentProject?.script?.metadata?.subtitle_source
    );
    useSynthesisStore.setState((state) => ({
      config: {
        ...(state.config ?? {}),
        ...currentProject.synthesis_config,
        timeline_lock_enabled: hasSourceTimeline
          ? (isSameProject ? Boolean(state.config?.timeline_lock_enabled ?? true) : true)
          : Boolean(currentProject.synthesis_config.timeline_lock_enabled ?? false),
      },
    }));
  }, [currentProject?.id, currentProject?.script?.metadata?.dubbing_source, currentProject?.script?.metadata?.subtitle_source, currentProject?.synthesis_config]);

  const isDubbingSourceProject = useMemo(
    () => Boolean(currentProject?.script?.metadata?.dubbing_source || currentProject?.script?.metadata?.subtitle_source),
    [currentProject?.script?.metadata?.dubbing_source, currentProject?.script?.metadata?.subtitle_source],
  );
  const useSourceTimeline = useMemo(
    () => {
      return Boolean(isDubbingSourceProject && config?.timeline_lock_enabled);
    },
    [config?.timeline_lock_enabled, isDubbingSourceProject],
  );

  useEffect(() => {
    const projectId = currentProject?.id || null;
    const normalized = normalizeDraftScript(currentProject?.script);
    const hasLocalChanges = computeScriptDiff(savedScript, draftScript).hasChanges;
    if (lastProjectIdRef.current !== projectId) {
      setSavedScript(normalized);
      resetHistory(normalized);
      setNewSegment(createSegmentDraft(normalized.segments.length));
      setSelectedSegmentIds([]);
      setEditingSegmentId(null);
      setSegmentDraft(null);
      setInsertAfterSegmentId(null);
      setActiveSpeakerFilter("all");
      setActiveStatusFilter("all");
      setRecentlyUpdatedSegmentId(null);
      setResolvedSegmentDurations({});
      setFullAudioCurrentTime(0);
      setFullAudioSeekSeconds(0);
      setFullAudioSeekSignal(0);
      setExpandedSynthesisPanel("synthesis");
      if (updatedRowTimerRef.current) {
        clearTimeout(updatedRowTimerRef.current);
        updatedRowTimerRef.current = null;
      }
      lastProjectIdRef.current = projectId;
      return;
    }
    if (!hasLocalChanges) {
      setSavedScript(normalized);
      resetHistory(normalized);
      setNewSegment((current) => ({ ...current, index: normalized.segments.length }));
    }
  }, [currentProject?.id, currentProject?.script, resetHistory]);

  useEffect(() => {
    return () => {
      if (updatedRowTimerRef.current) {
        clearTimeout(updatedRowTimerRef.current);
        updatedRowTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    const setOrDelete = (key, value, defaultValue) => {
      if (!value || value === defaultValue) {
        url.searchParams.delete(key);
      } else {
        url.searchParams.set(key, value);
      }
    };
    setOrDelete("speaker", activeSpeakerFilter, "all");
    setOrDelete("status", activeStatusFilter, "all");
    setOrDelete("panel", expandedSynthesisPanel, "synthesis");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [activeSpeakerFilter, activeStatusFilter, expandedSynthesisPanel]);

  useEffect(() => {
    let canceled = false;
    async function loadStaleReport() {
      if (!currentProject?.id) {
        if (!canceled) setStaleReport(null);
        return;
      }
      try {
        const report = await api.get(`/tts/projects/${currentProject.id}/stale-report`);
        if (!canceled) {
          setStaleReport(report);
        }
      } catch {
        if (!canceled) {
          setStaleReport(null);
        }
      }
    }
    loadStaleReport();
    return () => {
      canceled = true;
    };
  }, [currentProject?.id, currentProject?.updated_at, status]);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    async function pullRuntimeStatus() {
      try {
        const [sys, queue] = await Promise.all([api.get("/system/status"), fetchQueueSnapshot()]);
        if (!stopped) {
          setSystemRuntimeStatus(sys || null);
        }
        if (!stopped) {
          timer = setTimeout(pullRuntimeStatus, 5000);
        }
      } catch {
        if (!stopped) {
          timer = setTimeout(pullRuntimeStatus, 7000);
        }
      }
    }
    pullRuntimeStatus();
    return () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [fetchQueueSnapshot]);

  useEffect(() => {
    if (!currentProject?.id) {
      return;
    }
    const format = config.output_format || "wav";
    const versionKey = encodeURIComponent(currentProject.updated_at || "");
    const rawUrl = `${API_ORIGIN}/api/v1/tts/export?project_id=${currentProject.id}&format=${format}&variant=raw&v=${versionKey}`;
    const processedUrl = `${API_ORIGIN}/api/v1/tts/export?project_id=${currentProject.id}&format=${format}&variant=processed&v=${versionKey}`;
    const hasProcessed =
      Boolean(currentProject.audio_assets?.processed?.full_wav_relpath) ||
      Boolean(currentProject.audio_assets?.processed?.full_mp3_relpath);
    const hasRaw =
      Boolean(currentProject.audio_assets?.full_wav_relpath) ||
      Boolean(currentProject.audio_assets?.full_mp3_relpath);
    const chapterExports = Array.isArray(currentProject.audio_assets?.processed?.chapters)
      ? currentProject.audio_assets.processed.chapters.map((item) => ({
        id: item.id,
        title: item.title,
        wav_url: `/api/v1/tts/export/chapter?project_id=${currentProject.id}&chapter_id=${item.id}&format=wav&variant=processed`,
        mp3_url: `/api/v1/tts/export/chapter?project_id=${currentProject.id}&chapter_id=${item.id}&format=mp3&variant=processed`,
      }))
      : [];

    useSynthesisStore.setState(() => {
      const nextVariant = hasProcessed ? "processed" : "raw";
      const nextFullAudioUrl = hasProcessed ? processedUrl : hasRaw ? rawUrl : null;
      return {
        rawAudioUrl: hasRaw ? rawUrl : null,
        processedAudioUrl: hasProcessed ? processedUrl : null,
        fullAudioUrl: nextFullAudioUrl,
        audioVariant: nextVariant,
        subtitleSrtUrl: `${API_ORIGIN}/api/v1/tts/subtitle?project_id=${currentProject.id}&format=srt`,
        subtitleLrcUrl: `${API_ORIGIN}/api/v1/tts/subtitle?project_id=${currentProject.id}&format=lrc`,
        chapterExports,
      };
    });
  }, [config.output_format, currentProject]);

  const staleBySegmentId = useMemo(() => {
    const map = {};
    (staleReport?.items || []).forEach((item) => {
      map[item.segment_id] = item.status;
    });
    return map;
  }, [staleReport]);

  const staleItemBySegmentId = useMemo(() => {
    const map = {};
    (staleReport?.items || []).forEach((item) => {
      map[item.segment_id] = item;
    });
    return map;
  }, [staleReport]);

  const staleTargetIds = useMemo(() => {
    return buildStaleTargetIds(staleReport);
  }, [staleReport]);

  const failedAssetBySegmentId = useMemo(() => {
    const map = {};
    const failedItems = currentProject?.audio_assets?.failed_segments || [];
    failedItems.forEach((item) => {
      if (item?.segment_id) {
        map[item.segment_id] = item;
      }
    });
    return map;
  }, [currentProject?.audio_assets?.failed_segments]);

  const recommendedRegenerateIds = useMemo(() => {
    return buildRecommendedRegenerateIds(staleReport);
  }, [staleReport]);

  const staleSummary = useMemo(() => {
    const summary = { modified: 0, config: 0, missing: 0 };
    (staleReport?.items || []).forEach((item) => {
      if (!item) return;
      if (item.status === "missing") {
        summary.missing += 1;
        return;
      }
      const reasons = Array.isArray(item.reasons) ? item.reasons : [];
      const hasModifiedReason = reasons.some((reason) =>
        ["text_changed", "speaker_changed", "type_changed", "emotion_changed", "tts_overrides_changed"].includes(reason)
      );
      if (hasModifiedReason) {
        summary.modified += 1;
      } else if (item.status === "stale") {
        summary.config += 1;
      }
    });
    return summary;
  }, [staleReport]);

  const scriptDiff = useMemo(
    () => computeScriptDiff(savedScript, draftScript),
    [savedScript, draftScript]
  );
  const editingDraftDirty = useMemo(() => {
    if (!editingSegmentId || !segmentDraft) {
      return false;
    }
    const base = (draftScript?.segments || []).find((segment) => segment.id === editingSegmentId);
    return hasEditingDraftChanges(base, segmentDraft);
  }, [draftScript?.segments, editingSegmentId, segmentDraft]);
  const hasUnsavedChanges = scriptDiff.hasChanges || editingDraftDirty;

  const characters = useMemo(
    () => buildCharacterStats(draftScript?.segments || []),
    [draftScript?.segments]
  );
  const newSegmentSpeakerOptions = useMemo(
    () => buildSpeakerOptions(characters, { includeCreateOption: true }),
    [characters]
  );
  const segmentSpeakerOptions = useMemo(() => buildSpeakerOptions(characters), [characters]);
  const unsavedSegmentIds = useMemo(
    () => new Set([...(scriptDiff.addedSegmentIds || []), ...(scriptDiff.modifiedSegmentIds || [])]),
    [scriptDiff.addedSegmentIds, scriptDiff.modifiedSegmentIds]
  );
  const insertAfterLabel = useMemo(
    () => getInsertAnchorLabel(draftScript?.segments || [], insertAfterSegmentId),
    [draftScript?.segments, insertAfterSegmentId]
  );
  const canReorderTimeline = activeSpeakerFilter === "all";
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    if (activeSpeakerFilter === "all") {
      return;
    }
    const exists = characters.some((character) => character.name === activeSpeakerFilter);
    if (!exists) {
      setActiveSpeakerFilter("all");
    }
  }, [activeSpeakerFilter, characters]);

  const segments = useMemo(() => {
    const projectSegments = draftScript?.segments || [];
    const projectId = currentProject?.id || "";
    const taskBySegmentId = Object.fromEntries(
      Object.values(segmentResults || {})
        .filter((item) => item?.segment_id)
        .map((item) => [item.segment_id, item])
    );

    return projectSegments.map((segment, index) => {
      const taskSegment = taskBySegmentId[segment.id];
      const asset = currentProject?.audio_assets?.segments?.[segment.id];
      const failedAsset = failedAssetBySegmentId[segment.id];
      const staleStatus = staleBySegmentId[segment.id];
      const baseStatus = taskSegment?.status || (failedAsset ? "failed" : asset ? "done" : "pending");
      const displayStatus = resolveSegmentDisplayStatus(baseStatus, staleStatus);
      const segmentAudioBaseUrl = `/api/v1/tts/projects/${projectId}/segments/${segment.id}/audio`;
      const segmentAudioVersion =
        encodeURIComponent(asset?.created_at || asset?.fingerprint || `${taskSegment?.duration_ms || 0}`);
      const segmentAudioUrl = `${segmentAudioBaseUrl}?v=${segmentAudioVersion}`;

      return {
        segment_id: segment.id,
        index: segment.index ?? taskSegment?.index ?? index,
        speaker: segment.speaker,
        text: segment.text,
        type: segment.type || "dialogue",
        emotion: segment.emotion || "neutral",
        source_start_ms: segment.source_start_ms,
        source_end_ms: segment.source_end_ms,
        source_duration_ms: segment.source_duration_ms,
        tts_overrides: segment.tts_overrides,
        timing_check: segment.timing_check,
        status: baseStatus,
        display_status: displayStatus,
        workflow_status: resolveWorkflowStatus(displayStatus),
        draft_status: unsavedSegmentIds.has(segment.id) ? "unsaved" : "",
        duration_ms: taskSegment?.duration_ms ?? asset?.duration_ms ?? 0,
        audio_url: asset
          ? segmentAudioUrl
          : (taskSegment?.audio_url ? `${taskSegment.audio_url}${taskSegment.audio_url.includes("?") ? "&" : "?"}v=${segmentAudioVersion}` : null),
        peaks: taskSegment?.peaks || null,
        peaks_url: `/api/v1/tts/projects/${projectId}/segments/${segment.id}/peaks`,
        error: failedAsset?.error || taskSegment?.error || "",
        attempts: Number(failedAsset?.attempts || taskSegment?.attempts || 0),
      };
    });
  }, [currentProject, draftScript?.segments, failedAssetBySegmentId, segmentResults, staleBySegmentId, unsavedSegmentIds]);

  const visibleSegments = useMemo(() => {
    const speakerFiltered = filterSegmentsBySpeaker(segments, activeSpeakerFilter);
    return filterSegmentsByWorkflowStatus(speakerFiltered, activeStatusFilter);
  }, [segments, activeSpeakerFilter, activeStatusFilter]);

  const statusCounts = useMemo(() => {
    const summary = { all: segments.length, stale: 0, missing: 0, done: 0, failed: 0 };
    segments.forEach((segment) => {
      const status = segment.workflow_status || "other";
      if (status in summary) {
        summary[status] += 1;
      }
    });
    return summary;
  }, [segments]);
  const allCurrentSegmentsHaveReadyAudio = useMemo(
    () => segments.length > 0 && segments.every((segment) => segment.workflow_status === "done" && Boolean(segment.audio_url)),
    [segments]
  );
  const fullAudioRebuildRequired = Boolean(currentProject?.audio_assets?.full_rebuild_required);
  const canRebuildFullAudio = Boolean(
    currentProject?.id &&
    fullAudioRebuildRequired &&
    !hasUnsavedChanges &&
    !isRunning &&
    !isScriptSaving &&
    allCurrentSegmentsHaveReadyAudio
  );
  const fullAudioRebuildHint = useMemo(() => {
    if (!fullAudioRebuildRequired) return "当前完整音频已同步";
    if (hasUnsavedChanges) return "请先保存剧本";
    if (!allCurrentSegmentsHaveReadyAudio) return "请先补齐或重新生成缺失片段音频";
    if (isScriptSaving) return "剧本保存中";
    if (isRunning) return "当前有任务正在运行";
    return "可用现有分段音频重组完整音频";
  }, [allCurrentSegmentsHaveReadyAudio, fullAudioRebuildRequired, hasUnsavedChanges, isRunning, isScriptSaving]);
  const visibleSegmentIds = useMemo(
    () => visibleSegments.map((segment) => segment.segment_id),
    [visibleSegments]
  );
  const visibleSegmentIdSet = useMemo(() => new Set(visibleSegmentIds), [visibleSegmentIds]);
  const visibleStaleTargetIds = useMemo(
    () => staleTargetIds.filter((id) => visibleSegmentIdSet.has(id)),
    [staleTargetIds, visibleSegmentIdSet]
  );
  const visibleRecommendedRegenerateIds = useMemo(
    () => recommendedRegenerateIds.filter((id) => visibleSegmentIdSet.has(id)),
    [recommendedRegenerateIds, visibleSegmentIdSet]
  );

  useEffect(() => {
    if (!visibleRecommendedRegenerateIds.length) {
      return;
    }
    setSelectedSegmentIds((ids) => (ids.length ? ids : visibleRecommendedRegenerateIds));
  }, [visibleRecommendedRegenerateIds]);

  useEffect(() => {
    setSelectedSegmentIds((ids) => pruneSelectedSegmentIds(ids, visibleSegments));
  }, [visibleSegments]);

  const hasAnySegmentAudio = useMemo(
    () => segments.some((segment) => Boolean(segment.audio_url)),
    [segments],
  );
  const shouldShowSegmentTimeline = hasAnySegmentAudio || isRunning;

  useEffect(() => {
    let canceled = false;
    const needsResolve = segments.filter(
      (seg) =>
        seg.status === "done" &&
        Boolean(seg.audio_url) &&
        Number(seg.duration_ms || 0) <= 0 &&
        Number(resolvedSegmentDurations[seg.segment_id] || 0) <= 0
    );
    if (!needsResolve.length) {
      return () => {
        canceled = true;
      };
    }

    needsResolve.forEach((seg) => {
      const audio = new Audio(`${API_ORIGIN}${seg.audio_url}`);
      audio.preload = "metadata";
      audio.onloadedmetadata = () => {
        if (canceled) {
          return;
        }
        const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : 0;
        if (durationMs > 0) {
          setResolvedSegmentDurations((prev) => {
            if (prev[seg.segment_id] === durationMs) {
              return prev;
            }
            return { ...prev, [seg.segment_id]: durationMs };
          });
        }
      };
      audio.onerror = () => {};
      audio.load();
    });

    return () => {
      canceled = true;
    };
  }, [segments, resolvedSegmentDurations]);

  const segmentTimings = useMemo(() => {
    let cursor = 0;
    const gapMs = Number(config.gap_duration_ms || 300);
    const timings = {};
    segments.forEach(seg => {
      const durationMs = Number(seg.duration_ms || 0) > 0
        ? Number(seg.duration_ms || 0)
        : Number(resolvedSegmentDurations[seg.segment_id] || 0);
      const sourceStartMs = Number(seg.source_start_ms);
      const sourceEndMs = Number(seg.source_end_ms);
      const hasSourceTiming =
        useSourceTimeline &&
        Number.isFinite(sourceStartMs) &&
        Number.isFinite(sourceEndMs) &&
        sourceStartMs >= 0 &&
        sourceEndMs > sourceStartMs;
      let start = cursor;
      let resolvedEnd = start + durationMs;
      if (hasSourceTiming) {
        start = sourceStartMs;
        resolvedEnd = sourceEndMs;
      } else if (useSourceTimeline && Number.isFinite(sourceStartMs) && sourceStartMs >= 0) {
        start = sourceStartMs;
        resolvedEnd = start + durationMs;
      }
      timings[seg.segment_id] = { start, end: resolvedEnd };
      cursor = useSourceTimeline ? Math.max(cursor, resolvedEnd) : resolvedEnd + gapMs;
    });
    return timings;
  }, [segments, config.gap_duration_ms, resolvedSegmentDurations, useSourceTimeline]);

  const { isAutoPlay, currentSegmentId, playFrom, stop } = usePlaybackQueue(visibleSegments);
  const fullAudioCurrentSegmentId = useMemo(() => {
    const currentMs = Math.max(0, Math.round(Number(fullAudioCurrentTime || 0) * 1000));
    const boundarySegment = segments.find((segment) => {
      const timing = segmentTimings[segment.segment_id];
      if (!timing) {
        return false;
      }
      return Math.abs(currentMs - Number(timing.start)) <= SEGMENT_BOUNDARY_TOLERANCE_MS;
    });
    if (boundarySegment) {
      return boundarySegment.segment_id;
    }
    const activeSegment = segments.find((segment) => {
      const timing = segmentTimings[segment.segment_id];
      if (!timing) {
        return false;
      }
      return currentMs >= timing.start && currentMs < timing.end;
    });
    return activeSegment?.segment_id || null;
  }, [fullAudioCurrentTime, segments, segmentTimings]);
  const highlightedSegmentId = currentSegmentId || fullAudioCurrentSegmentId;

  function handleLocateFullAudioSegment(segment) {
    if (!fullAudioUrl) {
      pushToast({ title: "完整音频尚未生成，无法定位播放位置。", tone: "warning" });
      return;
    }
    const timing = segmentTimings[segment?.segment_id];
    const startMs = Number(timing?.start);
    if (!Number.isFinite(startMs) || startMs < 0) {
      pushToast({ title: "该片段缺少完整音频时间位置。", tone: "warning" });
      return;
    }
    const seekSeconds = startMs / 1000;
    setFullAudioCurrentTime(seekSeconds);
    setFullAudioSeekSeconds(seekSeconds);
    setFullAudioSeekSignal((value) => value + 1);
  }

  const totalSegments = draftScript?.segments?.length ?? 0;
  const progressPct = totalSegments > 0 ? Math.round((progress.current / totalSegments) * 100) : 0;
  const bgmPreviewUrl = currentProject?.id && config.bgm_track?.relpath
    ? `${API_ORIGIN}/api/v1/tts/projects/${currentProject.id}/postprocess/assets/preview?type=bgm&v=${encodeURIComponent(`${currentProject.updated_at || ""}:${config.bgm_track.relpath}`)}`
    : null;
  const ambiencePreviewUrl = currentProject?.id && config.ambience_track?.relpath
    ? `${API_ORIGIN}/api/v1/tts/projects/${currentProject.id}/postprocess/assets/preview?type=ambience&v=${encodeURIComponent(`${currentProject.updated_at || ""}:${config.ambience_track.relpath}`)}`
    : null;

  const {
    handleStart: startSynthesisTask,
    handleSingleSegmentSynthesis: regenerateSingleSegment,
    handleRegenerateSelected: regenerateSelectedSegments,
    handleImportArchive,
    handleCancelSynthesis,
  } = useSynthesisActions({
    currentProject,
    config,
    isRunning,
    selectedSegmentIds,
    startSynthesis,
    startPartialSynthesis,
    reset,
    refreshCurrentProject,
    importArchive,
    setSelectedSegmentIds,
    setRecentlyUpdatedSegmentId,
    updatedRowTimerRef,
    pushToast,
    cancelSynthesis,
  });

  function guardUnsavedChanges(actionLabel) {
    if (!hasUnsavedChanges) {
      return false;
    }
    pushToast({ title: `请先保存剧本后再${actionLabel}`, tone: "warning" });
    return true;
  }

  function handleUndo() {
    setUndoStack((past) => {
      if (!past.length) return past;
      const previous = past[past.length - 1];
      setRedoStack((future) => [draftScript, ...future]);
      setDraftScript(previous);
      return past.slice(0, -1);
    });
  }

  function handleRedo() {
    setRedoStack((future) => {
      if (!future.length) return future;
      const next = future[0];
      setUndoStack((past) => [...past, draftScript]);
      setDraftScript(next);
      return future.slice(1);
    });
  }

  useEffect(() => {
    function onKeyDown(event) {
      const isPrimary = event.ctrlKey || event.metaKey;
      if (!isPrimary) return;
      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }
      if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
        event.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draftScript, undoStack.length, redoStack.length]);

  function beginEditSegment(segment) {
    const baseSegment = (draftScript?.segments || []).find((item) => item.id === segment.segment_id);
    if (!baseSegment) {
      return;
    }
    setEditingSegmentId(segment.segment_id);
    setSegmentDraft(buildSegmentEditorDraft(baseSegment, { segments: draftScript?.segments || [] }));
  }

  function cancelEditSegment() {
    setEditingSegmentId(null);
    setSegmentDraft(null);
  }

  function saveEditedSegment(segment) {
    if (!segmentDraft) {
      return;
    }
    const normalized = normalizeSegmentFromEditorDraft(segmentDraft);
    if (!normalized.ok) {
      pushToast({ title: `片段编辑错误：${normalized.error}`, tone: "error" });
      return;
    }
    applyDraftMutation((current) => ({
      ...current,
      segments: (current.segments || []).map((item, index) =>
        item.id === segment.segment_id ? { ...normalized.value, id: item.id, index } : { ...item, index }
      ),
    }));
    setSelectedSegmentIds((ids) => (ids.includes(segment.segment_id) ? ids : [...ids, segment.segment_id]));
    pushToast({ title: "已加入草稿，点击“保存剧本”后生效", tone: "default" });
    cancelEditSegment();
  }

  function handleDeleteSegment(segmentId) {
    applyDraftMutation((current) => ({
      ...current,
      segments: (current.segments || [])
        .filter((segment) => segment.id !== segmentId)
        .map((segment, index) => ({ ...segment, index })),
    }));
    setSelectedSegmentIds((ids) => ids.filter((id) => id !== segmentId));
    setEditingSegmentId((current) => (current === segmentId ? null : current));
    setSegmentDraft((current) => (current?.id === segmentId ? null : current));
    setInsertAfterSegmentId((current) => (current === segmentId ? null : current));
    pushToast({ title: "已加入草稿，点击“保存剧本”后生效", tone: "default" });
  }

  function handleAddSegment() {
    if (!newSegment.text.trim()) {
      return;
    }
    const normalized = normalizeSegmentFromEditorDraft(newSegment);
    if (!normalized.ok) {
      pushToast({ title: `新增片段错误：${normalized.error}`, tone: "error" });
      return;
    }
    const toAdd = {
      ...normalized.value,
      id: normalized.value.id || crypto.randomUUID(),
      index: 0,
    };
    applyDraftMutation((current) => ({
      ...current,
      segments: (() => {
        const list = [...(current.segments || [])];
        const insertIndex = insertAfterSegmentId
          ? Math.max(0, list.findIndex((segment) => segment.id === insertAfterSegmentId) + 1)
          : list.length;
        const safeIndex = insertAfterSegmentId && insertIndex === 0 ? list.length : insertIndex;
        list.splice(safeIndex, 0, toAdd);
        return list.map((segment, index) => ({ ...segment, index }));
      })(),
    }));
    setNewSegment(createSegmentDraft((draftScript?.segments || []).length + 1));
    setInsertAfterSegmentId(null);
    pushToast({ title: "已加入草稿，点击“保存剧本”后生效", tone: "default" });
  }

  function handleApplySegmentSpeed(speed, scope = "all") {
    const value = Number(speed);
    if (!Number.isFinite(value) || value < 0.5 || value > 2) {
      pushToast({ title: "speed 需要在 0.5 到 2.0 之间", tone: "error" });
      return;
    }
    const selectedSet = new Set(selectedSegmentIds || []);
    const applySelected = scope === "selected" && selectedSet.size > 0;
    let changedCount = 0;
    applyDraftMutation((current) => ({
      ...current,
      segments: (current.segments || []).map((segment, index) => {
        const shouldUpdate = applySelected ? selectedSet.has(segment.id) : true;
        if (!shouldUpdate) return { ...segment, index };
        changedCount += 1;
        return {
          ...segment,
          index,
          tts_overrides: {
            ...(segment.tts_overrides && typeof segment.tts_overrides === "object" && !Array.isArray(segment.tts_overrides) ? segment.tts_overrides : {}),
            speed: value,
          },
        };
      }),
    }));
    if (editingSegmentId && segmentDraft?.id === editingSegmentId) {
      try {
        const parsed = JSON.parse(segmentDraft.ttsOverridesText || "{}");
        setSegmentDraft((current) => ({
          ...(current || {}),
          ttsOverridesText: JSON.stringify({ ...(parsed || {}), speed: value }, null, 2),
        }));
      } catch {
        // Keep the visible JSON untouched if it is already invalid; save validation will report it.
      }
    }
    pushToast({ title: `已为 ${changedCount} 个片段写入 speed=${value}，点击“保存剧本”后生效`, tone: "default" });
  }

  async function handleSaveScript() {
    if (!currentProject?.id) {
      return;
    }
    let workingDraftScript = draftScript;
    if (editingSegmentId && segmentDraft?.id === editingSegmentId) {
      const normalized = normalizeSegmentFromEditorDraft(segmentDraft);
      if (!normalized.ok) {
        pushToast({ title: `当前编辑片段错误：${normalized.error}`, tone: "error" });
        return;
      }
      workingDraftScript = {
        ...draftScript,
        segments: (draftScript.segments || []).map((segment, index) =>
          segment.id === editingSegmentId ? { ...normalized.value, id: segment.id, index } : { ...segment, index }
        ),
      };
    }
    const payload = {
      ...savedScript,
      ...workingDraftScript,
      segments: (workingDraftScript.segments || []).map((segment, index) => ({
        ...segment,
        index,
        speaker: (segment.speaker || "").trim() || "narrator",
        text: (segment.text || "").trim(),
        type: segment.type || "dialogue",
        emotion: segment.emotion || "neutral",
        non_verbal: Array.isArray(segment.non_verbal) ? segment.non_verbal : [],
        tts_overrides:
          segment.tts_overrides && typeof segment.tts_overrides === "object" && !Array.isArray(segment.tts_overrides)
            ? segment.tts_overrides
            : {},
        timing_check: buildSegmentTimingCheck(segment),
      })),
    };
    const updated = await saveScript({ projectId: currentProject.id, script: payload });
    await refreshCurrentProject(currentProject.id);
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    setNewSegment(createSegmentDraft(normalized.segments.length));
    setEditingSegmentId(null);
    setSegmentDraft(null);
  }

  async function handleStart() {
    if (guardUnsavedChanges("开始合成")) {
      return;
    }
    if (systemRuntimeStatus?.llm_loaded) {
      pushToast({ title: "检测到 LLM 已加载，合成前会自动释放以降低显存占用。", tone: "warning" });
    }
    await startSynthesisTask();
  }

  async function handleRetryFailed() {
    if (guardUnsavedChanges("重试失败段")) {
      return;
    }
    if (!currentProject?.id || isRunning) {
      return;
    }
    await startRetryFailed({
      projectId: currentProject.id,
      config: buildRuntimeConfig(config),
    });
    await refreshCurrentProject(currentProject.id);
  }

  async function handleResumeSynthesisRun() {
    if (guardUnsavedChanges("继续合成")) {
      return;
    }
    if (!currentProject?.id || isRunning) {
      return;
    }
    await startResumeSynthesis({
      projectId: currentProject.id,
      config: buildRuntimeConfig(config),
    });
    await refreshCurrentProject(currentProject.id);
  }

  function buildRuntimeConfig(baseConfig) {
    return {
      ...baseConfig,
      guidance_scale: Number(baseConfig.guidance_scale),
      num_step: Number(baseConfig.num_step),
      gap_duration_ms: Number(baseConfig.gap_duration_ms),
      target_lufs: Number(baseConfig.target_lufs),
      trim_threshold_db: Number(baseConfig.trim_threshold_db),
      trim_min_silence_ms: Number(baseConfig.trim_min_silence_ms),
      fade_in_ms: Number(baseConfig.fade_in_ms),
      fade_out_ms: Number(baseConfig.fade_out_ms),
      mp3_bitrate_kbps: Number(baseConfig.mp3_bitrate_kbps),
      tts_auto_retry: Boolean(baseConfig.tts_auto_retry ?? true),
      tts_retry_attempts: Number(baseConfig.tts_retry_attempts ?? 2),
      tts_segment_concurrency: Number(baseConfig.tts_segment_concurrency ?? 1),
      timeline_lock_enabled: Boolean(isDubbingSourceProject && (baseConfig.timeline_lock_enabled ?? false)),
      bgm_track: {
        ...(baseConfig.bgm_track || {}),
        gain_db: Number(baseConfig.bgm_track?.gain_db || 0),
        ducking_db: Number(baseConfig.bgm_track?.ducking_db || 8),
        offset_ms: Number(baseConfig.bgm_track?.offset_ms || 0),
      },
      ambience_track: {
        ...(baseConfig.ambience_track || {}),
        gain_db: Number(baseConfig.ambience_track?.gain_db || 0),
        ducking_db: Number(baseConfig.ambience_track?.ducking_db || 8),
        offset_ms: Number(baseConfig.ambience_track?.offset_ms || 0),
      },
    };
  }

  async function handleStartPostprocess() {
    if (guardUnsavedChanges("开始后期处理")) {
      return;
    }
    if (!currentProject?.id || isRunning) {
      return;
    }
    await startPostprocess({
      projectId: currentProject.id,
      config: buildRuntimeConfig(config),
    });
    await refreshCurrentProject(currentProject.id);
  }

  async function handleExtractBackground() {
    if (!currentProject?.id || isRunning) {
      return;
    }
    try {
      await startBackgroundExtraction({ projectId: currentProject.id });
      await refreshCurrentProject(currentProject.id);
    } catch {
      // Store-level error state and toast already report the failure.
    }
  }

  async function handleUploadPostprocessAsset(assetType, file) {
    if (!currentProject?.id || !file) {
      return;
    }
    setIsUploadingPostAsset(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const result = await api.uploadForm(
        `/tts/projects/${currentProject.id}/postprocess/assets?type=${assetType}`,
        form,
      );
      if (assetType === "bgm") {
        setConfig({
          bgm_track: {
            ...(config.bgm_track || {}),
            relpath: result.relpath || "",
          },
        });
      } else {
        setConfig({
          ambience_track: {
            ...(config.ambience_track || {}),
            relpath: result.relpath || "",
          },
        });
      }
      await refreshCurrentProject(currentProject.id);
      pushToast({ title: `${assetType === "bgm" ? "背景音乐" : "环境音"}已绑定`, tone: "success" });
    } catch (uploadError) {
      pushToast({ title: `素材上传失败：${uploadError?.message || uploadError}`, tone: "error" });
    } finally {
      setIsUploadingPostAsset(false);
    }
  }

  function handleClearPostprocessAsset(assetType) {
    if (assetType === "bgm") {
      setConfig({
        bgm_track: {
          ...(config.bgm_track || {}),
          relpath: "",
        },
      });
    } else {
      setConfig({
        ambience_track: {
          ...(config.ambience_track || {}),
          relpath: "",
        },
      });
    }
    pushToast({ title: `${assetType === "bgm" ? "背景音乐" : "环境音"}已移除`, tone: "success" });
  }

  async function handleSingleSegmentSynthesis(segmentId) {
    if (guardUnsavedChanges("重新生成")) {
      return;
    }
    await regenerateSingleSegment(segmentId);
  }

  async function handleRegenerateSelected(targetIds) {
    if (guardUnsavedChanges("重新生成")) {
      return;
    }
    await regenerateSelectedSegments(targetIds);
  }

  async function handleRebuildFullAudio() {
    if (guardUnsavedChanges("重组音频")) {
      return;
    }
    if (!canRebuildFullAudio) {
      pushToast({ title: fullAudioRebuildHint, tone: "warning" });
      return;
    }
    await startRebuildFullAudio({
      projectId: currentProject.id,
      config: buildRuntimeConfig(config),
    });
    await refreshCurrentProject(currentProject.id);
    setAudioVariant("raw");
  }

  function handleTimelineDragEnd(event) {
    const { active, over } = event;
    if (!canReorderTimeline || !over || active.id === over.id) {
      return;
    }
    applyDraftMutation((current) => {
      const list = [...(current.segments || [])];
      const oldIndex = list.findIndex((segment) => segment.id === active.id);
      const newIndex = list.findIndex((segment) => segment.id === over.id);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        return current;
      }
      const reordered = arrayMove(list, oldIndex, newIndex).map((segment, index) => ({ ...segment, index }));
      return { ...current, segments: reordered };
    });
  }

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    if (!currentProject) {
      pushToast({ title: "请先创建或选择项目", tone: "warning" });
      return;
    }
    const forceSaveAs = Boolean(options?.forceSaveAs);
    const payload = buildProjectFilePayload({
      project: currentProject,
      script: draftScript || script,
      sourceText: draftScript?.source_text || sourceText || script?.source_text || "",
    });
    try {
      const result = await saveProjectFile({
        payload,
        preferredName: currentProject.name,
        existingHandle: currentProjectFileHandle || null,
        forceSaveAs,
      });
      if (result?.handle) {
        bindCurrentProjectFile({ handle: result.handle, fileName: result.fileName || "" });
      }
      pushToast({
        title: forceSaveAs ? "项目文件已另存" : result?.mode === "inplace" ? "项目文件已保存" : "项目文件已导出",
        tone: "success",
      });
    } catch (saveError) {
      if (saveError?.name === "AbortError") {
        return;
      }
      pushToast({ title: `保存项目失败：${saveError?.message || "未知错误"}`, tone: "error" });
    }
  }, [
    currentProject,
    draftScript,
    script,
    sourceText,
    currentProjectFileHandle,
    bindCurrentProjectFile,
    pushToast,
  ]);

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  return (
    <div className="pageGrid" style={{ gap: 20 }}>
      {/* Control row */}
      <div className="pageGrid twoCols" style={{ alignItems: "stretch" }}>
        <div className="listStack">
          <SynthesisGenerateCard
            expanded={expandedSynthesisPanel === "synthesis"}
            onToggle={() => setExpandedSynthesisPanel((current) => (current === "synthesis" ? "" : "synthesis"))}
            config={config}
            currentProject={currentProject}
            selectedSegmentCount={selectedSegmentIds.length}
            isRunning={isRunning}
            error={error}
            onSetConfig={setConfig}
            onApplySegmentSpeed={handleApplySegmentSpeed}
            onStart={handleStart}
            onCancel={handleCancelSynthesis}
            isDubbingSourceProject={isDubbingSourceProject}
          />
          <SynthesisPostprocessCard
            expanded={expandedSynthesisPanel === "postprocess"}
            onToggle={() => setExpandedSynthesisPanel((current) => (current === "postprocess" ? "" : "postprocess"))}
            config={config}
            segments={draftScript?.segments || []}
            currentProject={currentProject}
            isRunning={isRunning}
            isUploadingPostAsset={isUploadingPostAsset}
            bgmPreviewUrl={bgmPreviewUrl}
            ambiencePreviewUrl={ambiencePreviewUrl}
            onSetConfig={setConfig}
            onStartPostprocess={handleStartPostprocess}
            onExtractBackground={handleExtractBackground}
            onUploadPostprocessAsset={handleUploadPostprocessAsset}
            onClearPostprocessAsset={handleClearPostprocessAsset}
          />
        </div>
        <SynthesisTaskStatusCard
          API_ORIGIN={API_ORIGIN}
          staleReport={staleReport}
          staleSummary={staleSummary}
          modelStatus={modelStatus}
          status={status}
          connectionStatus={connectionStatus}
          progress={progress}
          queuePosition={queuePosition}
          failedCount={failedCount}
          retryCount={retryCount}
          effectiveSegmentConcurrency={effectiveSegmentConcurrency}
          queueSnapshot={queueSnapshot}
          runtimeStatus={systemRuntimeStatus}
          totalSegments={totalSegments}
          taskId={taskId}
          lastSyncError={lastSyncError}
          isRunning={isRunning}
          progressPct={progressPct}
          fullAudioUrl={fullAudioUrl}
          rawAudioUrl={rawAudioUrl}
          processedAudioUrl={processedAudioUrl}
          chapterExports={chapterExports}
          audioVariant={audioVariant}
          onAudioVariantChange={setAudioVariant}
          subtitleSrtUrl={subtitleSrtUrl}
          subtitleLrcUrl={subtitleLrcUrl}
          currentProject={currentProject}
          importWarnings={importWarnings}
          archiveInputRef={archiveInputRef}
          onImportArchive={handleImportArchive}
          onRetryFailed={handleRetryFailed}
          onResume={handleResumeSynthesisRun}
          onCancelTask={handleCancelSynthesis}
          onOpenExportWizard={() => setExportWizardOpen(true)}
        />
      </div>

      {/* Full audio player */}
      <SynthesisFullAudioCard
        projectId={currentProject?.id}
        fullAudioUrl={fullAudioUrl}
        audioVariant={audioVariant}
        segments={segments}
        gapDurationMs={Number(config.gap_duration_ms || 300)}
        useSourceTimeline={useSourceTimeline}
        onCurrentTimeChange={setFullAudioCurrentTime}
        seekToSeconds={fullAudioSeekSeconds}
        seekSignal={fullAudioSeekSignal}
      />

      <div className="pageGrid sidebarLayout">
        <ScriptSidebarColumn
          characters={characters}
          totalSegments={segments.length}
          activeSpeakerFilter={activeSpeakerFilter}
          onSelectSpeaker={setActiveSpeakerFilter}
          hasUnsavedChanges={hasUnsavedChanges}
          error={scriptError}
          newSegment={newSegment}
          newSegmentSpeakerOptions={newSegmentSpeakerOptions}
          canEdit={Boolean(currentProject?.id)}
          isSaving={isScriptSaving}
          insertAfterLabel={insertAfterLabel}
          onClearInsertAnchor={() => setInsertAfterSegmentId(null)}
          onNewSegmentFieldChange={(field, value) => setNewSegment((current) => ({ ...current, [field]: value }))}
          onAddSegment={handleAddSegment}
          addButtonLabel="+ 添加片段"
          actionContent={
            <>
              <div className="controlRow" style={{ gap: 8, flexWrap: "wrap" }}>
                <Button variant="ghost" icon={Undo2} onClick={handleUndo} disabled={!undoStack.length}>
                  撤销
                </Button>
                <Button variant="ghost" icon={Redo2} onClick={handleRedo} disabled={!redoStack.length}>
                  重做
                </Button>
              </div>
              <Button
                variant="primary"
                disabled={!currentProject?.id || isScriptSaving || !hasUnsavedChanges}
                onClick={handleSaveScript}
              >
                {isScriptSaving ? "保存中…" : hasUnsavedChanges ? "保存剧本" : "已保存"}
              </Button>
              <Button variant="secondary" onClick={() => setDiffPreviewOpen(true)} disabled={!hasUnsavedChanges}>
                查看差异
              </Button>
            </>
          }
        />

        <SynthesisTimelineCard
          API_ORIGIN={API_ORIGIN}
          sensors={sensors}
          canReorderTimeline={canReorderTimeline}
          onTimelineDragEnd={handleTimelineDragEnd}
          segments={visibleSegments}
          totalVisibleSegments={visibleSegments.length}
          activeSpeakerFilter={activeSpeakerFilter}
          activeStatusFilter={activeStatusFilter}
          statusCounts={statusCounts}
          onStatusFilterChange={setActiveStatusFilter}
          shouldShowSegmentTimeline={shouldShowSegmentTimeline}
          selectedSegmentIds={selectedSegmentIds}
          setSelectedSegmentIds={setSelectedSegmentIds}
          staleTargetIds={visibleStaleTargetIds}
          recommendedRegenerateIds={visibleRecommendedRegenerateIds}
          isRunning={isRunning}
          handleRegenerateSelected={handleRegenerateSelected}
          canRebuildFullAudio={canRebuildFullAudio}
          fullAudioRebuildRequired={fullAudioRebuildRequired}
          fullAudioRebuildHint={fullAudioRebuildHint}
          handleRebuildFullAudio={handleRebuildFullAudio}
          staleItemBySegmentId={staleItemBySegmentId}
          getSegmentStaleLabel={getSegmentStaleLabel}
          segmentTimings={segmentTimings}
          formatTimeMs={formatTimeMs}
          currentSegmentId={highlightedSegmentId}
          recentlyUpdatedSegmentId={recentlyUpdatedSegmentId}
          editingSegmentId={editingSegmentId}
          segmentDraft={segmentDraft}
          setSegmentDraft={setSegmentDraft}
          isScriptSaving={isScriptSaving}
          beginEditSegment={beginEditSegment}
          cancelEditSegment={cancelEditSegment}
          saveEditedSegment={saveEditedSegment}
          handleSingleSegmentSynthesis={handleSingleSegmentSynthesis}
          handleDeleteSegment={handleDeleteSegment}
          setInsertAfterSegmentId={setInsertAfterSegmentId}
          insertAfterSegmentId={insertAfterSegmentId}
          onLocateFullAudioSegment={handleLocateFullAudioSegment}
          playFrom={playFrom}
          isAutoPlay={isAutoPlay}
          stop={stop}
          pushToast={pushToast}
        />
      </div>
      <ScriptDiffPreviewDialog open={diffPreviewOpen} onOpenChange={setDiffPreviewOpen} diff={scriptDiff} />
      <ExportWizardDialog
        open={exportWizardOpen}
        onOpenChange={setExportWizardOpen}
        API_ORIGIN={API_ORIGIN}
        currentProject={currentProject}
        audioVariant={audioVariant}
      />
    </div>
  );
}
