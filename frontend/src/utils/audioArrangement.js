export const MIN_ARRANGEMENT_SEGMENT_DURATION_MS = 300;
export const ARRANGEMENT_SNAP_MS = 50;

function toFiniteMs(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function clampMs(value, min = 0) {
  return Math.max(min, Math.round(Number(value) || 0));
}

function snapMs(value, snapMs = ARRANGEMENT_SNAP_MS) {
  const snap = Math.max(1, Number(snapMs) || ARRANGEMENT_SNAP_MS);
  return Math.round((Number(value) || 0) / snap) * snap;
}

function hasSourceTiming(segment) {
  const startMs = Number(segment?.source_start_ms);
  const endMs = Number(segment?.source_end_ms);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= 0 && endMs > startMs;
}

export function hasAnyArrangementSourceTiming(segments = []) {
  return (segments || []).some(hasSourceTiming);
}

export function buildArrangementDraft({
  segments = [],
  gapDurationMs = 300,
  useSourceTimeline = false,
  bgmOffsetMs = 0,
  ambienceOffsetMs = 0,
} = {}) {
  let cursor = 0;
  const gapMs = Math.max(0, toFiniteMs(gapDurationMs, 300));

  const items = (segments || []).map((segment, index) => {
    const durationMs = Math.max(
      MIN_ARRANGEMENT_SEGMENT_DURATION_MS,
      toFiniteMs(segment?.duration_ms, 0) || toFiniteMs(segment?.source_duration_ms, 0) || 1000,
    );
    const sourceStartMs = Number(segment?.source_start_ms);
    const sourceEndMs = Number(segment?.source_end_ms);
    const validSourceTiming = hasSourceTiming(segment);
    let startMs = cursor;
    let endMs = startMs + durationMs;

    if (useSourceTimeline && validSourceTiming) {
      startMs = Math.round(sourceStartMs);
      endMs = Math.max(startMs + MIN_ARRANGEMENT_SEGMENT_DURATION_MS, Math.round(sourceEndMs));
    } else if (useSourceTimeline && Number.isFinite(sourceStartMs) && sourceStartMs >= 0) {
      startMs = Math.round(sourceStartMs);
      endMs = startMs + durationMs;
    }

    cursor = useSourceTimeline ? Math.max(cursor, endMs) : endMs + gapMs;

    return {
      segmentId: segment?.segment_id || segment?.id || `segment-${index}`,
      index: Number.isFinite(Number(segment?.index)) ? Number(segment.index) : index,
      speaker: segment?.speaker || "narrator",
      text: segment?.text || "",
      status: segment?.display_status || segment?.status || "pending",
      startMs,
      endMs,
      durationMs: Math.max(MIN_ARRANGEMENT_SEGMENT_DURATION_MS, endMs - startMs),
    };
  });

  return {
    version: 1,
    segments: items,
    tracks: {
      bgm: { offsetMs: toFiniteMs(bgmOffsetMs, 0) },
      ambience: { offsetMs: toFiniteMs(ambienceOffsetMs, 0) },
    },
  };
}

export function normalizeArrangementDraft(draft) {
  return {
    version: 1,
    segments: (draft?.segments || []).map((item, index) => {
      const startMs = clampMs(item?.startMs, 0);
      const requestedEndMs = clampMs(item?.endMs, startMs + MIN_ARRANGEMENT_SEGMENT_DURATION_MS);
      const endMs = Math.max(startMs + MIN_ARRANGEMENT_SEGMENT_DURATION_MS, requestedEndMs);
      return {
        ...item,
        segmentId: item?.segmentId || `segment-${index}`,
        index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index,
        startMs,
        endMs,
        durationMs: endMs - startMs,
      };
    }),
    tracks: {
      bgm: { offsetMs: toFiniteMs(draft?.tracks?.bgm?.offsetMs, 0) },
      ambience: { offsetMs: toFiniteMs(draft?.tracks?.ambience?.offsetMs, 0) },
    },
  };
}

export function moveArrangementSegment(draft, segmentId, deltaMs, options = {}) {
  const snap = options.snapMs ?? ARRANGEMENT_SNAP_MS;
  return normalizeArrangementDraft({
    ...draft,
    segments: (draft?.segments || []).map((item) => {
      if (item.segmentId !== segmentId) return item;
      const durationMs = Math.max(MIN_ARRANGEMENT_SEGMENT_DURATION_MS, item.endMs - item.startMs);
      const startMs = clampMs(snapMs(item.startMs + deltaMs, snap), 0);
      return {
        ...item,
        startMs,
        endMs: startMs + durationMs,
        durationMs,
      };
    }),
  });
}

export function resizeArrangementSegment(draft, segmentId, edge, deltaMs, options = {}) {
  const snap = options.snapMs ?? ARRANGEMENT_SNAP_MS;
  const minDurationMs = Math.max(
    MIN_ARRANGEMENT_SEGMENT_DURATION_MS,
    toFiniteMs(options.minDurationMs, MIN_ARRANGEMENT_SEGMENT_DURATION_MS),
  );

  return normalizeArrangementDraft({
    ...draft,
    segments: (draft?.segments || []).map((item) => {
      if (item.segmentId !== segmentId) return item;
      if (edge === "start") {
        const maxStartMs = item.endMs - minDurationMs;
        const startMs = Math.max(0, Math.min(maxStartMs, snapMs(item.startMs + deltaMs, snap)));
        return {
          ...item,
          startMs,
          durationMs: item.endMs - startMs,
        };
      }
      const endMs = Math.max(item.startMs + minDurationMs, snapMs(item.endMs + deltaMs, snap));
      return {
        ...item,
        endMs,
        durationMs: endMs - item.startMs,
      };
    }),
  });
}

export function buildScriptSegmentsWithArrangement(scriptSegments = [], draft) {
  const normalized = normalizeArrangementDraft(draft);
  const timingById = Object.fromEntries(normalized.segments.map((item) => [item.segmentId, item]));
  return (scriptSegments || []).map((segment, index) => {
    const timing = timingById[segment.id || segment.segment_id];
    if (!timing) {
      return { ...segment, index };
    }
    const startMs = clampMs(timing.startMs, 0);
    const endMs = Math.max(startMs + MIN_ARRANGEMENT_SEGMENT_DURATION_MS, clampMs(timing.endMs, startMs));
    return {
      ...segment,
      index,
      source_start_ms: startMs,
      source_end_ms: endMs,
      source_duration_ms: endMs - startMs,
    };
  });
}

export function getArrangementWarnings(draft) {
  const normalized = normalizeArrangementDraft(draft);
  const warnings = {};
  const ordered = [...normalized.segments].sort((a, b) => a.startMs - b.startMs || a.index - b.index);

  ordered.forEach((item, index) => {
    const itemWarnings = [];
    if (item.startMs < 0) itemWarnings.push("位置不能为负数");
    if (item.durationMs < MIN_ARRANGEMENT_SEGMENT_DURATION_MS) itemWarnings.push("片段过短");
    const prev = ordered[index - 1];
    const next = ordered[index + 1];
    if (prev && item.startMs < prev.endMs) itemWarnings.push("与上一段重叠");
    if (next && item.endMs > next.startMs) itemWarnings.push("与下一段重叠");
    if (itemWarnings.length) {
      warnings[item.segmentId] = itemWarnings;
    }
  });

  return warnings;
}

export function areArrangementDraftsEqual(a, b) {
  const left = normalizeArrangementDraft(a);
  const right = normalizeArrangementDraft(b);
  return JSON.stringify(left) === JSON.stringify(right);
}
