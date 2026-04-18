import { Pencil, Play, Save, X } from "lucide-react";

import SegmentEditorFields from "../script/SegmentEditorFields";
import CharacterBadge from "../shared/CharacterBadge";
import AudioPlayer from "../shared/AudioPlayer";
import Button from "../ui/Button";

const STATUS_ICON = { done: "✅", running: "⏳", pending: "⬜", error: "❌", skipped: "⏭", stale: "🟨", missing: "⚠" };
const STATUS_ROW_CLS = { done: "done", running: "running", pending: "pending", error: "error", stale: "stale", missing: "missing" };

export default function SegmentTimelineRow({
  API_ORIGIN,
  seg,
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
  segmentDraft,
  setSegmentDraft,
  isScriptSaving,
  beginEditSegment,
  cancelEditSegment,
  saveEditedSegment,
  handleSingleSegmentSynthesis,
  playFrom,
  pushToast,
}) {
  const segStatus = seg.display_status ?? seg.status ?? "pending";
  const staleTone = staleItem?.status === "ready" ? "success" : "warning";
  const canPlaySegment = Boolean(seg.audio_url) && segStatus !== "missing";

  return (
    <div
      className={`synthSegmentRow ${STATUS_ROW_CLS[segStatus] ?? "pending"} ${recentlyUpdatedSegmentId === seg.segment_id ? "updated" : ""}`}
      style={{
        ...(currentSegmentId === seg.segment_id ? { borderColor: "var(--accent-primary)" } : {}),
        ...(isEditing ? { alignItems: "flex-start", flexWrap: "wrap" } : {}),
      }}
    >
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
      </div>

      {isEditing ? (
        <div style={{ minWidth: 420, maxWidth: 760, flex: "1 1 560px" }}>
          <SegmentEditorFields
            draft={segmentDraft}
            includeAdvanced
            onFieldChange={(field, value) => setSegmentDraft((draft) => ({ ...(draft || {}), [field]: value }))}
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
          <AudioPlayer audioUrl={`${API_ORIGIN}${seg.audio_url}`} peaks={seg.peaks} peaksUrl={seg.peaks_url} height={32} compact />
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
              pushToast({ title: "连续播放启动失败，请重试。", tone: "error" });
            }
          }}
        >
          从此处连播
        </Button>
      )}
      <Button variant="secondary" size="sm" disabled={isRunning} onClick={() => handleSingleSegmentSynthesis(seg.segment_id)}>
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
          <Button variant="ghost" size="sm" icon={X} disabled={isRunning || isScriptSaving} onClick={cancelEditSegment}>
            取消
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" icon={Pencil} disabled={isRunning} onClick={() => beginEditSegment(seg)}>
          编辑
        </Button>
      )}

      <span className="synthStatus">{STATUS_ICON[segStatus] ?? "⬜"}</span>
    </div>
  );
}
