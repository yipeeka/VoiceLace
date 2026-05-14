import { Pencil, Play, Plus, RefreshCw, Save, Trash2, X, GripVertical } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import SegmentEditorFields from "../script/SegmentEditorFields";
import CharacterBadge from "../shared/CharacterBadge";
import AudioPlayer from "../shared/AudioPlayer";
import Button from "../ui/Button";

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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: seg.segment_id,
    disabled: !canReorder || isEditing || isRunning,
  });
  const segStatus = seg.display_status ?? seg.status ?? "pending";
  const staleTone = staleItem?.status === "ready" ? "success" : "warning";
  const canPlaySegment = Boolean(seg.audio_url) && segStatus !== "missing" && segStatus !== "failed";

  return (
    <div
      ref={setNodeRef}
      data-segment-id={seg.segment_id}
      className={`synthSegmentRow ${STATUS_ROW_CLS[segStatus] ?? "pending"} ${recentlyUpdatedSegmentId === seg.segment_id ? "updated" : ""}`}
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
        <input type="checkbox" checked={selected} disabled={isRunning} onChange={(e) => onToggleSelected(e.target.checked)} />
      </label>
      <div className="synthSegmentMeta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--text-muted)", fontFamily: "monospace", fontSize: 11, minWidth: 24 }}>#{(seg.index ?? 0) + 1}</span>
        <CharacterBadge name={seg.speaker} showDot />
        {segStatus === "done" && segmentTiming && (
          <span
            style={{
              color: "var(--text-muted)",
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 11,
              background: "var(--bg-elevated)",
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {formatTimeMs(segmentTiming.start)} - {formatTimeMs(segmentTiming.end)}
          </span>
        )}
        {staleLabel ? <span className={`statusBadge ${staleTone}`}>{staleLabel}</span> : null}
        {seg.draft_status === "unsaved" ? <span className="statusBadge warning">未保存改动</span> : null}
      </div>

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
        <div style={{ minWidth: 220, maxWidth: 300 }}>
          <p
            className="synthProgressBar"
            style={{
              fontSize: 12.5,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 260,
              marginBottom: seg.error ? 4 : 0,
            }}
          >
            {seg.text}
          </p>
          {seg.error ? (
            <div style={{ fontSize: 11, color: "var(--danger)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {seg.error}
            </div>
          ) : null}
        </div>
      )}

      {canPlaySegment && (
        <div style={{ width: 200, flexShrink: 0 }}>
          <AudioPlayer audioUrl={`${API_ORIGIN}${seg.audio_url}`} peaks={seg.peaks} peaksUrl={seg.peaks_url} height={32} compact />
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
        <div className="synthSegmentActionIcons">
          {canPlaySegment && (
            <Button
              variant="ghost"
              size="sm"
              icon={Play}
              title="从此处连播"
              aria-label="从此处连播"
              onClick={async () => {
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
            onClick={() => handleSingleSegmentSynthesis(seg.segment_id)}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Pencil}
            title="编辑"
            aria-label="编辑"
            disabled={isRunning}
            onClick={() => beginEditSegment(seg)}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            title="删除"
            aria-label="删除"
            disabled={isRunning}
            onClick={() => handleDeleteSegment(seg.segment_id)}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            title="设为插入点"
            aria-label="设为插入点"
            disabled={isRunning}
            onClick={() => setInsertAfterSegmentId(seg.segment_id)}
          />
        </div>
      )}

      <span className="synthStatus">{STATUS_ICON[segStatus] ?? "⬜"}</span>
    </div>
  );
}
