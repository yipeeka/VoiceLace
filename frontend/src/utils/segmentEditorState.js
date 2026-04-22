import { parseCsvList, parseOverridesJson } from "./segmentDraft.js";

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
    type: "dialogue",
    speaker: "narrator",
    text: "",
    emotion: "neutral",
    non_verbal: [],
    tts_overrides: {},
    nonVerbalText: "",
    ttsOverridesText: "{}",
  };
}

export function buildSegmentEditorDraft(segment) {
  return {
    ...segment,
    nonVerbalText: Array.isArray(segment?.non_verbal) ? segment.non_verbal.join(", ") : "",
    ttsOverridesText: JSON.stringify(segment?.tts_overrides || {}, null, 2),
  };
}

export function normalizeSegmentFromEditorDraft(draft) {
  const parsed = parseOverridesJson(draft?.ttsOverridesText || "{}");
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return {
    ok: true,
    value: {
      ...draft,
      nonVerbalText: undefined,
      ttsOverridesText: undefined,
      speaker: (draft?.speaker || "").trim() || "narrator",
      text: (draft?.text || "").trim(),
      type: draft?.type || "dialogue",
      emotion: draft?.emotion || "neutral",
      non_verbal: parseCsvList(draft?.nonVerbalText),
      tts_overrides: parsed.value,
    },
  };
}
