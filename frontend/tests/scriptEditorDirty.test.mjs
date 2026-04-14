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
};

function makeDraft(overrides = {}) {
  return {
    speaker: BASE.speaker,
    text: BASE.text,
    type: BASE.type,
    emotion: BASE.emotion,
    nonVerbalText: "",
    ttsOverridesText: "{}",
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
