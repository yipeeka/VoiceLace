import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Combine, FileDown, GripVertical, Pencil, Plus, Redo2, Save, Scissors, Settings2, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CharacterBadge, { getCharColor } from "../components/shared/CharacterBadge";
import EmptyState from "../components/shared/EmptyState";
import GlassCard from "../components/shared/GlassCard";
import WaveSurferAudioPlayer from "../components/shared/WaveSurferAudioPlayer";
import ScriptBatchToolsDrawer from "../components/script/ScriptBatchToolsDrawer";
import ScriptDiffPreviewDialog from "../components/script/ScriptDiffPreviewDialog";
import SegmentEditorFields from "../components/script/SegmentEditorFields";
import ScriptSidebarColumn from "../components/script/ScriptSidebarColumn";
import Button from "../components/ui/Button";
import { useProjectStore } from "../stores/useProjectStore";
import { useScriptStore } from "../stores/useScriptStore";
import { useUiStore } from "../stores/useUiStore";
import { API_BASE_URL } from "../utils/api";
import { formatError } from "../utils/errors";
import { buildProjectFilePayload, saveProjectFile } from "../utils/projectFile";
import {
  buildSegmentEditorDraft,
  createSegmentDraft,
  normalizeSegmentFromEditorDraft,
} from "../utils/segmentEditorState";
import {
  deleteSelectedSegments,
  getSegmentSelectionMeta,
  mergeSelectedSegments,
  moveSelectedSegmentBlock,
} from "../utils/scriptEditorState";
import { applySegmentSelectionClick, buildCharacterStats, buildSpeakerOptions, filterSegmentsBySpeaker, getInsertAnchorLabel } from "../utils/scriptSidebar";
import { hasEditingDraftChanges } from "../utils/scriptEditorDirty";
import { computeScriptDiff, normalizeDraftScript } from "../utils/scriptDiff";
import { buildSegmentTimingCheck, getSegmentDurationMismatch } from "../utils/segmentTiming";

const QC_FOCUS_SEGMENTS_KEY = "beautyvoice.qc.focus_segments";
const QC_FOCUS_SEGMENT_LEGACY_KEY = "beautyvoice.qc.focus_segment_id";

function normalizeQcSeverity(value) {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "";
}

function qcSeverityRank(value) {
  if (value === "high") return 3;
  if (value === "medium") return 2;
  if (value === "low") return 1;
  return 0;
}

function extractQcIssueSegmentIds(issue) {
  const ids = [];
  const addId = (value) => {
    const normalized = String(value || "").trim();
    if (normalized) {
      ids.push(normalized);
    }
  };

  addId(issue?.segment_id);
  (Array.isArray(issue?.segment_ids) ? issue.segment_ids : []).forEach(addId);
  (Array.isArray(issue?.segments) ? issue.segments : []).forEach((item) => {
    if (typeof item === "string") {
      addId(item);
      return;
    }
    addId(item?.id || item?.segment_id);
  });
  (Array.isArray(issue?.evidence?.items) ? issue.evidence.items : []).forEach((item) => {
    addId(item?.segment_id || item?.id);
  });

  return Array.from(new Set(ids));
}

function buildQcHighlightBySegmentId(issues) {
  const next = {};
  (Array.isArray(issues) ? issues : []).forEach((issue) => {
    const severity = normalizeQcSeverity(issue?.severity) || "low";
    extractQcIssueSegmentIds(issue).forEach((segmentId) => {
      const current = normalizeQcSeverity(next[segmentId]);
      if (!current || qcSeverityRank(severity) > qcSeverityRank(current)) {
        next[segmentId] = severity;
      }
    });
  });
  return next;
}

function getQcHighlightStyle(severity) {
  if (severity === "high") {
    return {
      borderColor: "var(--danger)",
      boxShadow: "0 0 0 2px rgba(248,113,113,0.2)",
      background: "rgba(248,113,113,0.08)",
    };
  }
  if (severity === "medium") {
    return {
      borderColor: "var(--warning)",
      boxShadow: "0 0 0 2px rgba(251,191,36,0.2)",
      background: "rgba(251,191,36,0.08)",
    };
  }
  if (severity === "low") {
    return {
      borderColor: "var(--info)",
      boxShadow: "0 0 0 2px rgba(96,165,250,0.18)",
      background: "rgba(96,165,250,0.06)",
    };
  }
  return null;
}

function formatTimelineMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return "";
  const total = Math.floor(value);
  const hh = Math.floor(total / 3600000);
  const mm = Math.floor((total % 3600000) / 60000);
  const ss = Math.floor((total % 60000) / 1000);
  const mmm = total % 1000;
  const hhText = String(hh).padStart(2, "0");
  const mmText = String(mm).padStart(2, "0");
  const ssText = String(ss).padStart(2, "0");
  const mmmText = String(mmm).padStart(3, "0");
  return `${hhText}:${mmText}:${ssText}.${mmmText}`;
}

function formatSrtTimestamp(ms) {
  return formatTimelineMs(ms).replace(".", ",");
}

