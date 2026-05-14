import { DndContext, closestCenter } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useEffect, useRef } from "react";

import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import SegmentTimelineRow from "./SegmentTimelineRow";
import { useI18n } from "../../i18n/I18nProvider";

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
  playFrom,
  isAutoPlay,
  stop,
  pushToast,
}) {
  const { t } = useI18n();
  const timelineRef = useRef(null);
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

  return (
    <GlassCard>
      <h2 className="cardTitle">{t("synth.timeline.title")}</h2>
      {totalVisibleSegments ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className="muted">
            {t("synth.timeline.showingCount", { count: totalVisibleSegments })}{activeSpeakerFilter !== "all" ? t("synth.timeline.filteredByCharacter") : ""}
          </span>
          {activeSpeakerFilter !== "all" ? (
            <span className="muted">{t("synth.timeline.dragDisabledByFilter")}</span>
          ) : null}
        </div>
      ) : null}
      <div className="controlRow" style={{ marginBottom: 10, gap: 8, flexWrap: "wrap" }}>
        <span className="muted">{t("synth.timeline.statusFilter")}</span>
        <Button
          variant={activeStatusFilter === "all" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("all")}
        >
          {t("common.all")} {statusCounts?.all ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "stale" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("stale")}
        >
          {t("synth.timeline.stale")} {statusCounts?.stale ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "done" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("done")}
        >
          {t("synth.timeline.done")} {statusCounts?.done ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "missing" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("missing")}
        >
          {t("synth.timeline.missing")} {statusCounts?.missing ?? 0}
        </Button>
        <Button
          variant={activeStatusFilter === "failed" ? "primary" : "ghost"}
          size="sm"
          onClick={() => onStatusFilterChange("failed")}
        >
          {t("synth.timeline.failed")} {statusCounts?.failed ?? 0}
        </Button>
      </div>
      {selectedSegmentIds.length ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className="muted">{t("synth.timeline.selectedCount", { count: selectedSegmentIds.length })}</span>
          <Button variant="secondary" size="sm" onClick={() => handleRegenerateSelected()} disabled={isRunning}>
            {t("synth.timeline.regenerateSelected")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedSegmentIds([])} disabled={isRunning}>
            {t("common.clear")}
          </Button>
        </div>
      ) : null}
      {staleTargetIds.length ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className="muted">{t("synth.timeline.staleDetected", { count: staleTargetIds.length })}</span>
          <Button
            variant="secondary"
            size="sm"
            disabled={isRunning}
            onClick={async () => {
              const ids = recommendedRegenerateIds.length ? recommendedRegenerateIds : staleTargetIds;
              setSelectedSegmentIds(ids);
              await handleRegenerateSelected(ids);
            }}
          >
            {t("synth.timeline.regenerateStale")}
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
                    onToggleSelected={(checked) =>
                      setSelectedSegmentIds((ids) =>
                        checked ? (ids.includes(seg.segment_id) ? ids : [...ids, seg.segment_id]) : ids.filter((id) => id !== seg.segment_id)
                      )
                    }
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
                    playFrom={playFrom}
                    pushToast={pushToast}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : activeSpeakerFilter !== "all" ? (
        <EmptyState title={t("script.empty.noSegmentsForSpeaker")} description={t("script.empty.noSegmentsForSpeakerDesc")} />
      ) : shouldShowSegmentTimeline ? (
        <EmptyState title={t("synth.timeline.empty.noSegmentResults")} description={t("synth.timeline.empty.noSegmentResultsDesc")} />
      ) : (
        <EmptyState title={t("synth.timeline.empty.missingAudioTitle")} description={t("synth.timeline.empty.missingAudioDesc")} />
      )}
      {isAutoPlay ? (
        <div className="controlRow" style={{ marginTop: 12 }}>
          <span className="muted">{t("synth.timeline.autoPlayRunning")}</span>
          <Button variant="danger" size="sm" onClick={stop}>
            {t("synth.timeline.stopAutoPlay")}
          </Button>
        </div>
      ) : null}
    </GlassCard>
  );
}
