import { useEffect, useMemo, useRef, useState } from "react";

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
import {
  buildRecommendedRegenerateIds,
  buildStaleTargetIds,
  getSegmentStaleLabel,
  resolveSegmentDisplayStatus,
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
  const [selectedSegmentIds, setSelectedSegmentIds] = useState([]);
  const [staleReport, setStaleReport] = useState(null);
  const [editingSegmentId, setEditingSegmentId] = useState(null);
  const [segmentDraft, setSegmentDraft] = useState(null);
  const [recentlyUpdatedSegmentId, setRecentlyUpdatedSegmentId] = useState(null);
  const [resolvedSegmentDurations, setResolvedSegmentDurations] = useState({});
  const updatedRowTimerRef = useRef(null);
  const { updateSegment, isSaving: isScriptSaving } = useScriptStore();
  const pushToast = useUiStore.getState().pushToast;

  const config = useSynthesisStore((s) => s.config ?? {
    num_step: 32,
    guidance_scale: 2,
    denoise: true,
    gap_duration_ms: 500,
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
    setSelectedSegmentIds([]);
    setEditingSegmentId(null);
    setSegmentDraft(null);
    setRecentlyUpdatedSegmentId(null);
    setResolvedSegmentDurations({});
    if (updatedRowTimerRef.current) {
      clearTimeout(updatedRowTimerRef.current);
      updatedRowTimerRef.current = null;
    }
  }, [currentProject?.id]);

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

  useEffect(() => {
    if (!recommendedRegenerateIds.length) {
      return;
    }
    setSelectedSegmentIds((ids) => (ids.length ? ids : recommendedRegenerateIds));
  }, [recommendedRegenerateIds]);

  const segments = useMemo(() => {
    const projectSegments = currentProject?.script?.segments || [];
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
      const segmentAudioBaseUrl = `/api/v1/tts/projects/${currentProject.id}/segments/${segment.id}/audio`;
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
        duration_ms: taskSegment?.duration_ms ?? asset?.duration_ms ?? 0,
        audio_url: asset
          ? segmentAudioUrl
          : (taskSegment?.audio_url ? `${taskSegment.audio_url}${taskSegment.audio_url.includes("?") ? "&" : "?"}v=${segmentAudioVersion}` : null),
        peaks: taskSegment?.peaks || null,
        peaks_url: `/api/v1/tts/projects/${currentProject.id}/segments/${segment.id}/peaks`,
      };
    });
  }, [currentProject, segmentResults, staleBySegmentId]);

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
    const gapMs = Number(config.gap_duration_ms || 500);
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

  const { isAutoPlay, currentSegmentId, playFrom, stop } = usePlaybackQueue(segments);

  const totalSegments = currentProject?.script?.segments?.length ?? 0;
  const progressPct = totalSegments > 0 ? Math.round((progress.current / totalSegments) * 100) : 0;

  const {
    handleStart,
    handleSingleSegmentSynthesis,
    handleRegenerateSelected,
    handleImportArchive,
    handleCancelSynthesis,
    beginEditSegment,
    cancelEditSegment,
    saveEditedSegment,
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
    setEditingSegmentId,
    setSegmentDraft,
    segmentDraft,
    updateSegment,
    pushToast,
    cancelSynthesis,
  });

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
        gapDurationMs={Number(config.gap_duration_ms || 500)}
      />

      {/* Segment timeline */}
      <SynthesisTimelineCard
        API_ORIGIN={API_ORIGIN}
        segments={segments}
        shouldShowSegmentTimeline={shouldShowSegmentTimeline}
        selectedSegmentIds={selectedSegmentIds}
        setSelectedSegmentIds={setSelectedSegmentIds}
        staleTargetIds={staleTargetIds}
        recommendedRegenerateIds={recommendedRegenerateIds}
        isRunning={isRunning}
        handleRegenerateSelected={handleRegenerateSelected}
        staleItemBySegmentId={staleItemBySegmentId}
        getSegmentStaleLabel={getSegmentStaleLabel}
        segmentTimings={segmentTimings}
        formatTimeMs={formatTimeMs}
        currentSegmentId={currentSegmentId}
        recentlyUpdatedSegmentId={recentlyUpdatedSegmentId}
        editingSegmentId={editingSegmentId}
        segmentDraft={segmentDraft}
        setSegmentDraft={setSegmentDraft}
        isScriptSaving={isScriptSaving}
        beginEditSegment={beginEditSegment}
        cancelEditSegment={cancelEditSegment}
        saveEditedSegment={saveEditedSegment}
        handleSingleSegmentSynthesis={handleSingleSegmentSynthesis}
        playFrom={playFrom}
        isAutoPlay={isAutoPlay}
        stop={stop}
        pushToast={pushToast}
      />
    </div>
  );
}
