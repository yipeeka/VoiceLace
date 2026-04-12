import { useEffect, useRef } from "react";

import { API_ORIGIN } from "../../utils/api";

export default function SegmentResultList({ segments, activeSegmentId, onLocate }) {
  const itemRefs = useRef(new Map());

  useEffect(() => {
    if (!activeSegmentId) {
      return;
    }
    const node = itemRefs.current.get(activeSegmentId);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [activeSegmentId]);

  if (!segments.length) {
    return <div className="emptyState">还没有分段结果，先执行一次合成。</div>;
  }

  return (
    <div className="listStack">
      {segments.map((segment) => (
        <div
          key={segment.segment_id}
          ref={(node) => {
            if (node) {
              itemRefs.current.set(segment.segment_id, node);
            } else {
              itemRefs.current.delete(segment.segment_id);
            }
          }}
          className={`segmentEditorCard ${activeSegmentId === segment.segment_id ? "segmentEditorCardActive" : ""}`}
        >
          <div className="segmentEditorHeader">
            <strong>
              #{segment.index + 1} · {segment.speaker}
            </strong>
            <span className="muted">{segment.status}</span>
          </div>
          <p className="segmentText">{segment.text}</p>
          <div className="controlRow">
            <button type="button" className="primaryButton ghostButton segmentActionButton" onClick={() => onLocate?.(segment.segment_id)}>
              定位到时间线
            </button>
            <div style={{ flex: 1 }}>
              <audio
                controls
                preload="none"
                style={{ width: "100%" }}
                src={`${API_ORIGIN}${segment.audio_url}`}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
