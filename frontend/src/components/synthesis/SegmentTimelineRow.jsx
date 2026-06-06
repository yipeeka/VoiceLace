import { MoreHorizontal, Pencil, Play, Plus, RefreshCw, Save, Scissors, Trash2, X, GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import SegmentEditorFields from "../script/SegmentEditorFields";
import CharacterBadge from "../shared/CharacterBadge";
import AudioPlayer from "../shared/AudioPlayer";
import Button from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { getStoredSegmentDurationMismatch } from "../../utils/segmentTiming";

const STATUS_ICON = { done: "✅", running: "⏳", pending: "⬜", error: "❌", skipped: "⏭", stale: "🟨", missing: "⚠", failed: "❌" };
const STATUS_ROW_CLS = { done: "done", running: "running", pending: "pending", error: "error", stale: "stale", missing: "missing", failed: "error" };
const STATUS_LABELS = {
  done: "已同步",
  running: "生成中",
  pending: "待生成",
  skipped: "已跳过",
  stale: "需处理",
  missing: "缺失",
  failed: "失败",
  error: "失败",
};

function formatSourceTimelineMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatCompactDurationMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
}

function isInteractiveRowTarget(target) {
  return Boolean(target?.closest?.(
    "button, input, label, select, textarea, a, [role='button'], [role='slider'], .dragHandle, .audioPlayer, .synthSegmentActions"
  ));
}

