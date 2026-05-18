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

export function buildSegmentEditorDraft(segment) {
  const sourceStartMs = Number(segment?.source_start_ms);
  const sourceEndMs = Number(segment?.source_end_ms);
  const hasSourceTiming =
    Number.isFinite(sourceStartMs) &&
    Number.isFinite(sourceEndMs) &&
    sourceStartMs >= 0 &&
    sourceEndMs > sourceStartMs;
  return {
    ...segment,
    nonVerbalText: Array.isArray(segment?.non_verbal) ? segment.non_verbal.join(", ") : "",
    ttsOverridesText: JSON.stringify(segment?.tts_overrides || {}, null, 2),
    sourceStartText: hasSourceTiming ? formatSegmentTimestamp(sourceStartMs) : "",
    sourceEndText: hasSourceTiming ? formatSegmentTimestamp(sourceEndMs) : "",
    sourceBoundsStartMs: hasSourceTiming ? sourceStartMs : null,
    sourceBoundsEndMs: hasSourceTiming ? sourceEndMs : null,
  };
}

export function normalizeSegmentFromEditorDraft(draft) {
  const parsed = parseOverridesJson(draft?.ttsOverridesText || "{}");
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const boundsStartMs = Number(draft?.sourceBoundsStartMs);
  const boundsEndMs = Number(draft?.sourceBoundsEndMs);
  const hasSourceBounds =
    Number.isFinite(boundsStartMs) &&
    Number.isFinite(boundsEndMs) &&
    boundsStartMs >= 0 &&
    boundsEndMs > boundsStartMs;
  let sourceStartMs = draft?.source_start_ms ?? null;
  let sourceEndMs = draft?.source_end_ms ?? null;
  let sourceDurationMs = draft?.source_duration_ms ?? null;
  if (hasSourceBounds) {
    sourceStartMs = parseSegmentTimestamp(draft?.sourceStartText);
    sourceEndMs = parseSegmentTimestamp(draft?.sourceEndText);
    if (sourceStartMs === null || sourceEndMs === null) {
      return { ok: false, error: "时间码格式需为 HH:MM:SS.mmm" };
    }
    if (sourceEndMs <= sourceStartMs) {
      return { ok: false, error: "终止时间必须晚于起始时间" };
    }
    if (sourceStartMs < boundsStartMs || sourceEndMs > boundsEndMs) {
      return {
        ok: false,
        error: `起止时间必须位于原范围 ${formatSegmentTimestamp(boundsStartMs)} - ${formatSegmentTimestamp(boundsEndMs)} 内`,
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
