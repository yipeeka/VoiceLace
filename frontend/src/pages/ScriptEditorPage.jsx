import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Combine, FileDown, GripVertical, Pencil, Plus, Redo2, Save, Scissors, Settings2, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import CharacterBadge, { getCharColor } from "../components/shared/CharacterBadge";
import AudioPlayer from "../components/shared/AudioPlayer";
import EmptyState from "../components/shared/EmptyState";
import GlassCard from "../components/shared/GlassCard";
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
import { buildSegmentEditorDraft, createSegmentDraft, normalizeSegmentFromEditorDraft } from "../utils/segmentEditorState";
import { buildCharacterStats, buildSpeakerOptions, filterSegmentsBySpeaker, getInsertAnchorLabel } from "../utils/scriptSidebar";
import { hasEditingDraftChanges } from "../utils/scriptEditorDirty";
import { computeScriptDiff, normalizeDraftScript } from "../utils/scriptDiff";
import { useI18n } from "../i18n/I18nProvider";

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
}) {
  const { t } = useI18n();
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
  const qcLabel = qcSeverity === "high" ? t("script.qc.highRisk") : qcSeverity === "medium" ? t("script.qc.mediumRisk") : qcSeverity === "low" ? t("script.qc.lowRisk") : "";
  const sourceStartText = formatTimelineMs(segment?.source_start_ms);
  const sourceEndText = formatTimelineMs(segment?.source_end_ms);
  const hasSourceRange = Boolean(sourceStartText && sourceEndText);
  const sourceDurationSec =
    Number.isFinite(Number(segment?.source_duration_ms)) && Number(segment.source_duration_ms) >= 0
      ? (Number(segment.source_duration_ms) / 1000).toFixed(2)
      : "";
  const speedValue =
    segment?.tts_overrides && Number.isFinite(Number(segment.tts_overrides.speed))
      ? Number(segment.tts_overrides.speed).toFixed(2)
      : "";
  const durationValue =
    segment?.tts_overrides && Number.isFinite(Number(segment.tts_overrides.duration))
      ? Number(segment.tts_overrides.duration).toFixed(2)
      : "";

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
      className={`segmentCard ${isEditing ? "editing" : ""} ${isInsertAnchor ? "insertAnchor" : ""} ${isSourceActive ? "sourceActive" : ""} ${qcSeverity ? `qc-${qcSeverity}` : ""}`}
    >
      {/* Drag handle */}
      {canEdit && !isEditing && (
        <div
          className={`dragHandle ${canReorder ? "" : "disabled"}`}
          title={canReorder ? t("script.action.dragSort") : t("script.action.dragSortDisabled")}
          aria-label={canReorder ? t("script.action.dragSort") : t("script.action.dragSortDisabled")}
          {...(canReorder ? { ...attributes, ...listeners } : {})}
        >
          <GripVertical size={15} />
        </div>
      )}

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
                {isSaving ? t("script.applying") : t("script.applyToDraft")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => onCancelEdit(segment.id)}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSplitAtCursor(segment.id)}
                title={t("script.action.splitAtCursor")}
              >
                <Scissors size={13} />
                {t("script.action.split")}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="segmentHeader">
              <span className="segmentIndex">#{(segment.index ?? 0) + 1}</span>
              <CharacterBadge name={segment.speaker || t("script.narrator")} />
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
                {hasSourceRange ? `${t("script.timeline")} ${sourceStartText} -> ${sourceEndText}` : ""}
                {sourceDurationSec ? ` · ${t("script.targetDuration")} ${sourceDurationSec}s` : ""}
                {durationValue ? ` · duration ${durationValue}s` : ""}
                {speedValue ? ` · speed ${speedValue}` : ""}
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Actions */}
      {!isEditing && (
        <div className="segmentActions">
          <button
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onBeginEdit(segment)}
            title={t("common.edit")}
          >
            <Pencil size={13} />
          </button>
          <button
            className="btn btn-danger btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onDelete(segment.id)}
            title={t("common.delete")}
          >
            <Trash2 size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving}
            onClick={() => onSetInsertAnchor(segment.id)}
            title={t("script.action.insertAfter")}
          >
            <Plus size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm btn-icon"
            disabled={!canEdit || isSaving || !canMergeWithNext}
            onClick={() => onMergeWithNext(segment.id)}
            title={canMergeWithNext ? t("script.action.mergeWithNext") : t("script.action.noNextToMerge")}
          >
            <Combine size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ScriptEditorPage() {
  const { t } = useI18n();
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
    mergeSegments,
    loadProjectScript,
    isSaving,
    error,
  } = useScriptStore();
  const fileInputRef = useRef(null);
  const lastProjectIdRef = useRef(null);
  const segmentListRef = useRef(null);
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
  const [activeSpeakerFilter, setActiveSpeakerFilter] = useState("all");
  const [diffPreviewOpen, setDiffPreviewOpen] = useState(false);
  const [batchToolsOpen, setBatchToolsOpen] = useState(false);
  const [sourceAudioCurrentTime, setSourceAudioCurrentTime] = useState(0);
  const [sourceAudioPlaying, setSourceAudioPlaying] = useState(false);
  const [sourceAudioPlaySignal, setSourceAudioPlaySignal] = useState(0);
  const [sourceAudioPauseSignal, setSourceAudioPauseSignal] = useState(0);
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
  const sourceAudioAsset = currentProject?.audio_assets || {};
  const sourceAudioRelpath = String(sourceAudioAsset?.source_audio_mp3_relpath || "");
  const sourceAudioStartMs = Number.isFinite(Number(sourceAudioAsset?.source_audio_start_ms))
    ? Number(sourceAudioAsset.source_audio_start_ms)
    : 0;
  const sourceAudioEndMs = Number.isFinite(Number(sourceAudioAsset?.source_audio_end_ms))
    ? Number(sourceAudioAsset.source_audio_end_ms)
    : 0;
  const sourceAudioUrl = currentProject?.id && sourceAudioRelpath
    ? `${API_BASE_URL}/projects/${currentProject.id}/source-audio?asset=${encodeURIComponent(sourceAudioRelpath)}`
    : "";
  const sourceAudioAbsoluteMs = sourceAudioStartMs + Math.max(0, Math.round(Number(sourceAudioCurrentTime || 0) * 1000));
  const sourceActiveSegmentId = useMemo(() => {
    if (!sourceAudioUrl || !sourceAudioPlaying) {
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
  }, [segments, sourceAudioAbsoluteMs, sourceAudioPlaying, sourceAudioUrl]);
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
    if (!focusSegmentId) {
      return;
    }
    const nodes = segmentListRef.current?.querySelectorAll("[data-segment-id]") || document.querySelectorAll("[data-segment-id]");
    for (const node of nodes) {
      if (node?.getAttribute("data-segment-id") === focusSegmentId) {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
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
      behavior: "smooth",
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
    const exists = characters.some((character) => character.name === activeSpeakerFilter);
    if (!exists) {
      setActiveSpeakerFilter("all");
    }
  }, [activeSpeakerFilter, characters]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (isFilterActive) return;
    if (!over || active.id === over.id) return;
    applyDraftMutation((current) => {
      const list = current.segments ?? [];
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
        title: t("synth.toast.ttsOverridesInvalid", { error: normalized.error }),
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
      title: t("synth.toast.addedToDraft"),
      tone: "default",
    });
  }

  function handleAddSegment() {
    if (!newSegment.text.trim()) return;
    const normalized = normalizeSegmentFromEditorDraft(newSegment);
    if (!normalized.ok) {
      useUiStore.getState().pushToast({
        title: t("synth.toast.newSegmentTtsInvalid", { error: normalized.error }),
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
      title: t("synth.toast.addedToDraft"),
      tone: "default",
    });
  }

  function handleDelete(id) {
    applyDraftMutation((current) => ({
      ...current,
      segments: (current.segments || [])
        .filter((segment) => segment.id !== id)
        .map((segment, index) => ({ ...segment, index })),
    }));
    setEditingId((current) => (current === id ? null : current));
    setSegmentDraft((current) => (current?.id === id ? null : current));
    setInsertAfterSegmentId((current) => (current === id ? null : current));
    useUiStore.getState().pushToast({
      title: t("synth.toast.addedToDraft"),
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
          title: t("synth.toast.currentSegmentTtsInvalid", { error: normalized.error }),
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
    useUiStore.getState().pushToast({ title: t("script.toast.exportJson"), tone: "success" });
  }

  function handleExportSrt() {
    const srtText = buildSrtTextFromSegments(draftScript?.segments || []);
    if (!srtText.trim()) {
      useUiStore.getState().pushToast({ title: t("script.toast.noTimelineForSrt"), tone: "warning" });
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
    useUiStore.getState().pushToast({ title: t("script.toast.exportSrt", { count: timelineSegmentCount }), tone: "success" });
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
        title: forceSaveAs ? t("text.toast.projectSavedAs") : result?.mode === "inplace" ? t("text.toast.projectSaved") : t("text.toast.projectExported"),
        tone: "success",
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      useUiStore.getState().pushToast({ title: formatError(t("script.toast.saveProjectFailedTitle"), error), tone: "error" });
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
      useUiStore.getState().pushToast({ title: formatError(t("script.toast.importFailedTitle"), err), tone: "error" });
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

  async function handleGlobalRenameCharacter({ fromName, toName }) {
    if (!currentProject?.id) return;
    if (hasUnsavedChanges) {
      useUiStore.getState().pushToast({ title: t("script.toast.saveDraftBeforeGlobal"), tone: "warning" });
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
      useUiStore.getState().pushToast({ title: t("script.toast.saveDraftBeforeGlobal"), tone: "warning" });
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
      useUiStore.getState().pushToast({ title: t("script.toast.saveDraftBeforeBatch"), tone: "warning" });
      return;
    }
    const targetIds = Array.isArray(segmentIds) && segmentIds.length
      ? segmentIds
      : visibleSegments.map((segment) => segment.id);
    if (!targetIds.length) {
      useUiStore.getState().pushToast({ title: t("script.toast.noSegmentsForBatch"), tone: "warning" });
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
      useUiStore.getState().pushToast({ title: t("script.toast.saveDraftBeforeSearchReplace"), tone: "warning" });
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
      useUiStore.getState().pushToast({ title: t("script.toast.saveDraftBeforeSplit"), tone: "warning" });
      return;
    }
    const cursor = Number(cursorBySegmentId[segmentId] ?? -1);
    if (cursor < 0) {
      useUiStore.getState().pushToast({ title: t("script.toast.placeCursorFirst"), tone: "warning" });
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
    if (!currentProject?.id) return;
    if (hasUnsavedChanges) {
      useUiStore.getState().pushToast({ title: t("script.toast.saveDraftBeforeMerge"), tone: "warning" });
      return;
    }
    const nextSegmentId = findNextSegmentId(segmentId);
    if (!nextSegmentId) return;
    const updated = await mergeSegments({
      projectId: currentProject.id,
      firstSegmentId: segmentId,
      secondSegmentId: nextSegmentId,
    });
    const normalized = normalizeDraftScript(updated);
    setSavedScript(normalized);
    resetHistory(normalized);
    setEditingId(null);
    setSegmentDraft(null);
    await refreshCurrentProject(currentProject.id);
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
        node.scrollIntoView({ behavior: "smooth", block: "center" });
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
              <Button variant="ghost" onClick={handleUndo} disabled={!undoStack.length}>
                <Undo2 size={14} />
                {t("script.undo")}
              </Button>
              <Button variant="ghost" onClick={handleRedo} disabled={!redoStack.length}>
                <Redo2 size={14} />
                {t("script.redo")}
              </Button>
            </div>
            <Button variant="primary" onClick={handleSaveScript} disabled={!canEdit || isSaving || !hasUnsavedChanges}>
              <Save size={14} />
              {isSaving ? t("synth.saving") : hasUnsavedChanges ? t("synth.saveScript") : t("synth.saved")}
            </Button>
            <Button variant="secondary" onClick={() => setDiffPreviewOpen(true)} disabled={!hasUnsavedChanges}>
              {t("synth.viewDiff")}
            </Button>
            <Button variant="secondary" onClick={() => setBatchToolsOpen(true)} disabled={!canEdit || isSaving}>
              <Settings2 size={14} />
              {t("script.batchTools")}
            </Button>
            <Button variant="secondary" onClick={handleExportJson} disabled={!script?.segments?.length}>
              {t("script.exportJson")}
            </Button>
            <Button variant="secondary" onClick={handleExportSrt} disabled={!timelineSegmentCount}>
              <FileDown size={14} />
              {t("script.exportSrt")}
            </Button>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={!canEdit}>
              {t("script.importJson")}
            </Button>
            <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportJson} />
          </>
        }
      />

      {/* Right: segment list */}
      <GlassCard>
        <div className="sectionHeader">
          <div className="sectionHeaderLeft">
            <h2 className="cardTitle">{t("script.segmentList")}</h2>
            <p className="cardSubtitle">
              {isFilterActive
                ? t("script.subtitle.filtered", {
                  state: hasUnsavedChanges ? t("script.subtitle.unsaved") : t("script.subtitle.saved"),
                })
                : t("script.subtitle.default", {
                  state: hasUnsavedChanges ? t("script.subtitle.unsaved") : t("script.subtitle.saved"),
                })}
            </p>
          </div>
          {visibleQcHighlightCount ? (
            <button
              type="button"
              className="statusBadge warning clickableBadge"
              onClick={handleJumpToNextQcHighlight}
              title={t("script.qc.jumpNext")}
            >
              {t("script.qcHighlightCount", { count: visibleQcHighlightCount })}
            </button>
          ) : null}
        </div>

        {sourceAudioUrl ? (
          <div className="scriptSourceAudioPanel">
            <div className="scriptSourceAudioMeta">
              <span className="statusBadge">{t("script.sourceAudio")}</span>
              <span className="muted">
                {formatTimelineMs(sourceAudioStartMs)}
                {sourceAudioEndMs > sourceAudioStartMs ? ` -> ${formatTimelineMs(sourceAudioEndMs)}` : ""}
              </span>
            </div>
            <AudioPlayer
              audioUrl={sourceAudioUrl}
              height={48}
              compact
              autoPlaySignal={sourceAudioPlaySignal}
              pauseSignal={sourceAudioPauseSignal}
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
                    isEditing={editingId === segment.id}
                    isInsertAnchor={insertAfterSegmentId === segment.id}
                    draft={segmentDraft?.id === segment.id ? segmentDraft : null}
                    speakerOptions={segmentSpeakerOptions}
                    canEdit={canEdit}
                    canReorder={!isFilterActive}
                    isSaving={isSaving}
                    onBeginEdit={beginEdit}
                    onUpdateDraft={updateDraft}
                    onApplyDraft={applyDraft}
                    onSplitAtCursor={handleSplitAtCursor}
                    onCancelEdit={cancelEdit}
                    onMergeWithNext={handleMergeWithNext}
                    canMergeWithNext={Boolean(findNextSegmentId(segment.id))}
                    onSetInsertAnchor={setInsertAfterSegmentId}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : segments.length ? (
          <EmptyState
            title={t("script.empty.noSegmentsForSpeaker")}
            description={t("script.empty.noSegmentsForSpeakerDesc")}
          />
        ) : (
          <EmptyState
            title={t("script.empty.noSegments")}
            description={t("script.empty.noSegmentsDesc")}
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