export default function SegmentTimelineRow({
  API_ORIGIN,
  seg,
  canReorder,
  isRunning,
  selected,
  onToggleSelected,
  staleItem,
  staleLabel,
  segmentTiming,
  formatTimeMs,
  currentSegmentId,
  recentlyUpdatedSegmentId,
  isEditing,
  isInsertAnchor,
  segmentDraft,
  speakerOptions,
  setSegmentDraft,
  isScriptSaving,
  beginEditSegment,
  cancelEditSegment,
  saveEditedSegment,
  onSegmentCursorChange,
  onSplitAtCursor,
  handleSingleSegmentSynthesis,
  handleDeleteSegment,
  setInsertAfterSegmentId,
  onLocateFullAudioSegment,
  insertPickMode = false,
  onPickInsertAfter,
  playFrom,
  pushToast,
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const actionsRef = useRef(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seg.segment_id,
    disabled: !canReorder || isEditing || isRunning,
  });
  const segStatus = seg.display_status ?? seg.status ?? "pending";
  const staleTone = staleItem?.status === "ready" ? "success" : "warning";
  const canPlaySegment = Boolean(seg.audio_url) && segStatus !== "missing" && segStatus !== "failed";
  const durationMismatch = getStoredSegmentDurationMismatch(seg);
  const canLocateFullAudio = Boolean(
    segmentTiming &&
    Number.isFinite(Number(segmentTiming.start)) &&
    Number(segmentTiming.start) >= 0 &&
    typeof onLocateFullAudioSegment === "function"
  );
  const sourceStartMs = Number(seg?.source_start_ms);
  const sourceEndMs = Number(seg?.source_end_ms);
  const hasSourceTimeline = Number.isFinite(sourceStartMs) && Number.isFinite(sourceEndMs) && sourceStartMs >= 0 && sourceEndMs > sourceStartMs;
  const timingStartMs = Number(segmentTiming?.start);
  const timingEndMs = Number(segmentTiming?.end);
  const hasPlaybackTiming = Number.isFinite(timingStartMs) && Number.isFinite(timingEndMs) && timingEndMs > timingStartMs;
  const startTimeText = hasSourceTimeline
    ? formatSourceTimelineMs(sourceStartMs)
    : hasPlaybackTiming
      ? formatSourceTimelineMs(timingStartMs)
      : "";
  const durationMs = hasSourceTimeline
    ? sourceEndMs - sourceStartMs
    : hasPlaybackTiming
      ? timingEndMs - timingStartMs
      : Number(seg?.duration_ms || 0);
  const durationText = formatCompactDurationMs(durationMs);
  const primaryStatusLabel = STATUS_LABELS[segStatus] || segStatus;
  const secondaryStaleLabel = staleLabel && staleLabel !== primaryStatusLabel ? staleLabel : "";

  useEffect(() => {
    if (!actionsOpen) return undefined;
    const handlePointerDown = (event) => {
      if (actionsRef.current?.contains(event.target)) return;
      setActionsOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setActionsOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionsOpen]);

  const closeActions = () => setActionsOpen(false);

  return (
    <>
      <div
        ref={setNodeRef}
        data-segment-id={seg.segment_id}
        className={`synthSegmentRow ${STATUS_ROW_CLS[segStatus] ?? "pending"} ${currentSegmentId === seg.segment_id ? "active" : ""} ${durationMismatch?.isMismatch ? "durationMismatch" : ""} ${canLocateFullAudio ? "audioLinked" : ""} ${insertPickMode ? "insertPickMode" : ""} ${isEditing ? "editing" : ""} ${actionsOpen ? "actionsOpen" : ""} ${recentlyUpdatedSegmentId === seg.segment_id ? "updated" : ""}`}
        onClick={(event) => {
          if (insertPickMode && !isInteractiveRowTarget(event.target)) {
            onPickInsertAfter?.(seg);
            return;
          }
          if (isEditing || !canLocateFullAudio || isInteractiveRowTarget(event.target)) {
            return;
          }
          onLocateFullAudioSegment(seg);
        }}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.6 : 1,
          ...(isInsertAnchor ? { borderColor: "var(--accent-secondary)" } : {}),
          ...(isEditing ? { alignItems: "flex-start", flexWrap: "wrap" } : {}),
        }}
      >
      {!isEditing ? (
        <div
          className={`dragHandle ${canReorder && !isRunning ? "" : "disabled"}`}
          title={canReorder ? "拖拽调整顺序" : "当前筛选状态下暂不支持拖拽排序"}
          aria-label={canReorder ? "拖拽调整顺序" : "当前筛选状态下暂不支持拖拽排序"}
          {...(canReorder && !isRunning ? { ...attributes, ...listeners } : {})}
        >
          <GripVertical size={15} />
        </div>
      ) : null}
      <label className="controlRow" style={{ gap: 6 }}>
        <input
          type="checkbox"
          aria-label={`选择第 ${(seg.index ?? 0) + 1} 段`}
          checked={selected}
          disabled={isRunning}
          onChange={(event) => onToggleSelected(
            event.target.checked,
            Boolean(event.shiftKey || event.nativeEvent?.shiftKey)
          )}
        />
      </label>
      <span className="synthSegmentIndex">#{(seg.index ?? 0) + 1}</span>
      {startTimeText ? (
        <span className="synthSegmentStartCell">{startTimeText}</span>
      ) : (
        <span className="synthSegmentStartCell muted">--</span>
      )}
      {durationText ? (
        <span className="synthSegmentDurationCell">{durationText}</span>
      ) : (
        <span className="synthSegmentDurationCell muted">--</span>
      )}
      <div className="synthSegmentMeta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <div className="synthSegmentSpeakerStack">
          <div className="synthSegmentSpeakerRow">
            <CharacterBadge name={seg.speaker} showDot />
          </div>
        </div>
      </div>
      <div className="synthSegmentStateBadges">
          <span className={`statusBadge ${segStatus === "done" ? "success" : segStatus === "failed" || segStatus === "error" || segStatus === "missing" ? "danger" : "warning"}`}>
            {primaryStatusLabel}
          </span>
          {secondaryStaleLabel ? <span className={`statusBadge ${staleTone}`}>{secondaryStaleLabel}</span> : null}
          {seg.draft_status === "unsaved" ? <span className="statusBadge warning">未保存改动</span> : null}
          {durationMismatch?.isMismatch ? (
            <span
              className="statusBadge warning"
              title={`剧本预检：目标时长 ${durationMismatch.targetSec.toFixed(2)}s，duration ${durationMismatch.expectedSec.toFixed(2)}s`}
            >
              可能差距过大
            </span>
          ) : null}
      </div>

      {isEditing ? (
        <div className="synthSegmentEditorPanel">
          <SegmentEditorFields
            draft={segmentDraft}
            includeAdvanced
            speakerOptions={speakerOptions}
            onFieldChange={(field, value) => setSegmentDraft((draft) => ({ ...(draft || {}), [field]: value }))}
            onTextCursorChange={(cursor) => onSegmentCursorChange?.(seg.segment_id, cursor)}
            textMinHeight={60}
          />
          <div className="controlRow synthSegmentEditorActions">
            <Button
              variant="primary"
              size="sm"
              icon={Save}
              disabled={isRunning || isScriptSaving || !segmentDraft?.text?.trim()}
              onClick={() => saveEditedSegment(seg)}
            >
              应用到草稿
            </Button>
            <Button variant="ghost" size="sm" icon={X} disabled={isRunning || isScriptSaving} onClick={cancelEditSegment}>
              取消
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={Scissors}
              disabled={isRunning || isScriptSaving}
              onClick={() => onSplitAtCursor?.(seg.segment_id)}
              title="按当前光标位置拆分"
            >
              拆分
            </Button>
          </div>
        </div>
      ) : (
        <div className="synthSegmentTextCell">
          <p
            className="synthProgressBar synthSegmentText"
            title={seg.text}
            style={{ marginBottom: seg.error ? 4 : 0 }}
          >
            {seg.text}
          </p>
          {seg.error ? (
            <div className="synthSegmentError">
              {seg.error}
            </div>
          ) : null}
        </div>
      )}

      {canPlaySegment && (
        <div className="synthSegmentAudioCell">
          <AudioPlayer audioUrl={`${API_ORIGIN}${seg.audio_url}`} peaks={seg.peaks} peaksUrl={seg.peaks_url} height={32} compact showTime={false} />
        </div>
      )}
      {!canPlaySegment && <div className="synthSegmentAudioCell synthSegmentAudioEmpty">--</div>}
      <span className={`synthSegmentDrift ${durationMismatch?.isMismatch ? "warn" : "ok"}`}>
        {durationMismatch?.isMismatch
          ? `${durationMismatch.direction === "target_shorter" ? "+" : "-"}${Math.round(Number(durationMismatch.diffSec || 0) * 1000)}ms`
          : segStatus === "done" ? "0ms" : "--"}
      </span>
      {isEditing ? null : (
        <div className="synthSegmentActions" ref={actionsRef}>
          <Button
            variant="ghost"
            size="sm"
            icon={MoreHorizontal}
            className="synthSegmentActionsTrigger"
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={actionsOpen}
            onClick={() => setActionsOpen((open) => !open)}
          />
          <div className={`synthSegmentActionIcons ${actionsOpen ? "open" : ""}`} role="menu">
            {canPlaySegment && (
              <Button
                variant="ghost"
                size="sm"
                icon={Play}
                title="从此处连播"
                aria-label="从此处连播"
                onClick={async () => {
                  closeActions();
                  const ok = await playFrom(seg.segment_id, seg.audio_url);
                  if (!ok) {
                    pushToast({ title: "连续播放启动失败，请重试。", tone: "error" });
                  }
                }}
              />
            )}
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              title="重新生成"
              aria-label="重新生成"
              disabled={isRunning}
              onClick={() => {
                closeActions();
                handleSingleSegmentSynthesis(seg.segment_id);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              title="编辑"
              aria-label="编辑"
              disabled={isRunning}
              onClick={() => {
                closeActions();
                beginEditSegment(seg);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={Trash2}
              title="删除"
              aria-label="删除"
              disabled={isRunning}
              onClick={() => {
                closeActions();
                setDeleteConfirmOpen(true);
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              icon={Plus}
              title="设为插入点"
              aria-label="设为插入点"
              disabled={isRunning}
              onClick={() => {
                closeActions();
                setInsertAfterSegmentId(seg.segment_id);
              }}
            />
          </div>
        </div>
      )}

        <span className="synthStatus">{STATUS_ICON[segStatus] ?? "⬜"}</span>
      </div>
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`删除第 ${(seg.index ?? 0) + 1} 段？`}
        description="删除会加入草稿，保存剧本后生效。"
        confirmLabel="删除片段"
        danger
        onConfirm={() => handleDeleteSegment(seg.segment_id)}
      />
    </>
  );
}
