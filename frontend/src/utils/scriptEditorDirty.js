import { parseCsvList, parseOverridesJson } from "./segmentDraft.js";

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
  };
}

function normalizeDraftSegment(segmentDraft) {
  const parsed = parseOverridesJson(segmentDraft?.ttsOverridesText || "{}");
  if (!parsed.ok) {
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
