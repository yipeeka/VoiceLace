import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, Search, Settings, SlidersHorizontal, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import CharacterBadge from "../shared/CharacterBadge";
import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import SegmentTimelineRow from "./SegmentTimelineRow";
import { applySegmentSelectionClick } from "../../utils/scriptSidebar";

const DEFAULT_VISIBLE_COLUMNS = {
  index: true,
  start: true,
  duration: true,
  speaker: true,
  status: true,
  text: true,
  audio: true,
  drift: true,
  actions: true,
};

const DATA_COLUMNS = [
  { key: "index", label: "#", width: "42px" },
  { key: "start", label: "开始时间", width: "86px" },
  { key: "duration", label: "时长", width: "64px" },
  { key: "speaker", label: "说话人", width: "104px" },
  { key: "status", label: "状态", width: "78px" },
  { key: "text", label: "文本（点击编辑）", width: "minmax(240px, 1fr)" },
  { key: "audio", label: "音频", width: "132px" },
  { key: "drift", label: "差值", width: "52px" },
  { key: "actions", label: "操作", width: "54px" },
];

function buildSegmentSearchBlob(segment) {
  return [
    segment.text,
    segment.speaker,
    segment.type,
    segment.emotion,
    segment.status,
    segment.display_status,
    segment.workflow_status,
    segment.segment_id,
    segment.index != null ? `#${Number(segment.index) + 1}` : "",
    segment.tts_overrides ? JSON.stringify(segment.tts_overrides) : "",
  ].filter(Boolean).join(" ").toLowerCase();
}

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
  characters = [],
  totalSegments = 0,
  onSelectSpeaker,
  hasUnsavedChanges = false,
  actionContent = null,
  scriptError = "",
  onRequestInsertSegment,
  insertPickMode = false,
  onCancelInsertPick,
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
  onSegmentCursorChange,
  onSplitAtCursor,
  handleSingleSegmentSynthesis,
  handleDeleteSegment,
  setInsertAfterSegmentId,
  insertAfterSegmentId,
  onLocateFullAudioSegment,
  playFrom,
  isAutoPlay,
  stop,
  pushToast,
  className = "",
}) {
  const timelineRef = useRef(null);
  const selectionAnchorSegmentIdRef = useRef(null);
  const lastAutoScrollSegmentIdRef = useRef("");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilterPanel, setShowFilterPanel] = useState(true);
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(DEFAULT_VISIBLE_COLUMNS);
  const speakerOptions = [
    { value: "narrator", label: "narrator" },
    ...Array.from(new Set((segments || []).map((segment) => (segment.speaker || "").trim()).filter(Boolean)))
      .filter((name) => name !== "narrator")
      .map((name) => ({ value: name, label: name })),
  ];
  const columnTemplate = useMemo(() => [
    "24px",
    "30px",
    ...DATA_COLUMNS.filter((column) => visibleColumns[column.key]).map((column) => column.width),
  ].join(" "), [visibleColumns]);
  const visibleDataColumns = useMemo(
    () => DATA_COLUMNS.filter((column) => visibleColumns[column.key]),
    [visibleColumns],
  );
  const searchedSegments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return segments;
    }
    return segments.filter((segment) => buildSegmentSearchBlob(segment).includes(query));
  }, [searchQuery, segments]);
  const displaySegments = useMemo(() => {
    if (!showSelectedOnly || !selectedSegmentIds.length) {
      return searchedSegments;
    }
    const selectedSet = new Set(selectedSegmentIds);
    return searchedSegments.filter((segment) => selectedSet.has(segment.segment_id));
  }, [searchedSegments, selectedSegmentIds, showSelectedOnly]);

  useEffect(() => {
    if (!currentSegmentId || !timelineRef.current) {
      return;
    }
    if (!lastAutoScrollSegmentIdRef.current) {
      lastAutoScrollSegmentIdRef.current = currentSegmentId;
      return;
    }
    if (lastAutoScrollSegmentIdRef.current === currentSegmentId) {
      return;
    }
    lastAutoScrollSegmentIdRef.current = currentSegmentId;
    const container = timelineRef.current;
    const escapedId = typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(currentSegmentId)
      : String(currentSegmentId).replace(/"/g, '\\"');
    const row = container.querySelector(`[data-segment-id="${escapedId}"]`);
    if (!row) {
      return;
    }
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentSegmentId]);

  useEffect(() => {
    const visibleIds = new Set((displaySegments || []).map((segment) => segment.segment_id).filter(Boolean));
    if (selectionAnchorSegmentIdRef.current && !visibleIds.has(selectionAnchorSegmentIdRef.current)) {
      selectionAnchorSegmentIdRef.current = null;
    }
  }, [displaySegments]);

  useEffect(() => {
    if (!selectedSegmentIds.length && showSelectedOnly) {
      setShowSelectedOnly(false);
    }
  }, [selectedSegmentIds.length, showSelectedOnly]);

  function handleClearSelectedSegments() {
    setSelectedSegmentIds([]);
    selectionAnchorSegmentIdRef.current = null;
  }

  function handleToggleSegmentSelected(segmentId, checked, shiftKey = false) {
    setSelectedSegmentIds((ids) => applySegmentSelectionClick({
      selectedIds: ids,
      visibleSegments: displaySegments,
      targetId: segmentId,
      checked,
      shiftKey,
      anchorId: selectionAnchorSegmentIdRef.current,
    }));
    selectionAnchorSegmentIdRef.current = segmentId;
  }

  function handlePickInsertAfter(segment) {
    onRequestInsertSegment?.(segment.segment_id);
  }

  return (
    <GlassCard className={className}>
      <div className="segmentCommandHeader">
        <div className="segmentStatusToolbar">
          {[
            ["all", "全部"],
            ["missing", "待生成"],
            ["stale", "需处理"],
            ["done", "已完成"],
            ["failed", "失败"],
          ].map(([value, label]) => (
            <Button
              key={value}
              variant={activeStatusFilter === value ? "primary" : "ghost"}
              size="sm"
              onClick={() => onStatusFilterChange(value)}
            >
              {label} {statusCounts?.[value] ?? 0}
            </Button>
          ))}
          <label className="segmentSelectedOnlyToggle">
            <input
              type="checkbox"
              checked={showSelectedOnly}
              disabled={!selectedSegmentIds.length}
              onChange={(event) => setShowSelectedOnly(event.target.checked)}
            />
            <span>仅显示选中 ({selectedSegmentIds.length})</span>
          </label>
          <div className="segmentSearchBox">
            <Search size={15} />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索文本、说话人、标签..."
              aria-label="搜索片段"
            />
            {searchQuery ? (
              <button type="button" aria-label="清空搜索" onClick={() => setSearchQuery("")}>
                <X size={14} />
              </button>
            ) : null}
          </div>
          <Button
            variant={showFilterPanel ? "secondary" : "ghost"}
            size="sm"
            icon={SlidersHorizontal}
            title="显示/隐藏说话人筛选"
            aria-label="筛选"
            onClick={() => setShowFilterPanel((value) => !value)}
          />
          <Button
            variant={showColumnSettings ? "secondary" : "ghost"}
            size="sm"
            icon={Settings}
            title="设置列表显示列"
            aria-label="列表设置"
            onClick={() => setShowColumnSettings((value) => !value)}
          />
        </div>

        {showFilterPanel ? (
        <div className="segmentSpeakerToolbar">
          <button
            type="button"
            className={`segmentSpeakerChip ${activeSpeakerFilter === "all" ? "active" : ""}`}
            onClick={() => onSelectSpeaker?.("all")}
          >
            <Users size={15} />
            全部说话人 <strong>{characters.length || 0}</strong>
          </button>
          {characters.map(({ name, count }) => (
            <button
              type="button"
              key={name}
              className={`segmentSpeakerChip ${activeSpeakerFilter === name ? "active" : ""}`}
              onClick={() => onSelectSpeaker?.(name)}
              title={name}
            >
              <CharacterBadge name={name} showDot />
              <strong>{count}</strong>
            </button>
          ))}
        </div>
        ) : null}

        {showColumnSettings ? (
          <div className="segmentColumnSettings" role="group" aria-label="列表设置">
            <span>显示列</span>
            {DATA_COLUMNS.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={Boolean(visibleColumns[column.key])}
                  disabled={column.key === "text"}
                  onChange={(event) => setVisibleColumns((current) => ({
                    ...current,
                    [column.key]: event.target.checked,
                  }))}
                />
                {column.label}
              </label>
            ))}
          </div>
        ) : null}

        <div className="segmentListCommandRow">
          <div className="controlRow">
            <span className={`statusBadge ${hasUnsavedChanges ? "warning" : "success"}`}>
              {hasUnsavedChanges ? "有未保存改动" : "已保存"}
            </span>
            {segments.length ? (
              <span className="muted">
                当前显示 {displaySegments.length} / {totalSegments || statusCounts?.all || 0} 段
                {activeSpeakerFilter !== "all" ? "（已按说话人筛选）" : ""}
                {searchQuery.trim() ? "（已搜索）" : ""}
              </span>
            ) : null}
            {totalVisibleSegments && activeSpeakerFilter !== "all" ? (
              <span className="muted">筛选状态下暂不支持拖拽排序</span>
            ) : null}
          </div>
          <div className="controlRow segmentListActions">
            {actionContent}
            <Button
              variant={insertPickMode ? "danger" : "primary"}
              size="sm"
              icon={insertPickMode ? X : Plus}
              disabled={isScriptSaving}
              onClick={insertPickMode ? onCancelInsertPick : () => onRequestInsertSegment?.()}
            >
              {insertPickMode ? "取消选择位置" : "新增片段"}
            </Button>
          </div>
        </div>

        {insertPickMode ? (
          <div className="segmentInsertHint">
            选择插入位置：点击任意片段，将在该片段之后新增并自动进入编辑状态。
          </div>
        ) : null}
        {scriptError ? <div className="errorText">{scriptError}</div> : null}
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
      {displaySegments.length && shouldShowSegmentTimeline ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onTimelineDragEnd}>
          <SortableContext items={displaySegments.map((seg) => seg.segment_id)} strategy={verticalListSortingStrategy}>
            <div className="synthesisTimelineHeaderRow" style={{ gridTemplateColumns: columnTemplate }} aria-hidden="true">
              <span></span>
              <span></span>
              {visibleDataColumns.map((column) => <span key={column.key}>{column.label}</span>)}
            </div>
            <div className="synthesisTimeline" ref={timelineRef}>
              {displaySegments.map((seg) => {
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
                    onSegmentCursorChange={onSegmentCursorChange}
                    onSplitAtCursor={onSplitAtCursor}
                    handleSingleSegmentSynthesis={handleSingleSegmentSynthesis}
                    handleDeleteSegment={handleDeleteSegment}
                    setInsertAfterSegmentId={setInsertAfterSegmentId}
                    onLocateFullAudioSegment={onLocateFullAudioSegment}
                    insertPickMode={insertPickMode}
                    onPickInsertAfter={handlePickInsertAfter}
                    playFrom={playFrom}
                    pushToast={pushToast}
                    visibleColumns={visibleColumns}
                    gridTemplateColumns={columnTemplate}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : searchQuery.trim() ? (
        <EmptyState title="没有匹配片段" description="换个关键词，或清空搜索后查看全部当前筛选结果。" />
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
