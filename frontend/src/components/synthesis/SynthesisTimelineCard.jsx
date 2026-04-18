import EmptyState from "../shared/EmptyState";
import GlassCard from "../shared/GlassCard";
import Button from "../ui/Button";
import SegmentTimelineRow from "./SegmentTimelineRow";

export default function SynthesisTimelineCard({
  API_ORIGIN,
  segments,
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
  playFrom,
  isAutoPlay,
  stop,
  pushToast,
}) {
  return (
    <GlassCard className="fullWidthCard">
      <h2 className="cardTitle">分段时间线</h2>
      {selectedSegmentIds.length ? (
        <div className="controlRow" style={{ marginBottom: 10 }}>
          <span className="muted">已选 {selectedSegmentIds.length} 段</span>
          <Button variant="secondary" size="sm" onClick={handleRegenerateSelected} disabled={isRunning}>
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
      {segments.length && shouldShowSegmentTimeline ? (
        <div className="synthesisTimeline">
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
                segmentDraft={segmentDraft}
                setSegmentDraft={setSegmentDraft}
                isScriptSaving={isScriptSaving}
                beginEditSegment={beginEditSegment}
                cancelEditSegment={cancelEditSegment}
                saveEditedSegment={saveEditedSegment}
                handleSingleSegmentSynthesis={handleSingleSegmentSynthesis}
                playFrom={playFrom}
                pushToast={pushToast}
              />
            );
          })}
        </div>
      ) : shouldShowSegmentTimeline ? (
        <EmptyState title="还没有分段结果" description="点击「开始合成」后每段音频完成时会在此显示" />
      ) : (
        <EmptyState title="缺失音频文件" description="当前项目尚未生成任何分段音频，请先执行合成后再查看分段时间线。" />
      )}
      {isAutoPlay ? (
        <div className="controlRow" style={{ marginTop: 12 }}>
          <span className="muted">连续播放进行中</span>
          <Button variant="danger" size="sm" onClick={stop}>
            停止连续播放
          </Button>
        </div>
      ) : null}
    </GlassCard>
  );
}
