import { MoreHorizontal, Pencil, Play, Plus, RefreshCw, Save, Trash2, X, GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import SegmentEditorFields from "../script/SegmentEditorFields";
import CharacterBadge from "../shared/CharacterBadge";
import AudioPlayer from "../shared/AudioPlayer";
import Button from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";

const STATUS_ICON = { done: "✅", running: "⏳", pending: "⬜", error: "❌", skipped: "⏭", stale: "🟨", missing: "⚠", failed: "❌" };
const STATUS_ROW_CLS = { done: "done", running: "running", pending: "pending", error: "error", stale: "stale", missing: "missing", failed: "error" };

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
  handleSingleSegmentSynthesis,
  handleDeleteSegment,
  setInsertAfterSegmentId,
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
        className={`synthSegmentRow ${STATUS_ROW_CLS[segStatus] ?? "pending"} ${actionsOpen ? "actionsOpen" : ""} ${recentlyUpdatedSegmentId === seg.segment_id ? "updated" : ""}`}
        style={{
          transform: CSS.Transform.toString(transform),
          transition,
          opacity: isDragging ? 0.6 : 1,
          ...(currentSegmentId === seg.segment_id ? { borderColor: "var(--accent-primary)" } : {}),
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
          onChange={(e) => onToggleSelected(e.target.checked)}
        />
      </label>
      <span className="synthSegmentIndex">#{(seg.index ?? 0) + 1}</span>
      <div className="synthSegmentMeta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <div className="synthSegmentSpeakerStack">
          <div className="synthSegmentSpeakerRow">
            <CharacterBadge name={seg.speaker} showDot />
          </div>
          {segStatus === "done" && segmentTiming && (
            <span className="synthSegmentTimeBadge">
              {formatTimeMs(segmentTiming.start)} - {formatTimeMs(segmentTiming.end)}
            </span>
          )}
        </div>
      </div>
      {staleLabel || seg.draft_status === "unsaved" ? (
        <div className="synthSegmentStateBadges">
          {staleLabel ? <span className={`statusBadge ${staleTone}`}>{staleLabel}</span> : null}
          {seg.draft_status === "unsaved" ? <span className="statusBadge warning">未保存改动</span> : null}
        </div>
      ) : null}

      {isEditing ? (
        <div style={{ minWidth: 420, maxWidth: 760, flex: "1 1 560px" }}>
          <SegmentEditorFields
            draft={segmentDraft}
            includeAdvanced
            speakerOptions={speakerOptions}
            onFieldChange={(field, value) => setSegmentDraft((draft) => ({ ...(draft || {}), [field]: value }))}
          />
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
      {isEditing ? (
        <>
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
        </>
      ) : (
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
