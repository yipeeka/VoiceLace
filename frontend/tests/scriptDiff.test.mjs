import test from "node:test";
import assert from "node:assert/strict";

import { computeScriptDiff, normalizeDraftScript } from "../src/utils/scriptDiff.js";

function makeScript(segments) {
  return normalizeDraftScript({
    title: "demo",
    source_text: "demo source",
    segments,
  });
}

test("computeScriptDiff detects added and removed segments", () => {
  const saved = makeScript([
    { id: "a", speaker: "narrator", text: "A", type: "narration" },
    { id: "b", speaker: "narrator", text: "B", type: "narration" },
  ]);
  const draft = makeScript([
    { id: "a", speaker: "narrator", text: "A", type: "narration" },
    { id: "c", speaker: "narrator", text: "C", type: "narration" },
  ]);

  const diff = computeScriptDiff(saved, draft);
  assert.equal(diff.hasChanges, true);
  assert.deepEqual(diff.addedSegmentIds, ["c"]);
  assert.deepEqual(diff.removedSegmentIds, ["b"]);
});

test("computeScriptDiff detects content modifications", () => {
  const saved = makeScript([
    { id: "a", speaker: "narrator", text: "A", type: "narration", emotion: "neutral" },
  ]);
  const draft = makeScript([
    { id: "a", speaker: "旁白", text: "A2", type: "dialogue", emotion: "sad" },
  ]);

  const diff = computeScriptDiff(saved, draft);
  assert.equal(diff.hasChanges, true);
  assert.deepEqual(diff.modifiedSegmentIds, ["a"]);
  assert.equal(diff.reordered, false);
});

test("computeScriptDiff detects reorder only", () => {
  const saved = makeScript([
    { id: "a", speaker: "narrator", text: "A", type: "narration" },
    { id: "b", speaker: "narrator", text: "B", type: "narration" },
    { id: "c", speaker: "narrator", text: "C", type: "narration" },
  ]);
  const draft = makeScript([
    { id: "b", speaker: "narrator", text: "B", type: "narration" },
    { id: "a", speaker: "narrator", text: "A", type: "narration" },
    { id: "c", speaker: "narrator", text: "C", type: "narration" },
  ]);

  const diff = computeScriptDiff(saved, draft);
  assert.equal(diff.hasChanges, true);
  assert.equal(diff.reordered, true);
  assert.deepEqual(diff.modifiedSegmentIds, []);
  assert.deepEqual(diff.addedSegmentIds, []);
  assert.deepEqual(diff.removedSegmentIds, []);
});

test("computeScriptDiff returns no changes for normalized equivalent scripts", () => {
  const saved = makeScript([
    { id: "a", speaker: " narrator ", text: " A ", type: "narration", non_verbal: [" laugh ", ""] },
  ]);
  const draft = makeScript([
    { id: "a", speaker: "narrator", text: "A", type: "narration", non_verbal: ["laugh"] },
  ]);

  const diff = computeScriptDiff(saved, draft);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.reordered, false);
  assert.deepEqual(diff.modifiedSegmentIds, []);
});
