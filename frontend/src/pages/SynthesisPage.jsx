import { Download, Pencil, Play, Save, Square, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import AudioPlayer from "../components/shared/AudioPlayer";
import CharacterBadge from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import GlassCard from "../components/shared/GlassCard";
import SynthesisWaveSurfer from "../components/shared/SynthesisWaveSurfer";
import SegmentEditorFields from "../components/script/SegmentEditorFields";
import Button from "../components/ui/Button";
import Progress from "../components/ui/Progress";
import Select from "../components/ui/Select";
import Slider from "../components/ui/Slider";
import { usePlaybackQueue } from "../hooks/usePlaybackQueue";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useSynthesisStore } from "../stores/useSynthesisStore";
import { useUiStore } from "../stores/useUiStore";
import { API_ORIGIN, api } from "../utils/api";
import { parseCsvList, parseOverridesJson } from "../utils/segmentDraft";
import {
  buildRecommendedRegenerateIds,
  buildStaleTargetIds,
  getSegmentStaleLabel,
  resolveSegmentDisplayStatus,
} from "../utils/stale";

const STATUS_ICON = { done: "✅", running: "⏳", pending: "⬜", error: "❌", skipped: "⏭", stale: "🟨", missing: "⚠" };
const STATUS_ROW_CLS = { done: "done", running: "running", pending: "pending", error: "error", stale: "stale", missing: "missing" };

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

  async function handleStart() {
    if (!currentProject?.id) return;
    reset();
    await startSynthesis({
      projectId: currentProject.id,
      config: {
        ...config,
        guidance_scale: Number(config.guidance_scale),
        num_step: Number(config.num_step),
        gap_duration_ms: Number(config.gap_duration_ms),
      },
    });
    await refreshCurrentProject(currentProject.id);
  }

  async function handlePartialSynthesis(segmentIds, { rebuildFull = true } = {}) {
    if (!currentProject?.id || !segmentIds?.length) return;
    await startPartialSynthesis({
      projectId: currentProject.id,
      config: {
        ...config,
        guidance_scale: Number(config.guidance_scale),
        num_step: Number(config.num_step),
        gap_duration_ms: Number(config.gap_duration_ms),
      },
      segmentIds,
      rebuildFull,
    });
    await refreshCurrentProject(currentProject.id);
    setSelectedSegmentIds([]);
  }

  async function handleSingleSegmentSynthesis(segmentId) {
    if (!segmentId) return;
    setSelectedSegmentIds([]);
    await handlePartialSynthesis([segmentId], { rebuildFull: false });
    setRecentlyUpdatedSegmentId(segmentId);
    if (updatedRowTimerRef.current) {
      clearTimeout(updatedRowTimerRef.current);
    }
    updatedRowTimerRef.current = setTimeout(() => {
      setRecentlyUpdatedSegmentId((current) => (current === segmentId ? null : current));
      updatedRowTimerRef.current = null;
    }, 1800);
  }

  async function handleRegenerateSelected() {
    if (!selectedSegmentIds.length || isRunning) {
      return;
    }
    const ok = window.confirm(`确认重新生成已选 ${selectedSegmentIds.length} 段？这会重建整本音频与字幕。`);
    if (!ok) {
      return;
    }
    await handlePartialSynthesis(selectedSegmentIds);
  }

  async function handleImportArchive(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await importArchive(file);
  }

  function beginEditSegment(segment) {
    const baseSegment = (currentProject?.script?.segments || []).find((item) => item.id === segment.segment_id);
    setEditingSegmentId(segment.segment_id);
    setSegmentDraft({
      speaker: baseSegment?.speaker || segment.speaker || "narrator",
      text: baseSegment?.text || segment.text || "",
      type: baseSegment?.type || segment.type || "dialogue",
      emotion: baseSegment?.emotion || segment.emotion || "neutral",
      nonVerbalText: Array.isArray(baseSegment?.non_verbal) ? baseSegment.non_verbal.join(", ") : "",
      ttsOverridesText: JSON.stringify(baseSegment?.tts_overrides || {}, null, 2),
    });
  }

  function cancelEditSegment() {
    setEditingSegmentId(null);
    setSegmentDraft(null);
  }

  async function saveEditedSegment(segment) {
    if (!currentProject?.id || !segmentDraft) {
      return;
    }
    const baseSegment = (currentProject.script?.segments || []).find((item) => item.id === segment.segment_id);
    if (!baseSegment) {
      useUiStore.getState().pushToast({ title: "找不到片段，无法保存", tone: "error" });
      return;
    }
    const parsed = parseOverridesJson(segmentDraft.ttsOverridesText || "{}");
    if (!parsed.ok) {
      useUiStore.getState().pushToast({
        title: `tts_overrides JSON 格式错误：${parsed.error}`,
        tone: "error",
      });
      return;
    }

    await updateSegment({
      projectId: currentProject.id,
      segmentId: segment.segment_id,
      segment: {
        ...baseSegment,
        speaker: (segmentDraft.speaker || "").trim() || "narrator",
        text: (segmentDraft.text || "").trim(),
        type: segmentDraft.type || "dialogue",
        emotion: segmentDraft.emotion || "neutral",
        non_verbal: parseCsvList(segmentDraft.nonVerbalText),
        tts_overrides: parsed.value,
      },
    });
    await refreshCurrentProject(currentProject.id);
    setSelectedSegmentIds((ids) => (ids.includes(segment.segment_id) ? ids : [...ids, segment.segment_id]));
    useUiStore.getState().pushToast({ title: "片段已修改，已加入待重新生成", tone: "success" });
    cancelEditSegment();
  }

  return (
    <div className="pageGrid" style={{ gap: 20 }}>
      {/* Control row */}
      <div className="pageGrid twoCols" style={{ alignItems: "stretch" }}>
        <GlassCard>
          <h2 className="cardTitle">合成参数</h2>
          <p className="cardSubtitle">基于当前项目剧本与声音配置执行整本合成。</p>

          <Slider
            label="推理步数 (num_step)"
            value={[Number(config.num_step)]}
            onValueChange={([v]) => setConfig({ num_step: v })}
            min={8} max={100} step={4}
          />
          <Slider
            label="CFG 强度 (guidance_scale)"
            value={[Number(config.guidance_scale)]}
            onValueChange={([v]) => setConfig({ guidance_scale: v })}
            min={0.5} max={10} step={0.1}
          />
          <Slider
            label="段间静音 (ms)"
            value={[Number(config.gap_duration_ms)]}
            onValueChange={([v]) => setConfig({ gap_duration_ms: v })}
            min={0} max={2000} step={100} unit="ms"
          />

          <div className="editorGrid">
            <div className="formGroup">
              <label className="formLabel">输出格式</label>
              <Select
                value={config.output_format}
                onValueChange={(v) => setConfig({ output_format: v })}
                options={[{ value: "wav", label: "WAV" }, { value: "mp3", label: "MP3" }]}
              />
            </div>
            <div className="formGroup">
              <label className="formLabel">降噪</label>
              <label
                className="controlRow"
                style={{ cursor: "pointer", padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-default)" }}
              >
                <input
                  type="checkbox"
                  checked={Boolean(config.denoise)}
                  onChange={(e) => setConfig({ denoise: e.target.checked })}
                  style={{ accentColor: "var(--accent-primary)", width: 15, height: 15 }}
                />
                <span style={{ fontSize: 13.5, color: "var(--text-secondary)" }}>启用 denoise</span>
              </label>
            </div>
          </div>

          <div className="controlRow">
            <Button
              variant="primary"
              size="lg"
              disabled={!currentProject?.id || isRunning || !currentProject?.script?.segments?.length}
              onClick={handleStart}
            >
              {isRunning ? "合成中..." : "▶ 开始合成"}
            </Button>
            {isRunning && (
              <Button variant="danger" icon={Square} onClick={cancelSynthesis}>
                停止
              </Button>
            )}
            <span className="muted" style={{ marginLeft: "auto" }}>
              {currentProject ? currentProject.name : "未选择项目"}
            </span>
          </div>
          {error && <div className="errorText">⚠ {error}</div>}
        </GlassCard>

        <GlassCard>
          <h2 className="cardTitle">任务状态</h2>
          {staleReport && (staleReport.stale_count > 0 || staleReport.missing_count > 0) ? (
            <div className="statusBadge warning" style={{ marginBottom: 8 }}>
              共 {staleReport.total} 段，其中已修改 {staleSummary.modified} 段，配置变化 {staleSummary.config} 段，缺失 {staleSummary.missing} 段
            </div>
          ) : null}
          <div className="listStack">
            <div className="statRow"><span>状态</span><strong>{modelStatus || status}</strong></div>
            <div className="statRow"><span>连接</span><strong>{connectionStatus}</strong></div>
            <div className="statRow">
              <span>进度</span>
              <strong style={{ fontFamily: "monospace" }}>{progress.current}&thinsp;/&thinsp;{progress.total || totalSegments}</strong>
            </div>
            <div className="statRow"><span>Task ID</span><strong style={{ fontFamily: "monospace", fontSize: 11 }}>{taskId || "—"}</strong></div>
          </div>
          {lastSyncError ? <div className="errorText">⚠ {lastSyncError}</div> : null}
          {(isRunning || status !== "idle") && (
            <Progress value={progressPct} color={status === "done" ? "success" : status === "error" ? "danger" : "primary"} />
          )}
          {fullAudioUrl && (
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <a className="downloadLink" href={fullAudioUrl} target="_blank" rel="noreferrer">
                <Download size={14} />
                下载完整音频
              </a>
              {subtitleSrtUrl ? (
                <a className="downloadLink" href={subtitleSrtUrl} target="_blank" rel="noreferrer">
                  下载 SRT
                </a>
              ) : null}
              {subtitleLrcUrl ? (
                <a className="downloadLink" href={subtitleLrcUrl} target="_blank" rel="noreferrer">
                  下载 LRC
                </a>
              ) : null}
              {currentProject?.id ? (
                <a
                  className="downloadLink"
                  href={`${API_ORIGIN}/api/v1/tts/export/${currentProject.id}/archive`}
                  target="_blank"
                  rel="noreferrer"
                >
                  下载完整工程 ZIP
                </a>
              ) : null}
            </div>
          )}
          <div className="controlRow" style={{ marginTop: 10 }}>
            <Button variant="secondary" size="sm" icon={Upload} onClick={() => archiveInputRef.current?.click()}>
              导入工程 ZIP
            </Button>
            <input
              ref={archiveInputRef}
              type="file"
              accept=".zip,application/zip"
              style={{ display: "none" }}
              onChange={handleImportArchive}
            />
          </div>
          {importWarnings?.length ? (
            <div className="statusBadge warning" style={{ marginTop: 10, display: "block", textAlign: "left" }}>
              {importWarnings.map((warning, idx) => (
                <div key={`${idx}-${warning}`}>导入提示 {idx + 1}: {warning}</div>
              ))}
            </div>
          ) : null}
        </GlassCard>
      </div>

      {/* Full audio player */}
      {fullAudioUrl && (
        <GlassCard>
          <h2 className="cardTitle">完整音频</h2>
          <SynthesisWaveSurfer 
            projectId={currentProject?.id}
            audioUrl={fullAudioUrl} 
            segments={segments} 
            gapDurationMs={Number(config.gap_duration_ms || 500)}
            height={80} 
          />
        </GlassCard>
      )}

      {/* Segment timeline */}
      <GlassCard className="fullWidthCard">
        <h2 className="cardTitle">分段时间线</h2>
        {selectedSegmentIds.length ? (
          <div className="controlRow" style={{ marginBottom: 10 }}>
            <span className="muted">已选 {selectedSegmentIds.length} 段</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRegenerateSelected}
              disabled={isRunning}
            >
              重新生成已选段落
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedSegmentIds([])} disabled={isRunning}>
              清空选择
            </Button>
          </div>
        ) : null}
        {staleTargetIds.length ? (
          <div className="controlRow" style={{ marginBottom: 10 }}>
            <span className="muted">检测到 {staleTargetIds.length} 段需要更新</span>
            <Button
              variant="secondary"
              size="sm"
              disabled={isRunning}
              onClick={() => setSelectedSegmentIds(recommendedRegenerateIds.length ? recommendedRegenerateIds : staleTargetIds)}
            >
              选择段落重新生成
            </Button>
          </div>
        ) : null}
        {segments.length ? (
          <div className="synthesisTimeline">
            {segments.map((seg) => {
              const segStatus = seg.display_status ?? seg.status ?? "pending";
              const selected = selectedSegmentIds.includes(seg.segment_id);
              const staleItem = staleItemBySegmentId[seg.segment_id];
              const staleLabel = getSegmentStaleLabel(staleItem);
              const staleTone = staleItem?.status === "ready" ? "success" : "warning";
              const isEditing = editingSegmentId === seg.segment_id;
              const canPlaySegment = Boolean(seg.audio_url) && segStatus !== "missing";
              return (
                <div
                  key={seg.segment_id}
                  className={`synthSegmentRow ${STATUS_ROW_CLS[segStatus] ?? "pending"} ${recentlyUpdatedSegmentId === seg.segment_id ? "updated" : ""}`}
                  style={{
                    ...(currentSegmentId === seg.segment_id ? { borderColor: "var(--accent-primary)" } : {}),
                    ...(isEditing ? { alignItems: "flex-start", flexWrap: "wrap" } : {}),
                  }}
                >
                  <label className="controlRow" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={isRunning}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setSelectedSegmentIds((ids) => {
                          if (checked) {
                            return ids.includes(seg.segment_id) ? ids : [...ids, seg.segment_id];
                          }
                          return ids.filter((id) => id !== seg.segment_id);
                        });
                      }}
                    />
                  </label>
                  <div className="synthSegmentMeta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 11, minWidth: 24 }}>
                      #{(seg.index ?? 0) + 1}
                    </span>
                    <CharacterBadge name={seg.speaker} showDot />
                    {segStatus === "done" && segmentTimings[seg.segment_id] && (
                      <span style={{ 
                        color: "var(--text-muted)", 
                        fontFamily: "'JetBrains Mono', monospace", 
                        fontSize: 11,
                        background: "var(--bg-elevated)",
                        padding: "2px 6px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-subtle)"
                      }}>
                        {formatTimeMs(segmentTimings[seg.segment_id].start)} - {formatTimeMs(segmentTimings[seg.segment_id].end)}
                      </span>
                    )}
                    {staleLabel ? <span className={`statusBadge ${staleTone}`}>{staleLabel}</span> : null}
                  </div>

                  {isEditing ? (
                    <div style={{ minWidth: 420, maxWidth: 760, flex: "1 1 560px" }}>
                      <SegmentEditorFields
                        draft={segmentDraft}
                        includeAdvanced
                        onFieldChange={(field, value) =>
                          setSegmentDraft((draft) => ({ ...(draft || {}), [field]: value }))
                        }
                      />
                    </div>
                  ) : (
                    <p
                      className="synthProgressBar"
                      style={{
                        fontSize: 12.5,
                        color: "var(--text-secondary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: 260,
                      }}
                    >
                      {seg.text}
                    </p>
                  )}

                  {canPlaySegment && (
                    <div style={{ width: 200, flexShrink: 0 }}>
                      <AudioPlayer
                        audioUrl={`${API_ORIGIN}${seg.audio_url}`}
                        peaks={seg.peaks}
                        peaksUrl={seg.peaks_url}
                        height={32}
                        compact
                      />
                    </div>
                  )}
                  {canPlaySegment && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Play}
                      onClick={async () => {
                        const ok = await playFrom(seg.segment_id);
                        if (!ok) {
                          useUiStore.getState().pushToast({ title: "连续播放启动失败，请重试。", tone: "error" });
                        }
                      }}
                    >
                      从此处连播
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isRunning}
                    onClick={() => handleSingleSegmentSynthesis(seg.segment_id)}
                  >
                    重新生成
                  </Button>
                  {isEditing ? (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        icon={Save}
                        disabled={isRunning || isScriptSaving || !segmentDraft?.text?.trim()}
                        onClick={() => saveEditedSegment(seg)}
                      >
                        保存
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={X}
                        disabled={isRunning || isScriptSaving}
                        onClick={cancelEditSegment}
                      >
                        取消
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Pencil}
                      disabled={isRunning}
                      onClick={() => beginEditSegment(seg)}
                    >
                      编辑
                    </Button>
                  )}

                  <span className="synthStatus">{STATUS_ICON[segStatus] ?? "⬜"}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            title="还没有分段结果"
            description="点击「开始合成」后每段音频完成时会在此显示"
          />
        )}
        {isAutoPlay ? (
          <div className="controlRow" style={{ marginTop: 12 }}>
            <span className="muted">连续播放进行中</span>
            <Button variant="danger" size="sm" onClick={stop}>停止连续播放</Button>
          </div>
        ) : null}
      </GlassCard>
    </div>
  );
}
