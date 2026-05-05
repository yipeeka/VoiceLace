import { useEffect, useMemo, useRef, useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import ScriptSidebarColumn from "../components/script/ScriptSidebarColumn";
import ScriptDiffPreviewDialog from "../components/script/ScriptDiffPreviewDialog";
import Button from "../components/ui/Button";
import SynthesisConfigCard from "../components/synthesis/SynthesisConfigCard";
import SynthesisTaskStatusCard from "../components/synthesis/SynthesisTaskStatusCard";
import SynthesisFullAudioCard from "../components/synthesis/SynthesisFullAudioCard";
import SynthesisTimelineCard from "../components/synthesis/SynthesisTimelineCard";
import { usePlaybackQueue } from "../hooks/usePlaybackQueue";
import { useSynthesisActions } from "../hooks/useSynthesisActions";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useSynthesisStore } from "../stores/useSynthesisStore";
import { useUiStore } from "../stores/useUiStore";
import { API_ORIGIN, api } from "../utils/api";
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

function formatTimeMs(ms) {
  if (!ms || isNaN(ms)) return "0:00";
  const totalSeconds = Math.max(0, Math.round(Number(ms) / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SynthesisPage() {
  const { currentProject, refreshCurrentProject, importArchive, importWarnings } = useProjectStore();
  const {
    taskId, status, connectionStatus, modelStatus, lastSyncError, progress, segmentResults, fullAudioUrl, isRunning, error,
    subtitleSrtUrl, subtitleLrcUrl,
    startSynthesis, startPartialSynthesis, cancelSynthesis, reset,
  } = useSynthesisStore();
  const archiveInputRef = useRef(null);
  const lastProjectIdRef = useRef(null);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState([]);
  const [staleReport, setStaleReport] = useState(null);
  const [editingSegmentId, setEditingSegmentId] = useState(null);
  const [segmentDraft, setSegmentDraft] = useState(null);
  const [savedScript, setSavedScript] = useState(() => normalizeDraftScript(currentProject?.script));
  const [draftScript, setDraftScript] = useState(() => normalizeDraftScript(currentProject?.script));
  const [newSegment, setNewSegment] = useState(() => createSegmentDraft(0));
  const [insertAfterSegmentId, setInsertAfterSegmentId] = useState(null);
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState("all");
  const [activeStatusFilter, setActiveStatusFilter] = useState("all");
  const [recentlyUpdatedSegmentId, setRecentlyUpdatedSegmentId] = useState(null);
  const [resolvedSegmentDurations, setResolvedSegmentDurations] = useState({});
  const [fullAudioCurrentTime, setFullAudioCurrentTime] = useState(0);
  const [diffPreviewOpen, setDiffPreviewOpen] = useState(false);
  const updatedRowTimerRef = useRef(null);
  const { saveScript, isSaving: isScriptSaving, error: scriptError } = useScriptStore();
  const pushToast = useUiStore.getState().pushToast;

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
  });

  const setConfig = (updater) =>
    useSynthesisStore.setState((s) => ({ config: { ...(s.config ?? {}), ...updater } }));

  useEffect(() => {
    if (currentProject?.synthesis_config) {
      setConfig(currentProject.synthesis_config);
    }
  }, [currentProject]);

  useEffect(() => {
    const projectId = currentProject?.id || null;
    const normalized = normalizeDraftScript(currentProject?.script);
    const hasLocalChanges = computeScriptDiff(savedScript, draftScript).hasChanges;
    if (lastProjectIdRef.current !== projectId) {
      setSavedScript(normalized);
      setDraftScript(normalized);
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
      if (updatedRowTimerRef.current) {
        clearTimeout(updatedRowTimerRef.current);
        updatedRowTimerRef.current = null;
      }
      lastProjectIdRef.current = projectId;
      return;
    }
    if (!hasLocalChanges) {
      setSavedScript(normalized);
      setDraftScript(normalized);
      setNewSegment((current) => ({ ...current, index: normalized.segments.length }));
    }
  }, [currentProject?.id, currentProject?.script]);

  useEffect(() => {
    return () => {
      if (updatedRowTimerRef.current) {
        clearTimeout(updatedRowTimerRef.current);
        updatedRowTimerRef.current = null;
      }
    };
  }, []);

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
    if (!currentProject?.id) {
      return;
    }
    const hasImportedAudio =
      Boolean(currentProject.audio_assets?.full_wav_relpath) || Boolean(currentProject.audio_assets?.full_mp3_relpath);
    if (!hasImportedAudio) {
      return;
    }
    const format = config.output_format || "wav";
    useSynthesisStore.setState((state) => ({
      fullAudioUrl: state.fullAudioUrl || `${API_ORIGIN}/api/v1/tts/export?project_id=${currentProject.id}&format=${format}`,
      subtitleSrtUrl: state.subtitleSrtUrl || `${API_ORIGIN}/api/v1/tts/subtitle?project_id=${currentProject.id}&format=srt`,
      subtitleLrcUrl: state.subtitleLrcUrl || `${API_ORIGIN}/api/v1/tts/subtitle?project_id=${currentProject.id}&format=lrc`,
    }));
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
      const staleStatus = staleBySegmentId[segment.id];
      const baseStatus = taskSegment?.status || (asset ? "done" : "pending");
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
      };
    });
  }, [currentProject, draftScript?.segments, segmentResults, staleBySegmentId, unsavedSegmentIds]);

  const visibleSegments = useMemo(() => {
    const speakerFiltered = filterSegmentsBySpeaker(segments, activeSpeakerFilter);
    return filterSegmentsByWorkflowStatus(speakerFiltered, activeStatusFilter);
  }, [segments, activeSpeakerFilter, activeStatusFilter]);

  const statusCounts = useMemo(() => {
    const summary = { all: segments.length, stale: 0, missing: 0, done: 0 };
    segments.forEach((segment) => {
      const status = segment.workflow_status || "other";
      if (status in summary) {
        summary[status] += 1;
      }
    });
    return summary;
  }, [segments]);
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
      const start = cursor;
      const end = cursor + durationMs;
      timings[seg.segment_id] = { start, end };
      cursor = end + gapMs;
    });
    return timings;
  }, [segments, config.gap_duration_ms, resolvedSegmentDurations]);

  const { isAutoPlay, currentSegmentId, playFrom, stop } = usePlaybackQueue(visibleSegments);
  const fullAudioCurrentSegmentId = useMemo(() => {
    const currentMs = Math.max(0, Number(fullAudioCurrentTime || 0) * 1000);
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

  const totalSegments = draftScript?.segments?.length ?? 0;
  const progressPct = totalSegments > 0 ? Math.round((progress.current / totalSegments) * 100) : 0;

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

  function beginEditSegment(segment) {
    const baseSegment = (draftScript?.segments || []).find((item) => item.id === segment.segment_id);
    if (!baseSegment) {
      return;
    }
    setEditingSegmentId(segment.segment_id);
    setSegmentDraft(buildSegmentEditorDraft(baseSegment));
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
      pushToast({ title: `tts_overrides JSON 格式错误：${normalized.error}`, tone: "error" });
      return;
    }
    setDraftScript((current) => ({
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
    setDraftScript((current) => ({
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
      pushToast({ title: `新增片段 tts_overrides JSON 格式错误：${normalized.error}`, tone: "error" });
      return;
    }
    const toAdd = {
      ...normalized.value,
      id: normalized.value.id || crypto.randomUUID(),
      index: 0,
    };
    setDraftScript((current) => ({
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

  async function handleSaveScript() {
    if (!currentProject?.id) {
      return;
    }
    let workingDraftScript = draftScript;
    if (editingSegmentId && segmentDraft?.id === editingSegmentId) {
      const normalized = normalizeSegmentFromEditorDraft(segmentDraft);
      if (!normalized.ok) {
        pushToast({ title: `当前编辑片段 tts_overrides JSON 格式错误：${normalized.error}`, tone: "error" });
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
      })),
    };
    const updated = await saveScript({ projectId: currentProject.id, script: payload });
    await refreshCurrentProject(currentProject.id);
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    setDraftScript(normalized);
    setNewSegment(createSegmentDraft(normalized.segments.length));
    setEditingSegmentId(null);
    setSegmentDraft(null);
  }

  async function handleStart() {
    if (guardUnsavedChanges("开始合成")) {
      return;
    }
    await startSynthesisTask();
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

  function handleTimelineDragEnd(event) {
    const { active, over } = event;
    if (!canReorderTimeline || !over || active.id === over.id) {
      return;
    }
    setDraftScript((current) => {
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

  return (
    <div className="pageGrid" style={{ gap: 20 }}>
      {/* Control row */}
      <div className="pageGrid twoCols" style={{ alignItems: "stretch" }}>
        <SynthesisConfigCard
          config={config}
          currentProject={currentProject}
          isRunning={isRunning}
          error={error}
          onSetConfig={setConfig}
          onStart={handleStart}
          onCancel={handleCancelSynthesis}
        />
        <SynthesisTaskStatusCard
          API_ORIGIN={API_ORIGIN}
          staleReport={staleReport}
          staleSummary={staleSummary}
          modelStatus={modelStatus}
          status={status}
          connectionStatus={connectionStatus}
          progress={progress}
          totalSegments={totalSegments}
          taskId={taskId}
          lastSyncError={lastSyncError}
          isRunning={isRunning}
          progressPct={progressPct}
          fullAudioUrl={fullAudioUrl}
          subtitleSrtUrl={subtitleSrtUrl}
          subtitleLrcUrl={subtitleLrcUrl}
          currentProject={currentProject}
          importWarnings={importWarnings}
          archiveInputRef={archiveInputRef}
          onImportArchive={handleImportArchive}
        />
      </div>

      {/* Full audio player */}
      <SynthesisFullAudioCard
        projectId={currentProject?.id}
        fullAudioUrl={fullAudioUrl}
        segments={segments}
        gapDurationMs={Number(config.gap_duration_ms || 300)}
        onCurrentTimeChange={setFullAudioCurrentTime}
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
              <Button
                variant="primary"
                disabled={!currentProject?.id || isScriptSaving || !hasUnsavedChanges}
                onClick={handleSaveScript}
              >
                {isScriptSaving ? "保存中..." : hasUnsavedChanges ? "保存剧本" : "已保存"}
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
          playFrom={playFrom}
          isAutoPlay={isAutoPlay}
          stop={stop}
          pushToast={pushToast}
        />
      </div>
      <ScriptDiffPreviewDialog open={diffPreviewOpen} onOpenChange={setDiffPreviewOpen} diff={scriptDiff} />
    </div>
  );
}