function safeDownloadName(value, fallback = "script") {
  const raw = String(value || fallback).trim() || fallback;
  return raw.replace(/[\\/:|*?"<>]/g, "_");
}

function escapeSelectorValue(value) {
  const raw = String(value || "");
  if (globalThis.CSS?.escape) {
    return globalThis.CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function getPreferredScrollBehavior() {
  if (typeof window === "undefined") {
    return "smooth";
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function readScriptSpeakerFilterFromLocation() {
  if (typeof window === "undefined") {
    return "all";
  }
  return new URL(window.location.href).searchParams.get("scriptSpeaker") || "all";
}

function isSegmentCardInteractiveTarget(target) {
  return Boolean(target?.closest?.(
    "button, input, label, select, textarea, a, [role='button'], .dragHandle, .segmentActions, .audioPlayer"
  ));
}

function buildSrtTextFromSegments(segments) {
  const rows = (Array.isArray(segments) ? segments : [])
    .map((segment) => {
      const startMs = Number(segment?.source_start_ms);
      const endMs = Number(segment?.source_end_ms);
      const text = String(segment?.text || "").trim();
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs || !text) {
        return null;
      }
      const speaker = String(segment?.speaker || "").trim();
      return {
        startMs,
        endMs,
        text: speaker ? `${speaker}：${text}` : text,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  return rows
    .map((row, index) => [
      String(index + 1),
      `${formatSrtTimestamp(row.startMs)} --> ${formatSrtTimestamp(row.endMs)}`,
      row.text,
    ].join("\n"))
    .join("\n\n");
}

function SortableSegmentCard({
  segment,
  isEditing,
  isInsertAnchor,
  isSourceActive,
  draft,
  isFocused,
  qcSeverity,
  isDubbingTimelineProject = false,
  speakerOptions,
  canEdit,
  canReorder,
  isSaving,
  onBeginEdit,
  onUpdateDraft,
  onApplyDraft,
  onSplitAtCursor,
  onCancelEdit,
  onMergeWithNext,
  canMergeWithNext,
  onSetInsertAnchor,
  onDelete,
  canSelect,
  isSelected,
  onToggleSelected,
  onLocateSource,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: segment.id,
    disabled: !canReorder || isEditing || isSaving,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const charColor = getCharColor(segment.speaker);
  const qcStyle = getQcHighlightStyle(qcSeverity);
  const qcLabel = qcSeverity === "high" ? "高风险" : qcSeverity === "medium" ? "中风险" : qcSeverity === "low" ? "低风险" : "";
  const sourceStartText = formatTimelineMs(segment?.source_start_ms);
  const sourceEndText = formatTimelineMs(segment?.source_end_ms);
  const hasSourceRange = Boolean(sourceStartText && sourceEndText);
  const sourceDurationSec =
    Number.isFinite(Number(segment?.source_duration_ms)) && Number(segment.source_duration_ms) >= 0
      ? (Number(segment.source_duration_ms) / 1000).toFixed(2)
      : "";
  const speedValue =
    !isDubbingTimelineProject && segment?.tts_overrides && Number.isFinite(Number(segment.tts_overrides.speed))
      ? Number(segment.tts_overrides.speed).toFixed(2)
      : "";
  const durationValue =
    !isDubbingTimelineProject && segment?.tts_overrides && Number.isFinite(Number(segment.tts_overrides.duration))
      ? Number(segment.tts_overrides.duration).toFixed(2)
      : "";
  const durationMismatch = isDubbingTimelineProject ? null : getSegmentDurationMismatch(segment);
  const timelineAdjustment = segment?.timing_check?.timeline_adjustment && typeof segment.timing_check.timeline_adjustment === "object"
    ? segment.timing_check.timeline_adjustment
    : null;

  return (
    <div
      ref={setNodeRef}
      data-segment-id={segment.id}
      style={{
        ...style,
        ...(qcStyle || {}),
        ...(isSourceActive ? { outline: "2px solid color-mix(in srgb, var(--accent-primary) 72%, transparent)", outlineOffset: "-2px" } : {}),
        ...(isFocused ? { outline: "1px solid var(--accent-primary)", outlineOffset: "-1px" } : {}),
      }}
      className={`segmentCard ${isEditing ? "editing" : ""} ${isSelected ? "selected" : ""} ${durationMismatch?.isMismatch ? "durationMismatch" : ""} ${onLocateSource && hasSourceRange ? "sourceLinked" : ""} ${isInsertAnchor ? "insertAnchor" : ""} ${isSourceActive ? "sourceActive" : ""} ${qcSeverity ? `qc-${qcSeverity}` : ""}`}
      onClick={(event) => {
        if (isEditing || !onLocateSource || !hasSourceRange || isSegmentCardInteractiveTarget(event.target)) {
          return;
        }
        onLocateSource(segment);
      }}
    >
      {(canEdit || canSelect) && !isEditing ? (
        <div className="segmentControlRail">
          {canEdit ? (
            <button
              type="button"
              className={`dragHandle ${canReorder ? "" : "disabled"}`}
              disabled={!canReorder}
              title={canReorder ? "拖拽调整顺序" : "当前筛选状态下暂不支持拖拽排序"}
              aria-label={canReorder ? "拖拽调整顺序" : "当前筛选状态下暂不支持拖拽排序"}
              {...(canReorder ? { ...attributes, ...listeners } : {})}
            >
              <GripVertical aria-hidden="true" focusable="false" size={15} />
            </button>
          ) : null}

          {canSelect ? (
            <label className="segmentSelectControl" title={isSelected ? "取消选择片段" : "选择片段"}>
              <input
                type="checkbox"
                checked={Boolean(isSelected)}
                disabled={isSaving}
                onChange={(event) => onToggleSelected(
                  segment.id,
                  event.target.checked,
                  Boolean(event.shiftKey || event.nativeEvent?.shiftKey)
                )}
                aria-label={`${isSelected ? "取消选择" : "选择"}第 ${(segment.index ?? 0) + 1} 段`}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {/* Color bar */}
      <div className="segmentColorBar" style={{ background: charColor }} />

      {/* Body */}
      <div className="segmentBody">
        {isEditing ? (
          <>
            <SegmentEditorFields
              draft={draft}
              includeAdvanced
              speakerOptions={speakerOptions}
              onFieldChange={(field, value) => onUpdateDraft(segment.id, field, value)}
              onTextCursorChange={(cursor) => onUpdateDraft(segment.id, "__cursor", cursor)}
              textMinHeight={56}
            />
            <div className="controlRow">
              <Button
                variant="primary"
                size="sm"
                disabled={isSaving || !draft?.text?.trim()}
                onClick={() => onApplyDraft(segment.id)}
              >
                {isSaving ? "处理中…" : "应用到草稿"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onCancelEdit(segment.id)}>
                取消
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={Scissors}
                onClick={() => onSplitAtCursor(segment.id)}
                title="按当前光标位置拆分"
              >
                拆分
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="segmentHeader">
              <span className="segmentIndex">#{(segment.index ?? 0) + 1}</span>
              <CharacterBadge name={segment.speaker || "旁白"} />
              {qcLabel ? (
                <span
                  className="statusBadge"
                  style={{
                    fontSize: 10.5,
                    background: qcSeverity === "high"
                      ? "var(--danger-dim)"
                      : qcSeverity === "medium"
                        ? "var(--warning-dim)"
                        : "var(--info-dim)",
                    color: qcSeverity === "high"
                      ? "var(--danger)"
                      : qcSeverity === "medium"
                        ? "var(--warning)"
                        : "var(--info)",
                  }}
                >
                  {qcLabel}
                </span>
              ) : null}
              <span className="segmentType">{segment.type}</span>
              {segment.emotion && segment.emotion !== "neutral" && (
                <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: "var(--radius-full)", background: "var(--bg-elevated)", color: "var(--text-muted)", border: "1px solid var(--border-subtle)" }}>
                  {segment.emotion}
                </span>
              )}
            </div>
            <p className="segmentText">{segment.text}</p>
            {hasSourceRange || sourceDurationSec || speedValue || durationValue ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {hasSourceRange ? `时间轴 ${sourceStartText} -> ${sourceEndText}` : ""}
                {sourceDurationSec ? ` · 目标时长 ${sourceDurationSec}s` : ""}
                {durationValue ? ` · duration ${durationValue}s` : ""}
                {speedValue ? ` · speed ${speedValue}` : ""}
              </div>
            ) : null}
            {durationMismatch?.isMismatch ? (
              <div className="segmentTimingWarning">
                目标时长 {durationMismatch.targetSec.toFixed(2)}s 与 duration {durationMismatch.expectedSec.toFixed(2)}s 差距较大
              </div>
            ) : null}
            {isDubbingTimelineProject && timelineAdjustment?.adjusted ? (
              <div className="segmentTimingWarning">
                时间轴已扩展 {((Number(timelineAdjustment.expanded_before_ms || 0) + Number(timelineAdjustment.expanded_after_ms || 0)) / 1000).toFixed(2)}s
                {Number(timelineAdjustment.insufficient_ms || 0) > 0
                  ? `，仍短 ${(Number(timelineAdjustment.insufficient_ms || 0) / 1000).toFixed(2)}s`
                  : ""}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (
        <div className="segmentActions">
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onBeginEdit(segment)}
            title="编辑"
            aria-label={`编辑第 ${(segment.index ?? 0) + 1} 段`}
          >
            <Pencil aria-hidden="true" focusable="false" size={13} />
          </button>
          <button
            type="button"
            className="btn btn-danger btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onDelete(segment.id)}
            title="删除"
            aria-label={`删除第 ${(segment.index ?? 0) + 1} 段`}
          >
            <Trash2 aria-hidden="true" focusable="false" size={13} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onSetInsertAnchor(segment.id)}
            title="新增片段插入到此段后"
            aria-label={`在第 ${(segment.index ?? 0) + 1} 段后新增片段`}
          >
            <Plus aria-hidden="true" focusable="false" size={13} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving || !canMergeWithNext}
            onClick={() => onMergeWithNext(segment.id)}
            title={canMergeWithNext ? "与下一段合并" : "没有下一段可合并"}
            aria-label={`将第 ${(segment.index ?? 0) + 1} 段与下一段合并`}
          >
            <Combine aria-hidden="true" focusable="false" size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ScriptEditorPage() {
  const {
    currentProject,
    currentProjectFileHandle,
    bindCurrentProjectFile,
    refreshCurrentProject,
    parseQcReport,
    loadProjectParseQc,
  } = useProjectStore();
  const {
    script,
    replaceScript,
    saveScript,
    renameCharacter,
    mergeCharacter,
    batchUpdateSegments,
    searchReplaceSegments,
    splitSegment,
    loadProjectScript,
    isSaving,
    error,
  } = useScriptStore();
  const fileInputRef = useRef(null);
  const lastProjectIdRef = useRef(null);
  const segmentListRef = useRef(null);
  const selectionAnchorSegmentIdRef = useRef(null);
  const qcJumpCursorRef = useRef(-1);

  const [savedScript, setSavedScript] = useState(() => normalizeDraftScript(script));
  const [draftScript, setDraftScript] = useState(() => normalizeDraftScript(script));
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [segmentDraft, setSegmentDraft] = useState(null);
  const [cursorBySegmentId, setCursorBySegmentId] = useState({});
  const [focusSegmentId, setFocusSegmentId] = useState("");
  const [qcHighlightBySegmentId, setQcHighlightBySegmentId] = useState({});
  const [newSegment, setNewSegment] = useState(() => createSegmentDraft(0));
  const [insertAfterSegmentId, setInsertAfterSegmentId] = useState(null);
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState(readScriptSpeakerFilterFromLocation);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState([]);
  const [diffPreviewOpen, setDiffPreviewOpen] = useState(false);
  const [batchToolsOpen, setBatchToolsOpen] = useState(false);
  const [sourceAudioCurrentTime, setSourceAudioCurrentTime] = useState(0);
  const [sourceAudioPlaying, setSourceAudioPlaying] = useState(false);
  const [sourceAudioPlaySignal, setSourceAudioPlaySignal] = useState(0);
  const [sourceAudioPauseSignal, setSourceAudioPauseSignal] = useState(0);
  const [sourceAudioSeekSeconds, setSourceAudioSeekSeconds] = useState(0);
  const [sourceAudioSeekSignal, setSourceAudioSeekSignal] = useState(0);
  const setProjectSaveAction = useUiStore((state) => state.setProjectSaveAction);
  const clearProjectSaveAction = useUiStore((state) => state.clearProjectSaveAction);

  const canEdit = Boolean(currentProject?.id);
  const segments = draftScript?.segments ?? [];
  const scriptDiff = useMemo(
    () => computeScriptDiff(savedScript, draftScript),
    [savedScript, draftScript]
  );
  const editingDraftDirty = useMemo(() => {
    if (!editingId || !segmentDraft) {
      return false;
    }
    const base = (draftScript?.segments || []).find((segment) => segment.id === editingId);
    return hasEditingDraftChanges(base, segmentDraft);
  }, [draftScript?.segments, editingId, segmentDraft]);
  const hasUnsavedChanges = scriptDiff.hasChanges || editingDraftDirty;

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

  useEffect(() => {
    const projectId = currentProject?.id || null;
    const normalized = normalizeDraftScript(script);
    if (lastProjectIdRef.current !== projectId) {
      setSavedScript(normalized);
      resetHistory(normalized);
      setEditingId(null);
      setSegmentDraft(null);
      setCursorBySegmentId({});
      setInsertAfterSegmentId(null);
      setActiveSpeakerFilter("all");
      setSelectedSegmentIds([]);
      selectionAnchorSegmentIdRef.current = null;
      setNewSegment(createSegmentDraft(normalized.segments.length));
      lastProjectIdRef.current = projectId;
      return;
    }
    if (!computeScriptDiff(savedScript, draftScript).hasChanges) {
      setSavedScript(normalized);
      resetHistory(normalized);
      setNewSegment((current) => ({ ...current, index: normalized.segments.length }));
    }
  }, [currentProject?.id, script, resetHistory]);

  useEffect(() => {
    const projectId = currentProject?.id;
    if (!projectId || (script?.segments || []).length) {
      return;
    }
    loadProjectScript(projectId).catch(() => undefined);
  }, [currentProject?.id, loadProjectScript]);

  useEffect(() => {
    const projectId = currentProject?.id;
    if (!projectId) {
      return;
    }
    loadProjectParseQc(projectId).catch(() => undefined);
  }, [currentProject?.id, loadProjectParseQc]);

  useEffect(() => {
    const payloadRaw = window.sessionStorage.getItem(QC_FOCUS_SEGMENTS_KEY) || "";
    const legacyMarker = window.sessionStorage.getItem(QC_FOCUS_SEGMENT_LEGACY_KEY) || "";
    let parsed = null;
    if (payloadRaw) {
      try {
        parsed = JSON.parse(payloadRaw);
      } catch {
        parsed = null;
      }
    }
    window.sessionStorage.removeItem(QC_FOCUS_SEGMENTS_KEY);
    window.sessionStorage.removeItem(QC_FOCUS_SEGMENT_LEGACY_KEY);

    if (parsed && typeof parsed === "object") {
      const mapping = {};
      const rawMap = parsed?.highlight_by_segment_id;
      if (rawMap && typeof rawMap === "object") {
        Object.entries(rawMap).forEach(([segmentId, severity]) => {
          const normalizedId = String(segmentId || "").trim();
          const normalizedSeverity = normalizeQcSeverity(severity);
          if (!normalizedId || !normalizedSeverity) {
            return;
          }
          mapping[normalizedId] = normalizedSeverity;
        });
      }
      setQcHighlightBySegmentId(mapping);
      const focusId = String(parsed?.focus_segment_id || "").trim();
      if (focusId) {
        setFocusSegmentId(focusId);
        return;
      }
      const focusIds = Array.isArray(parsed?.focus_segment_ids) ? parsed.focus_segment_ids : [];
      const firstId = String(focusIds[0] || "").trim();
      setFocusSegmentId(firstId);
      return;
    }

    if (legacyMarker) {
      setFocusSegmentId(legacyMarker);
      return;
    }
    setFocusSegmentId("");
    setQcHighlightBySegmentId({});
  }, [currentProject?.id]);

  // Character stats
  const characters = useMemo(() => buildCharacterStats(segments), [segments]);
  const newSegmentSpeakerOptions = useMemo(
    () => buildSpeakerOptions(characters, { includeCreateOption: true }),
    [characters]
  );
  const segmentSpeakerOptions = useMemo(() => buildSpeakerOptions(characters), [characters]);
  const visibleSegments = useMemo(
    () => filterSegmentsBySpeaker(segments, activeSpeakerFilter),
    [segments, activeSpeakerFilter]
  );
  const visibleSegmentIds = useMemo(() => visibleSegments.map((segment) => segment.id), [visibleSegments]);
  const visibleSegmentIdSet = useMemo(() => new Set(visibleSegmentIds), [visibleSegmentIds]);
  const selectedSegmentIdSet = useMemo(() => new Set(selectedSegmentIds), [selectedSegmentIds]);
  const selectionMeta = useMemo(
    () => getSegmentSelectionMeta(segments, selectedSegmentIds),
    [segments, selectedSegmentIds]
  );
  const selectedCount = selectionMeta.count;
  const hasSourceTimeline = (segments || []).some((segment) => {
    const startMs = Number(segment?.source_start_ms);
    const endMs = Number(segment?.source_end_ms);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  });
  const isDubbingTimelineProject = Boolean(currentProject?.synthesis_config?.timeline_lock_enabled && hasSourceTimeline);
  const canMergeSelection = selectedCount >= 2 && selectionMeta.isContiguous;
  const selectionHint = selectedCount <= 1
    ? "选择多个连续片段后可拖拽移动或合并"
    : selectionMeta.isContiguous
      ? "连续片段可拖拽移动或合并"
      : "移动和合并需要选择连续片段";
  const sourceAudioAsset = currentProject?.audio_assets || {};
  const sourceAudioRelpath = String(sourceAudioAsset?.source_audio_mp3_relpath || "");
  const sourceAudioName = String(sourceAudioAsset?.source_audio_name || "");
  const sourceAudioStartMs = Number.isFinite(Number(sourceAudioAsset?.source_audio_start_ms))
    ? Number(sourceAudioAsset.source_audio_start_ms)
    : 0;
  const sourceAudioEndMs = Number.isFinite(Number(sourceAudioAsset?.source_audio_end_ms))
    ? Number(sourceAudioAsset.source_audio_end_ms)
    : 0;
  const sourceAudioDurationMs = Number.isFinite(Number(sourceAudioAsset?.source_audio_duration_ms))
    ? Number(sourceAudioAsset.source_audio_duration_ms)
    : 0;
  const sourceAudioVersion = encodeURIComponent([
    sourceAudioRelpath,
    sourceAudioName,
    sourceAudioStartMs,
    sourceAudioEndMs,
    sourceAudioDurationMs,
    currentProject?.updated_at || "",
  ].join("|"));
  const sourceAudioUrl = currentProject?.id && sourceAudioRelpath
    ? `${API_BASE_URL}/projects/${currentProject.id}/source-audio?asset=${encodeURIComponent(sourceAudioRelpath)}&v=${sourceAudioVersion}`
    : "";
  const sourceAudioAbsoluteMs = sourceAudioStartMs + Math.max(0, Math.round(Number(sourceAudioCurrentTime || 0) * 1000));
  const sourceActiveSegmentId = useMemo(() => {
    if (!sourceAudioUrl || (!sourceAudioPlaying && !sourceAudioSeekSignal && Number(sourceAudioCurrentTime || 0) <= 0)) {
      return "";
    }
    const active = (segments || [])
      .map((segment) => {
        const startMs = Number(segment?.source_start_ms);
        const endMs = Number(segment?.source_end_ms);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
          return null;
        }
        return { id: segment.id, startMs, endMs };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)
      .find((segment) => sourceAudioAbsoluteMs >= segment.startMs && sourceAudioAbsoluteMs < segment.endMs);
    return active?.id || "";
  }, [segments, sourceAudioAbsoluteMs, sourceAudioCurrentTime, sourceAudioPlaying, sourceAudioSeekSignal, sourceAudioUrl]);
  const reportQcHighlightBySegmentId = useMemo(
    () => buildQcHighlightBySegmentId(parseQcReport?.issues),
    [parseQcReport?.issues]
  );
  const effectiveQcHighlightBySegmentId = useMemo(
    () => ({
      ...reportQcHighlightBySegmentId,
      ...qcHighlightBySegmentId,
    }),
    [reportQcHighlightBySegmentId, qcHighlightBySegmentId]
  );
  const visibleQcHighlightCount = useMemo(
    () => visibleSegments.filter((segment) => effectiveQcHighlightBySegmentId[segment.id]).length,
    [visibleSegments, effectiveQcHighlightBySegmentId]
  );
  const visibleQcHighlightedIds = useMemo(
    () => visibleSegments
      .filter((segment) => effectiveQcHighlightBySegmentId[segment.id])
      .map((segment) => segment.id),
    [visibleSegments, effectiveQcHighlightBySegmentId]
  );
  const timelineSegmentCount = useMemo(
    () => (draftScript?.segments || []).filter((segment) => {
      const startMs = Number(segment?.source_start_ms);
      const endMs = Number(segment?.source_end_ms);
      return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs > startMs && String(segment?.text || "").trim();
    }).length,
    [draftScript?.segments]
  );
  const isFilterActive = activeSpeakerFilter !== "all";
  const insertAfterLabel = useMemo(
    () => getInsertAnchorLabel(segments, insertAfterSegmentId),
    [segments, insertAfterSegmentId]
  );

  useEffect(() => {
    setSelectedSegmentIds((current) => {
      const next = current.filter((id) => visibleSegmentIdSet.has(id));
      return next.length === current.length ? current : next;
    });
    if (selectionAnchorSegmentIdRef.current && !visibleSegmentIdSet.has(selectionAnchorSegmentIdRef.current)) {
      selectionAnchorSegmentIdRef.current = null;
    }
  }, [visibleSegmentIdSet]);

  useEffect(() => {
    if (!focusSegmentId) {
      return;
    }
    const nodes = segmentListRef.current?.querySelectorAll("[data-segment-id]") || document.querySelectorAll("[data-segment-id]");
    for (const node of nodes) {
      if (node?.getAttribute("data-segment-id") === focusSegmentId) {
        node.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: "center" });
        break;
      }
    }
  }, [focusSegmentId, visibleSegments.length]);

  useEffect(() => {
    qcJumpCursorRef.current = -1;
  }, [currentProject?.id, activeSpeakerFilter, visibleQcHighlightedIds.length]);

  useEffect(() => {
    setSourceAudioCurrentTime(0);
    setSourceAudioPlaying(false);
    setSourceAudioSeekSeconds(0);
    setSourceAudioSeekSignal(0);
  }, [sourceAudioUrl]);

  useEffect(() => {
    if (!sourceAudioPlaying || !sourceActiveSegmentId || !segmentListRef.current) {
      return;
    }
    const node = segmentListRef.current.querySelector(`[data-segment-id="${escapeSelectorValue(sourceActiveSegmentId)}"]`);
    if (!node) {
      return;
    }
    const container = segmentListRef.current;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + nodeRect.top - containerRect.top,
      behavior: getPreferredScrollBehavior(),
    });
  }, [sourceActiveSegmentId, sourceAudioPlaying]);

  useEffect(() => {
    if (!sourceAudioUrl) {
      return;
    }
    function isEditableTarget(target) {
      const tagName = String(target?.tagName || "").toLowerCase();
      return tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable);
    }
    function onKeyDown(event) {
      if (event.code !== "Space" || isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
      if (sourceAudioPlaying) {
        setSourceAudioPauseSignal((value) => value + 1);
      } else {
        setSourceAudioPlaySignal((value) => value + 1);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sourceAudioPlaying, sourceAudioUrl]);

  useEffect(() => {
    if (activeSpeakerFilter === "all") {
      return;
    }
    if (!characters.length) {
      return;
    }
    const exists = characters.some((character) => character.name === activeSpeakerFilter);
    if (!exists) {
      setActiveSpeakerFilter("all");
    }
  }, [activeSpeakerFilter, characters]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeSpeakerFilter === "all") {
      url.searchParams.delete("scriptSpeaker");
    } else {
      url.searchParams.set("scriptSpeaker", activeSpeakerFilter);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [activeSpeakerFilter]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function toggleSelectedSegment(segmentId, checked, shiftKey = false) {
    setSelectedSegmentIds((current) => {
      return applySegmentSelectionClick({
        selectedIds: current,
        visibleSegments,
        targetId: segmentId,
        checked,
        shiftKey,
        anchorId: selectionAnchorSegmentIdRef.current,
      });
    });
    selectionAnchorSegmentIdRef.current = segmentId;
  }

  function clearSelectedSegments() {
    setSelectedSegmentIds([]);
    selectionAnchorSegmentIdRef.current = null;
  }

  function handleLocateSourceSegment(segment) {
    if (!sourceAudioUrl) {
      return;
    }
    const startMs = Number(segment?.source_start_ms);
    if (!Number.isFinite(startMs) || startMs < 0) {
      useUiStore.getState().pushToast({
        title: "该片段没有可定位的源音频时间",
        tone: "warning",
      });
      return;
    }
    const seekSeconds = Math.max(0, (startMs - sourceAudioStartMs) / 1000);
    setSourceAudioCurrentTime(seekSeconds);
    setSourceAudioSeekSeconds(seekSeconds);
    setSourceAudioSeekSignal((value) => value + 1);
  }

  function handleDragEnd(event) {
    const { active, over } = event;
    if (isFilterActive) return;
    if (!over || active.id === over.id) return;
    applyDraftMutation((current) => {
      const list = current.segments ?? [];
      if (selectedSegmentIds.includes(active.id) && selectedSegmentIds.length > 1) {
        if (!getSegmentSelectionMeta(list, selectedSegmentIds).isContiguous) {
          useUiStore.getState().pushToast({
            title: "请先选择连续片段后再移动",
            tone: "warning",
          });
          return current;
        }
        return {
          ...current,
          segments: moveSelectedSegmentBlock(list, selectedSegmentIds, over.id),
        };
      }
      const oldIdx = list.findIndex((item) => item.id === active.id);
      const newIdx = list.findIndex((item) => item.id === over.id);
      if (oldIdx < 0 || newIdx < 0 || oldIdx === newIdx) {
        return current;
      }
      const reordered = arrayMove(list, oldIdx, newIdx).map((segment, index) => ({ ...segment, index }));
      return { ...current, segments: reordered };
    });
  }

  function beginEdit(segment) {
    setEditingId(segment.id);
    setSegmentDraft(buildSegmentEditorDraft(segment));
    setSelectedSegmentIds((current) => current.filter((id) => id !== segment.id));
  }

  function cancelEdit(id) {
    setEditingId((current) => (current === id ? null : current));
    setSegmentDraft((current) => (current?.id === id ? null : current));
  }

  function updateDraft(id, field, value) {
    if (field === "__cursor") {
      setCursorBySegmentId((state) => ({ ...state, [id]: Number(value || 0) }));
      return;
    }
    setSegmentDraft((current) => {
      if (!current || current.id !== id) {
        return current;
      }
      return { ...current, [field]: value };
    });
  }

  function applyDraft(id) {
    const draft = segmentDraft;
    if (!draft || draft.id !== id) return;
    const normalized = normalizeSegmentFromEditorDraft(draft);
    if (!normalized.ok) {
      useUiStore.getState().pushToast({
        title: `片段编辑错误：${normalized.error}`,
        tone: "error",
      });
      return;
    }
    const updated = normalized.value;
    applyDraftMutation((current) => ({
      ...current,
      segments: (current.segments || []).map((segment, index) =>
        segment.id === id ? { ...updated, index } : { ...segment, index }
      ),
    }));
    cancelEdit(id);
    useUiStore.getState().pushToast({
      title: "已加入草稿，点击“保存剧本”后生效",
      tone: "default",
    });
  }

  function handleAddSegment() {
    if (!newSegment.text.trim()) return;
    const normalized = normalizeSegmentFromEditorDraft(newSegment);
    if (!normalized.ok) {
      useUiStore.getState().pushToast({
        title: `新增片段错误：${normalized.error}`,
        tone: "error",
      });
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
    setNewSegment(createSegmentDraft(segments.length + 1));
    setInsertAfterSegmentId(null);
    useUiStore.getState().pushToast({
      title: "已加入草稿，点击“保存剧本”后生效",
      tone: "default",
    });
  }

  async function handleDelete(id) {
    const target = (draftScript?.segments || []).find((segment) => segment.id === id);
    const confirmed = await useUiStore.getState().requestConfirm({
      title: "删除片段？",
      description: target?.text
        ? `第 ${(target.index ?? 0) + 1} 段会从当前草稿中移除，保存剧本后生效。`
        : "该片段会从当前草稿中移除，保存剧本后生效。",
      confirmLabel: "删除片段",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    applyDraftMutation((current) => ({
      ...current,
      segments: deleteSelectedSegments(current.segments || [], [id]),
    }));
    setEditingId((current) => (current === id ? null : current));
    setSegmentDraft((current) => (current?.id === id ? null : current));
    setInsertAfterSegmentId((current) => (current === id ? null : current));
    setSelectedSegmentIds((current) => current.filter((segmentId) => segmentId !== id));
    useUiStore.getState().pushToast({
      title: "已加入草稿，点击“保存剧本”后生效",
      tone: "default",
    });
  }

  async function handleDeleteSelectedSegments() {
    if (!selectedCount) return;
    const confirmed = await useUiStore.getState().requestConfirm({
      title: "删除选中片段？",
      description: `将从当前草稿中删除 ${selectedCount} 段，保存剧本后生效。`,
      confirmLabel: "删除选中片段",
      cancelLabel: "取消",
      danger: true,
    });
    if (!confirmed) {
      return;
    }
    const idsToDelete = [...selectedSegmentIds];
    applyDraftMutation((current) => ({
      ...current,
      segments: deleteSelectedSegments(current.segments || [], idsToDelete),
    }));
    setEditingId((current) => (idsToDelete.includes(current) ? null : current));
    setSegmentDraft((current) => (idsToDelete.includes(current?.id) ? null : current));
    setInsertAfterSegmentId((current) => (idsToDelete.includes(current) ? null : current));
    setSelectedSegmentIds([]);
    useUiStore.getState().pushToast({
      title: `已删除 ${idsToDelete.length} 段到草稿`,
      tone: "default",
    });
  }

  async function handleSaveScript() {
    if (!currentProject?.id) return;
    let workingDraftScript = draftScript;
    if (editingId && segmentDraft?.id === editingId) {
      const normalized = normalizeSegmentFromEditorDraft(segmentDraft);
      if (!normalized.ok) {
        useUiStore.getState().pushToast({
          title: `当前编辑片段错误：${normalized.error}`,
          tone: "error",
        });
        return;
      }
      workingDraftScript = {
        ...draftScript,
        segments: (draftScript.segments || []).map((segment, index) =>
          segment.id === editingId ? { ...normalized.value, index } : { ...segment, index }
        ),
      };
    }

    const mergedSegments = (workingDraftScript.segments || []).map((segment, index) => ({
      ...segment,
      index,
      speaker: (segment.speaker || "").trim() || "narrator",
      text: (segment.text || "").trim(),
      type: segment.type || "dialogue",
      emotion: segment.emotion || "neutral",
      non_verbal: Array.isArray(segment.non_verbal) ? segment.non_verbal : [],
      tts_overrides: segment.tts_overrides && typeof segment.tts_overrides === "object" && !Array.isArray(segment.tts_overrides)
        ? segment.tts_overrides
        : {},
      timing_check: buildSegmentTimingCheck(segment),
    }));
    const payload = {
      ...savedScript,
      ...workingDraftScript,
      segments: mergedSegments,
    };
    const updated = await saveScript({ projectId: currentProject.id, script: payload });
    await refreshCurrentProject(currentProject.id);
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    setEditingId(null);
    setSegmentDraft(null);
    setCursorBySegmentId({});
  }

  function handleExportJson() {
    if (!draftScript) return;
    const blob = new Blob([JSON.stringify(draftScript, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(currentProject?.name || "script").replace(/[\\/:|*?"<>]/g, "_")}.script.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    useUiStore.getState().pushToast({ title: "已导出剧本 JSON", tone: "success" });
  }

  function handleExportSrt() {
    const srtText = buildSrtTextFromSegments(draftScript?.segments || []);
    if (!srtText.trim()) {
      useUiStore.getState().pushToast({ title: "当前剧本没有可导出的时间轴片段", tone: "warning" });
      return;
    }
    const blob = new Blob([`${srtText}\n`], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeDownloadName(currentProject?.name || draftScript?.title || "script")}.srt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    useUiStore.getState().pushToast({ title: `已导出 SRT（${timelineSegmentCount} 段）`, tone: "success" });
  }

  const handleSaveProjectFile = useCallback(async (options = {}) => {
    const forceSaveAs = Boolean(options?.forceSaveAs);
    if (!currentProject) {
      return;
    }
    const payload = buildProjectFilePayload({
      project: currentProject,
      script: draftScript || script,
      sourceText: draftScript?.source_text || script?.source_text || "",
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
      useUiStore.getState().pushToast({
        title: forceSaveAs ? "项目文件已另存" : result?.mode === "inplace" ? "项目文件已保存" : "项目文件已导出",
        tone: "success",
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({ title: formatError("保存项目失败", error), tone: "error" });
    }
  }, [currentProject, draftScript, script, currentProjectFileHandle, bindCurrentProjectFile]);

  useEffect(() => {
    setProjectSaveAction(handleSaveProjectFile);
    return () => clearProjectSaveAction();
  }, [setProjectSaveAction, clearProjectSaveAction, handleSaveProjectFile]);

  async function handleImportJson(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !currentProject?.id) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      const updated = await replaceScript({ projectId: currentProject.id, script: imported });
      await refreshCurrentProject(currentProject.id);
      const normalized = normalizeDraftScript(updated);
      setSavedScript(normalized);
      resetHistory(normalized);
      setEditingId(null);
      setSegmentDraft(null);
      setCursorBySegmentId({});
      setNewSegment(createSegmentDraft(normalized.segments.length));
    } catch (err) {
      useUiStore.getState().pushToast({ title: formatError("导入失败", err), tone: "error" });
    }
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

  useEffect(() => {
    if (!hasUnsavedChanges) {
      return undefined;
    }
    function onBeforeUnload(event) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasUnsavedChanges]);

  async function handleGlobalRenameCharacter({ fromName, toName }) {
    if (!currentProject?.id) return;
    if (hasUnsavedChanges) {
      useUiStore.getState().pushToast({ title: "请先保存当前草稿后再执行全局操作", tone: "warning" });
      return;
    }
    if (!fromName || !toName) return;
    const updated = await renameCharacter({ projectId: currentProject.id, fromName, toName });
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    setEditingId(null);
    setSegmentDraft(null);
    await refreshCurrentProject(currentProject.id);
    setBatchToolsOpen(false);
  }

  async function handleGlobalMergeCharacter({ sourceName, targetName }) {
    if (!currentProject?.id) return;
    if (hasUnsavedChanges) {
      useUiStore.getState().pushToast({ title: "请先保存当前草稿后再执行全局操作", tone: "warning" });
      return;
    }
    if (!sourceName || !targetName) return;
    const updated = await mergeCharacter({ projectId: currentProject.id, sourceName, targetName });
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    setEditingId(null);
    setSegmentDraft(null);
    await refreshCurrentProject(currentProject.id);
    setBatchToolsOpen(false);
  }

  async function handleBatchUpdate({ segmentIds = [], emotion = null, type = null } = {}) {
    if (!currentProject?.id) return;
    if (hasUnsavedChanges) {
      useUiStore.getState().pushToast({ title: "请先保存当前草稿后再执行批量操作", tone: "warning" });
      return;
    }
    const targetIds = Array.isArray(segmentIds) && segmentIds.length
      ? segmentIds
      : visibleSegments.map((segment) => segment.id);
    if (!targetIds.length) {
      useUiStore.getState().pushToast({ title: "当前筛选结果没有可批量修改的片段", tone: "warning" });
      return;
    }
    if (!emotion && !type) return;
    const updated = await batchUpdateSegments({
      projectId: currentProject.id,
      segmentIds: targetIds,
      emotion,
      type,
    });
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    await refreshCurrentProject(currentProject.id);
    setBatchToolsOpen(false);
  }

  async function handleSearchReplace({ find, replace, caseSensitive }) {
    if (!currentProject?.id) return;
    if (hasUnsavedChanges) {
      useUiStore.getState().pushToast({ title: "请先保存当前草稿后再执行搜索替换", tone: "warning" });
      return;
    }
    if (!find) return;
    const segmentIds = visibleSegments.map((segment) => segment.id);
    const updated = await searchReplaceSegments({
      projectId: currentProject.id,
      find,
      replace,
      caseSensitive,
      segmentIds,
    });
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    await refreshCurrentProject(currentProject.id);
    setBatchToolsOpen(false);
  }

  async function handleSplitAtCursor(segmentId) {
    if (!currentProject?.id) return;
    if (hasUnsavedChanges) {
      useUiStore.getState().pushToast({ title: "请先保存当前草稿后再执行拆分", tone: "warning" });
      return;
    }
    const cursor = Number(cursorBySegmentId[segmentId] ?? -1);
    if (cursor < 0) {
      useUiStore.getState().pushToast({ title: "请先在片段文本中点击定位光标", tone: "warning" });
      return;
    }
    const updated = await splitSegment({
      projectId: currentProject.id,
      segmentId,
      cursor,
    });
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    setEditingId(null);
    setSegmentDraft(null);
    await refreshCurrentProject(currentProject.id);
  }

  function findNextSegmentId(segmentId) {
    const list = draftScript?.segments || [];
    const index = list.findIndex((segment) => segment.id === segmentId);
    if (index < 0 || index >= list.length - 1) return "";
    return list[index + 1]?.id || "";
  }

  async function handleMergeWithNext(segmentId) {
    const nextSegmentId = findNextSegmentId(segmentId);
    if (!nextSegmentId) return;
    applyDraftMutation((current) => ({
      ...current,
      segments: mergeSelectedSegments(current.segments || [], [segmentId, nextSegmentId]),
    }));
    setEditingId((current) => (current === nextSegmentId ? null : current));
    setSegmentDraft((current) => (current?.id === nextSegmentId ? null : current));
    setInsertAfterSegmentId((current) => (current === nextSegmentId ? null : current));
    setSelectedSegmentIds((current) => current.filter((id) => id !== nextSegmentId));
    useUiStore.getState().pushToast({
      title: "已合并到草稿，点击“保存剧本”后生效",
      tone: "default",
    });
  }

  function handleMergeSelectedSegments() {
    if (!canMergeSelection) {
      useUiStore.getState().pushToast({
        title: "请选择连续的多个片段后再合并",
        tone: "warning",
      });
      return;
    }
    const idsToMerge = [...selectionMeta.selectedIds];
    const firstId = idsToMerge[0];
    applyDraftMutation((current) => ({
      ...current,
      segments: mergeSelectedSegments(current.segments || [], idsToMerge),
    }));
    setEditingId((current) => (idsToMerge.includes(current) && current !== firstId ? null : current));
    setSegmentDraft((current) => (idsToMerge.includes(current?.id) && current?.id !== firstId ? null : current));
    setInsertAfterSegmentId((current) => (idsToMerge.includes(current) ? null : current));
    setSelectedSegmentIds([firstId]);
    useUiStore.getState().pushToast({
      title: `已合并 ${idsToMerge.length} 段到草稿`,
      tone: "default",
    });
  }

  function handleJumpToNextQcHighlight() {
    if (!visibleQcHighlightedIds.length) {
      return;
    }
    qcJumpCursorRef.current = (qcJumpCursorRef.current + 1) % visibleQcHighlightedIds.length;
    const nextId = visibleQcHighlightedIds[qcJumpCursorRef.current];
    setFocusSegmentId(nextId);
    requestAnimationFrame(() => {
      const node = segmentListRef.current?.querySelector(`[data-segment-id="${escapeSelectorValue(nextId)}"]`);
      if (node) {
        node.scrollIntoView({ behavior: getPreferredScrollBehavior(), block: "center" });
      }
    });
  }

  return (
    <div className="pageGrid sidebarLayout">
      {/* Left: character panel */}
      <ScriptSidebarColumn
        characters={characters}
        totalSegments={segments.length}
        activeSpeakerFilter={activeSpeakerFilter}
        onSelectSpeaker={setActiveSpeakerFilter}
        hasUnsavedChanges={hasUnsavedChanges}
        error={error}
        newSegment={newSegment}
        newSegmentSpeakerOptions={newSegmentSpeakerOptions}
        canEdit={canEdit}
        isSaving={isSaving}
        insertAfterLabel={insertAfterLabel}
        onClearInsertAnchor={() => setInsertAfterSegmentId(null)}
        onNewSegmentFieldChange={(field, value) => setNewSegment((current) => ({ ...current, [field]: value }))}
        onAddSegment={handleAddSegment}
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
            <Button variant="primary" icon={Save} onClick={handleSaveScript} disabled={!canEdit || isSaving || !hasUnsavedChanges}>
              {isSaving ? "保存中…" : hasUnsavedChanges ? "保存剧本" : "已保存"}
            </Button>
            <Button variant="secondary" onClick={() => setDiffPreviewOpen(true)} disabled={!hasUnsavedChanges}>
              查看差异
            </Button>
            <Button variant="secondary" icon={Settings2} onClick={() => setBatchToolsOpen(true)} disabled={!canEdit || isSaving}>
              批量工具
            </Button>
            <Button variant="secondary" onClick={handleExportJson} disabled={!script?.segments?.length}>
              导出 JSON
            </Button>
            <Button variant="secondary" icon={FileDown} onClick={handleExportSrt} disabled={!timelineSegmentCount}>
              导出 SRT
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={!canEdit}>
              导入 JSON
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              name="scriptJsonImport"
              aria-label="导入剧本 JSON"
              accept=".json"
              style={{ display: "none" }}
              onChange={handleImportJson}
            />
          </>
        }
      />

      {/* Right: segment list */}
      <GlassCard>
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">片段列表</h2>
            <p className="cardSubtitle">
              {isFilterActive
                ? `当前按角色筛选显示，拖拽排序已暂时关闭。${hasUnsavedChanges ? "（当前有未保存改动）" : "（当前已保存）"}`
                : `拖动左侧手柄可调整顺序，点击内容编辑片段。${hasUnsavedChanges ? "（当前有未保存改动）" : "（当前已保存）"}`}
            </p>
          </div>
          {visibleQcHighlightCount ? (
            <button
              type="button"
              className="statusBadge warning clickableBadge"
              onClick={handleJumpToNextQcHighlight}
              title="点击跳到下一条质检高亮片段"
              aria-label={`跳到下一条质检高亮片段，共 ${visibleQcHighlightCount} 段`}
            >
              质检高亮 {visibleQcHighlightCount} 段
            </button>
          ) : null}
        </div>

        {selectedCount ? (
          <div className="selectionToolbar" aria-live="polite">
            <span className="statusBadge default">已选择 {selectedCount} 段</span>
            <span className={`statusBadge ${selectionMeta.isContiguous ? "success" : "warning"}`}>
              {selectionHint}
            </span>
            <div className="controlRow" style={{ marginLeft: "auto", gap: 8 }}>
              <Button
                variant="danger"
                size="sm"
                icon={Trash2}
                disabled={!canEdit || isSaving}
                onClick={handleDeleteSelectedSegments}
              >
                删除
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={Combine}
                disabled={!canEdit || isSaving || !canMergeSelection}
                onClick={handleMergeSelectedSegments}
                title={canMergeSelection ? "合并选中片段" : "请选择连续的多个片段"}
              >
                合并
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelectedSegments}>
                清除选择
              </Button>
            </div>
          </div>
        ) : null}

        {sourceAudioUrl ? (
          <div className="scriptSourceAudioPanel">
            <div className="scriptSourceAudioMeta">
              <span className="statusBadge">识别原音频</span>
              <span className="muted">
                {formatTimelineMs(sourceAudioStartMs)}
                {sourceAudioEndMs > sourceAudioStartMs ? ` -> ${formatTimelineMs(sourceAudioEndMs)}` : ""}
              </span>
            </div>
            <WaveSurferAudioPlayer
              audioUrl={sourceAudioUrl}
              height={48}
              compact
              fallbackDurationSeconds={sourceAudioDurationMs / 1000}
              autoPlaySignal={sourceAudioPlaySignal}
              pauseSignal={sourceAudioPauseSignal}
              seekToSeconds={sourceAudioSeekSeconds}
              seekSignal={sourceAudioSeekSignal}
              onTimeUpdate={setSourceAudioCurrentTime}
              onPlayStateChange={setSourceAudioPlaying}
            />
          </div>
        ) : null}

        {visibleSegments.length ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={visibleSegments.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="listStack scriptSegmentScrollList" ref={segmentListRef}>
                {visibleSegments.map((segment) => (
                  <SortableSegmentCard
                    key={segment.id}
                    segment={segment}
                    isSourceActive={sourceActiveSegmentId === segment.id}
                    isFocused={focusSegmentId === segment.id}
                    qcSeverity={effectiveQcHighlightBySegmentId[segment.id] || ""}
                    isDubbingTimelineProject={isDubbingTimelineProject}
                    isEditing={editingId === segment.id}
                    isInsertAnchor={insertAfterSegmentId === segment.id}
                    draft={segmentDraft?.id === segment.id ? segmentDraft : null}
                    speakerOptions={segmentSpeakerOptions}
                    canEdit={canEdit}
                    canReorder={!isFilterActive && (!selectedSegmentIdSet.has(segment.id) || selectedCount <= 1 || selectionMeta.isContiguous)}
                    isSaving={isSaving}
                    canSelect={canEdit}
                    isSelected={selectedSegmentIdSet.has(segment.id)}
                    onBeginEdit={beginEdit}
                    onUpdateDraft={updateDraft}
                    onApplyDraft={applyDraft}
                    onSplitAtCursor={handleSplitAtCursor}
                    onCancelEdit={cancelEdit}
                    onMergeWithNext={handleMergeWithNext}
                    canMergeWithNext={Boolean(findNextSegmentId(segment.id))}
                    onSetInsertAnchor={setInsertAfterSegmentId}
                    onDelete={handleDelete}
                    onToggleSelected={toggleSelectedSegment}
                    onLocateSource={sourceAudioUrl ? handleLocateSourceSegment : null}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : segments.length ? (
          <EmptyState
            title="该角色暂无段落"
            description="点击左侧“总计”可恢复查看全部片段"
          />
        ) : (
          <EmptyState
            title="还没有剧本片段"
            description="先在「文本输入」页完成 LLM 解析，或手动添加片段"
          />
        )}
      </GlassCard>
      <ScriptBatchToolsDrawer
        open={batchToolsOpen}
        onOpenChange={setBatchToolsOpen}
        characters={characters}
        visibleSegments={visibleSegments}
        activeSpeakerFilter={activeSpeakerFilter}
        canExecute={canEdit && !hasUnsavedChanges}
        isSaving={isSaving}
        onRenameCharacter={handleGlobalRenameCharacter}
        onMergeCharacter={handleGlobalMergeCharacter}
        onBatchUpdate={handleBatchUpdate}
        onSearchReplace={handleSearchReplace}
      />
      <ScriptDiffPreviewDialog open={diffPreviewOpen} onOpenChange={setDiffPreviewOpen} diff={scriptDiff} />
    </div>
  );
}
