import { parseCsvList, parseOverridesJson } from "./segmentDraft.js";
import { formatSegmentTimestamp, parseSegmentTimestamp } from "./segmentTiming.js";

function generateSegmentId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `segment-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function createSegmentDraft(index = 0) {
  return {
    id: generateSegmentId(),
    index,
    type: "narration",
    speaker: "narrator",
    text: "",
    emotion: "neutral",
    non_verbal: [],
    tts_overrides: {},
    nonVerbalText: "",
    ttsOverridesText: "{}",
    sourceStartText: "",
    sourceEndText: "",
    sourceBoundsStartMs: null,
    sourceBoundsEndMs: null,
  };
}

function toFiniteMs(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getSegmentSourceRange(segment) {
  const startMs = toFiniteMs(segment?.source_start_ms);
  const endMs = toFiniteMs(segment?.source_end_ms);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  return { startMs, endMs };
}

function findSourceTimingBounds(segment, segments = []) {
  const list = Array.isArray(segments) ? segments : [];
  const index = list.findIndex((item) => String(item?.id || "") === String(segment?.id || ""));
  if (index < 0) {
    const range = getSegmentSourceRange(segment);
    return {
      startMs: range?.startMs ?? null,
      endMs: range?.endMs ?? null,
    };
  }
  let startMs = 0;
  let endMs = null;
  for (let i = index - 1; i >= 0; i -= 1) {
    const range = getSegmentSourceRange(list[i]);
    if (range) {
      startMs = range.endMs;
      break;
    }
  }
  for (let i = index + 1; i < list.length; i += 1) {
    const range = getSegmentSourceRange(list[i]);
    if (range) {
      endMs = range.startMs;
      break;
    }
  }
  return { startMs, endMs };
}

function formatBoundaryRange(startMs, endMs) {
  if (startMs !== null && endMs !== null) {
    return `${formatSegmentTimestamp(startMs)} - ${formatSegmentTimestamp(endMs)}`;
  }
  if (startMs !== null) {
    return `${formatSegmentTimestamp(startMs)} 之后`;
  }
  if (endMs !== null) {
    return `${formatSegmentTimestamp(endMs)} 之前`;
  }
  return "相邻片段边界内";
}

export function buildSegmentEditorDraft(segment, options = {}) {
  const sourceStartMs = Number(segment?.source_start_ms);
  const sourceEndMs = Number(segment?.source_end_ms);
  const hasSourceTiming =
    Number.isFinite(sourceStartMs) &&
    Number.isFinite(sourceEndMs) &&
    sourceStartMs >= 0 &&
    sourceEndMs > sourceStartMs;
  const bounds = hasSourceTiming
    ? findSourceTimingBounds(segment, options?.segments)
    : { startMs: null, endMs: null };
  return {
    ...segment,
    nonVerbalText: Array.isArray(segment?.non_verbal) ? segment.non_verbal.join(", ") : "",
    ttsOverridesText: JSON.stringify(segment?.tts_overrides || {}, null, 2),
    sourceStartText: hasSourceTiming ? formatSegmentTimestamp(sourceStartMs) : "",
    sourceEndText: hasSourceTiming ? formatSegmentTimestamp(sourceEndMs) : "",
    sourceBoundsStartMs: hasSourceTiming ? bounds.startMs : null,
    sourceBoundsEndMs: hasSourceTiming ? bounds.endMs : null,
  };
}

export function normalizeSegmentFromEditorDraft(draft) {
  const parsed = parseOverridesJson(draft?.ttsOverridesText || "{}");
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const boundsStartMs = toFiniteMs(draft?.sourceBoundsStartMs);
  const boundsEndMs = toFiniteMs(draft?.sourceBoundsEndMs);
  const canEditSourceTiming = String(draft?.sourceStartText || "").trim() && String(draft?.sourceEndText || "").trim();
  let sourceStartMs = draft?.source_start_ms ?? null;
  let sourceEndMs = draft?.source_end_ms ?? null;
  let sourceDurationMs = draft?.source_duration_ms ?? null;
  if (canEditSourceTiming) {
    sourceStartMs = parseSegmentTimestamp(draft?.sourceStartText);
    sourceEndMs = parseSegmentTimestamp(draft?.sourceEndText);
    if (sourceStartMs === null || sourceEndMs === null) {
      return { ok: false, error: "时间码格式需为 HH:MM:SS.mmm" };
    }
    if (sourceEndMs <= sourceStartMs) {
      return { ok: false, error: "终止时间必须晚于起始时间" };
    }
    if ((boundsStartMs !== null && sourceStartMs < boundsStartMs) || (boundsEndMs !== null && sourceEndMs > boundsEndMs)) {
      return {
        ok: false,
        error: `起止时间不能超过相邻片段边界 ${formatBoundaryRange(boundsStartMs, boundsEndMs)}`,
      };
    }
    sourceDurationMs = sourceEndMs - sourceStartMs;
  }
  return {
    ok: true,
    value: {
      ...draft,
      nonVerbalText: undefined,
      ttsOverridesText: undefined,
      sourceStartText: undefined,
      sourceEndText: undefined,
      sourceBoundsStartMs: undefined,
      sourceBoundsEndMs: undefined,
      speaker: (draft?.speaker || "").trim() || "narrator",
      text: (draft?.text || "").trim(),
      type: draft?.type || "dialogue",
      emotion: draft?.emotion || "neutral",
      non_verbal: parseCsvList(draft?.nonVerbalText),
      tts_overrides: parsed.value,
      source_start_ms: sourceStartMs,
      source_end_ms: sourceEndMs,
      source_duration_ms: sourceDurationMs,
    },
  };
}
