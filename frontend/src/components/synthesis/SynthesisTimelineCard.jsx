import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useRef } from "react";

import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import SegmentTimelineRow from "./SegmentTimelineRow";
import { applySegmentSelectionClick } from "../../utils/scriptSidebar";

export default function SynthesisTimelineCard({
  API_ORIGIN,
  sensors,
  canReorderTimeline,
  onTimelineDragEnd,
  segments,
  totalVisibleSegments,
  activeSpeakerFilter,
  activeStatusFilter,
  statusCounts,
  onStatusFilterChange,
  shouldShowSegmentTimeline,
  selectedSegmentIds,
  setSelectedSegmentIds,
  staleTargetIds,
  recommendedRegenerateIds,
  isRunning,
  handleRegenerateSelected,
  canRebuildFullAudio,
  fullAudioRebuildRequired,
  fullAudioRebuildHint,
  handleRebuildFullAudio,
  staleItemBySegmentId,
  getSegmentStaleLabel,
  segmentTimings,
  formatTimeMs,
  currentSegmentId,
  recentlyUpdatedSegmentId,
  editingSegmentId,
  segmentDraft,
  setSegmentDraft,
  isScriptSaving,
  beginEditSegment,
  cancelEditSegment,
  saveEditedSegment,
  handleSingleSegmentSynthesis,
  handleDeleteSegment,
  setInsertAfterSegmentId,
  insertAfterSegmentId,
  onLocateFullAudioSegment,
  playFrom,
  isAutoPlay,
  stop,
  pushToast,
}) {
  const timelineRef = useRef(null);
  const selectionAnchorSegmentIdRef = useRef(null);
  const speakerOptions = [
    { value: "narrator", label: "narrator" },
    ...Array.from(new Set((segments || []).map((segment) => (segment.speaker || "").trim()).filter(Boolean)))
      .filter((name) => name !== "narrator")
      .map((name) => ({ value: name, label: name })),
  ];

  useEffect(() => {
    if (!currentSegmentId || !timelineRef.current) {
      return;
    }
    const container = timelineRef.current;
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(currentSegmentId)
      : String(currentSegmentId).replace(/"/g, '\\"');
    const row = container.querySelector(`[data-segment-id="${escapedId}"]`);
    if (!row) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const targetTop = rowRect.top - containerRect.top + container.scrollTop;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
  }, [currentSegmentId, segments]);

  useEffect(() => {
    const visibleIds = new Set((segments || []).map((segment) => segment.segment_id).filter(Boolean));
    if (selectionAnchorSegmentIdRef.current && !visibleIds.has(selectionAnchorSegmentIdRef.current)) {
      selectionAnchorSegmentIdRef.current = null;
    }
  }, [segments]);

  function handleClearSelectedSegments() {
    setSelectedSegmentIds([]);
    selectionAnchorSegmentIdRef.current = null;
  }

  function handleToggleSegmentSelected(segmentId, checked, shiftKey = false) {
    setSelectedSegmentIds((ids) => applySegmentSelectionClick({
      selectedIds: ids,
      visibleSegments: segments,
      targetId: segmentId,
      checked,
      shiftKey,
      anchorId: selectionAnchorSegmentIdRef.current,
    }));
    selectionAnchorSegmentIdRef.current = segmentId;
  }

  return (
    <GlassCard>
      <h2 className="cardTitle">
        分段时间线
        {totalVisibleSegments ? (
          <span className="muted">
            当前显示 {totalVisibleSegments} 段{activeSpeakerFilter !== "all" ? "（已按角色筛选）" : ""}
          </span>
        ) : null}
      </h2>
      {totalVisibleSegments && activeSpeakerFilter !== "all" ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className="muted">筛选状态下暂不支持拖拽排序</span>
        </div>
      ) : null}
      <div className="controlRow" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <span className="muted">状态筛选</span>
        <Button
          variant={activeStatusFilter === "all" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("all")}
        >
          全部 {statusCounts?.all ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "stale" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("stale")}
        >
          待修音 {statusCounts?.stale ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "done" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("done")}
        >
          已合成 {statusCounts?.done ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "missing" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("missing")}
        >
          缺音频 {statusCounts?.missing ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "failed" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("failed")}
        >
          失败 {statusCounts?.failed ?? 0}
        </Button>
      </div>
      {selectedSegmentIds.length ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className="muted">已选 {selectedSegmentIds.length} 段</span>
          <Button variant="secondary" size="sm" onClick={() => handleRegenerateSelected()} disabled={isRunning}>
            重新生成已选段落
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClearSelectedSegments} disabled={isRunning}>
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
            onClick={async () => {
              const ids = recommendedRegenerateIds.length ? recommendedRegenerateIds : staleTargetIds;
              setSelectedSegmentIds(ids);
              selectionAnchorSegmentIdRef.current = ids[0] || null;
              await handleRegenerateSelected(ids);
            }}
          >
            需更新段落重新生成
          </Button>
        </div>
      ) : null}
      {segments.length ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className={`statusBadge ${fullAudioRebuildRequired ? "warning" : "success"}`}>
            {fullAudioRebuildRequired ? "完整音频待重组" : "完整音频已同步"}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canRebuildFullAudio}
            onClick={handleRebuildFullAudio}
          >
            重组音频
          </Button>
          <span className="muted">{fullAudioRebuildHint}</span>
        </div>
      ) : null}
      {isAutoPlay ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className="muted">连续播放进行中</span>
          <Button variant="danger" size="sm" onClick={stop}>
            停止连续播放
          </Button>
        </div>
      ) : null}
      {segments.length && shouldShowSegmentTimeline ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTimelineDragEnd}>
          <SortableContext items={segments.map((seg) => seg.segment_id)} strategy={verticalListSortingStrategy}>
            <div className="synthesisTimeline" ref={timelineRef}>
              {segments.map((seg) => {
                const selected = selectedSegmentIds.includes(seg.segment_id);
                const staleItem = staleItemBySegmentId[seg.segment_id];
                const staleLabel = getSegmentStaleLabel(staleItem);
                const isEditing = editingSegmentId === seg.segment_id;
                return (
                  <SegmentTimelineRow
                    key={seg.segment_id}
                    API_ORIGIN={API_ORIGIN}
                    seg={seg}
                    canReorder={canReorderTimeline}
                    isRunning={isRunning}
                    selected={selected}
                    onToggleSelected={(checked, shiftKey) => handleToggleSegmentSelected(seg.segment_id, checked, shiftKey)}
                    staleItem={staleItem}
                    staleLabel={staleLabel}
                    segmentTiming={segmentTimings[seg.segment_id]}
                    formatTimeMs={formatTimeMs}
                    currentSegmentId={currentSegmentId}
                    recentlyUpdatedSegmentId={recentlyUpdatedSegmentId}
                    isEditing={isEditing}
                    isInsertAnchor={insertAfterSegmentId === seg.segment_id}
                    segmentDraft={segmentDraft}
                    speakerOptions={speakerOptions}
                    setSegmentDraft={setSegmentDraft}
                    isScriptSaving={isScriptSaving}
                    beginEditSegment={beginEditSegment}
                    cancelEditSegment={cancelEditSegment}
                    saveEditedSegment={saveEditedSegment}
                    handleSingleSegmentSynthesis={handleSingleSegmentSynthesis}
                    handleDeleteSegment={handleDeleteSegment}
                    setInsertAfterSegmentId={setInsertAfterSegmentId}
                    onLocateFullAudioSegment={onLocateFullAudioSegment}
                    playFrom={playFrom}
                    pushToast={pushToast}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : activeSpeakerFilter !== "all" ? (
        <EmptyState title="该角色暂无段落" description="切换角色或点击“总计”可查看其他段落。" />
      ) : shouldShowSegmentTimeline ? (
        <EmptyState title="还没有分段结果" description="点击「开始合成」后每段音频完成时会在此显示" />
      ) : (
        <EmptyState title="缺失音频文件" description="当前项目尚未生成任何分段音频，请先执行合成后再查看分段时间线。" />
      )}
    </GlassCard>
  );
}
