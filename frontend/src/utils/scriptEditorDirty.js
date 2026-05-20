import { parseCsvList, parseOverridesJson } from "./segmentDraft.js";
import { parseSegmentTimestamp } from "./segmentTiming.js";

function normalizeOverrides(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeBaseSegment(baseSegment) {
  return {
    speaker: (baseSegment?.speaker || "").trim() || "narrator",
    text: (baseSegment?.text || "").trim(),
    type: baseSegment?.type || "dialogue",
    emotion: baseSegment?.emotion || "neutral",
    non_verbal: Array.isArray(baseSegment?.non_verbal) ? baseSegment.non_verbal : [],
    tts_overrides: normalizeOverrides(baseSegment?.tts_overrides),
    source_start_ms: baseSegment?.source_start_ms ?? null,
    source_end_ms: baseSegment?.source_end_ms ?? null,
    source_duration_ms: baseSegment?.source_duration_ms ?? null,
  };
}

function normalizeDraftSegment(segmentDraft) {
  const parsed = parseOverridesJson(segmentDraft?.ttsOverridesText || "{}");
  if (!parsed.ok) {
    return { invalid: true, value: null };
  }
  const canEditSourceTiming = Boolean(segmentDraft?.sourceStartText && segmentDraft?.sourceEndText);
  const sourceStartMs = canEditSourceTiming ? parseSegmentTimestamp(segmentDraft?.sourceStartText) : (segmentDraft?.source_start_ms ?? null);
  const sourceEndMs = canEditSourceTiming ? parseSegmentTimestamp(segmentDraft?.sourceEndText) : (segmentDraft?.source_end_ms ?? null);
  if (canEditSourceTiming && (sourceStartMs === null || sourceEndMs === null || sourceEndMs <= sourceStartMs)) {
    return { invalid: true, value: null };
  }
  return {
    invalid: false,
    value: {
      speaker: (segmentDraft?.speaker || "").trim() || "narrator",
      text: (segmentDraft?.text || "").trim(),
      type: segmentDraft?.type || "dialogue",
      emotion: segmentDraft?.emotion || "neutral",
      non_verbal: parseCsvList(segmentDraft?.nonVerbalText),
      tts_overrides: parsed.value,
      source_start_ms: sourceStartMs,
      source_end_ms: sourceEndMs,
      source_duration_ms: sourceStartMs !== null && sourceEndMs !== null ? sourceEndMs - sourceStartMs : (segmentDraft?.source_duration_ms ?? null),
    },
  };
}

export function hasEditingDraftChanges(baseSegment, segmentDraft) {
  if (!baseSegment || !segmentDraft) {
    return false;
  }
  const normalizedDraft = normalizeDraftSegment(segmentDraft);
  if (normalizedDraft.invalid) {
    return true;
  }
  return JSON.stringify(normalizedDraft.value) !== JSON.stringify(normalizeBaseSegment(baseSegment));
}
