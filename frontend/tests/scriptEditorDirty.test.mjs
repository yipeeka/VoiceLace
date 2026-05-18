import test from "node:test";
import assert from "node:assert/strict";

import { hasEditingDraftChanges } from "../src/utils/scriptEditorDirty.js";

const BASE = {
  id: "seg-1",
  speaker: "narrator",
  text: "他说",
  type: "narration",
  emotion: "neutral",
  non_verbal: [],
  tts_overrides: {},
  source_start_ms: 1000,
  source_end_ms: 3000,
  source_duration_ms: 2000,
};

function makeDraft(overrides = {}) {
  return {
    speaker: BASE.speaker,
    text: BASE.text,
    type: BASE.type,
    emotion: BASE.emotion,
    nonVerbalText: "",
    ttsOverridesText: "{}",
    sourceStartText: "00:00:01.000",
    sourceEndText: "00:00:03.000",
    sourceBoundsStartMs: 1000,
    sourceBoundsEndMs: 3000,
    ...overrides,
  };
}

test("hasEditingDraftChanges returns false when draft matches base", () => {
  assert.equal(hasEditingDraftChanges(BASE, makeDraft()), false);
});

test("hasEditingDraftChanges detects text updates", () => {
  assert.equal(hasEditingDraftChanges(BASE, makeDraft({ text: "他说。"})), true);
});

test("hasEditingDraftChanges detects delete-like empty text", () => {
  assert.equal(hasEditingDraftChanges(BASE, makeDraft({ text: "" })), true);
});

test("hasEditingDraftChanges treats invalid overrides json as dirty", () => {
  assert.equal(hasEditingDraftChanges(BASE, makeDraft({ ttsOverridesText: "{" })), true);
});

test("hasEditingDraftChanges detects non_verbal and overrides updates", () => {
  const draft = makeDraft({
    nonVerbalText: "laugh, sigh",
    ttsOverridesText: '{"speed":1.1}',
  });
  assert.equal(hasEditingDraftChanges(BASE, draft), true);
});

test("hasEditingDraftChanges detects source timing updates", () => {
  assert.equal(hasEditingDraftChanges(BASE, makeDraft({ sourceEndText: "00:00:02.500" })), true);
});
