import test from "node:test";
import assert from "node:assert/strict";

import { buildScriptDiffSummary, computeScriptDiff, normalizeDraftScript } from "../src/utils/scriptDiff.js";

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

test("computeScriptDiff detects source timing modifications", () => {
  const saved = makeScript([
    {
      id: "a",
      speaker: "narrator",
      text: "A",
      type: "narration",
      source_start_ms: 1000,
      source_end_ms: 3000,
      source_duration_ms: 2000,
    },
  ]);
  const draft = makeScript([
    {
      id: "a",
      speaker: "narrator",
      text: "A",
      type: "narration",
      source_start_ms: 1200,
      source_end_ms: 2800,
      source_duration_ms: 1600,
    },
  ]);

  const diff = computeScriptDiff(saved, draft);
  assert.equal(diff.hasChanges, true);
  assert.deepEqual(diff.modifiedSegmentIds, ["a"]);
  assert.deepEqual(diff.modifiedSegments[0].changedFields, [
    "source_start_ms",
    "source_end_ms",
    "source_duration_ms",
  ]);
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

test("buildScriptDiffSummary returns compact counts", () => {
  const saved = makeScript([{ id: "a", speaker: "narrator", text: "A", type: "narration" }]);
  const draft = makeScript([{ id: "a", speaker: "narrator", text: "A2", type: "narration" }]);
  const summary = buildScriptDiffSummary(computeScriptDiff(saved, draft));
  assert.equal(summary.hasChanges, true);
  assert.equal(summary.modified, 1);
  assert.equal(summary.added, 0);
  assert.equal(summary.removed, 0);
});
