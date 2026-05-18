import test from "node:test";
import assert from "node:assert/strict";

import {
  deleteSelectedSegments,
  getSegmentSelectionMeta,
  mergeSelectedSegments,
  moveSelectedSegmentBlock,
  pruneSegmentDrafts,
  reconcileSegmentOrder,
  sameIdSequence,
} from "../src/utils/scriptEditorState.js";

function makeSegments(ids) {
  return ids.map((id, index) => ({
    id,
    index,
    speaker: id === "b" ? "首段角色" : "其他角色",
    type: id === "b" ? "dialogue" : "narration",
    emotion: id === "b" ? "happy" : "neutral",
    text: id.toUpperCase(),
    tts_overrides: id === "b" ? { speed: 1.1 } : {},
  }));
}

test("sameIdSequence compares arrays by value", () => {
  assert.equal(sameIdSequence(["a", "b"], ["a", "b"]), true);
  assert.equal(sameIdSequence(["a", "b"], ["b", "a"]), false);
  assert.equal(sameIdSequence(["a"], ["a", "b"]), false);
});

test("pruneSegmentDrafts removes deleted segment drafts", () => {
  const drafts = {
    keep: { text: "A" },
    remove: { text: "B" },
  };
  assert.deepEqual(pruneSegmentDrafts(["keep"], drafts), {
    keep: { text: "A" },
  });
});

test("reconcileSegmentOrder returns null when persisted order matches base after add", () => {
  assert.equal(reconcileSegmentOrder(["a", "b", "c"], ["a", "b"]), null);
});

test("reconcileSegmentOrder keeps real unsaved reorder while appending new ids", () => {
  assert.deepEqual(reconcileSegmentOrder(["a", "b", "c"], ["b", "a"]), ["b", "a", "c"]);
});

test("reconcileSegmentOrder drops deleted ids and clears when base order is now synced", () => {
  assert.equal(reconcileSegmentOrder(["a", "c"], ["a", "b", "c"]), null);
});

test("getSegmentSelectionMeta detects contiguous selected segments", () => {
  const segments = makeSegments(["a", "b", "c", "d"]);
  const meta = getSegmentSelectionMeta(segments, ["c", "b"]);
  assert.deepEqual(meta.selectedIds, ["b", "c"]);
  assert.deepEqual(meta.selectedIndexes, [1, 2]);
  assert.equal(meta.isContiguous, true);
});

test("getSegmentSelectionMeta detects non-contiguous selected segments", () => {
  const segments = makeSegments(["a", "b", "c", "d"]);
  const meta = getSegmentSelectionMeta(segments, ["b", "d"]);
  assert.deepEqual(meta.selectedIds, ["b", "d"]);
  assert.equal(meta.isContiguous, false);
});

test("deleteSelectedSegments deletes non-contiguous selections and reindexes", () => {
  const next = deleteSelectedSegments(makeSegments(["a", "b", "c", "d"]), ["b", "d"]);
  assert.deepEqual(next.map((segment) => segment.id), ["a", "c"]);
  assert.deepEqual(next.map((segment) => segment.index), [0, 1]);
});

test("moveSelectedSegmentBlock moves a contiguous block before an earlier target", () => {
  const next = moveSelectedSegmentBlock(makeSegments(["a", "b", "c", "d"]), ["c", "d"], "a");
  assert.deepEqual(next.map((segment) => segment.id), ["c", "d", "a", "b"]);
  assert.deepEqual(next.map((segment) => segment.index), [0, 1, 2, 3]);
});

test("moveSelectedSegmentBlock moves a contiguous block after a later target", () => {
  const next = moveSelectedSegmentBlock(makeSegments(["a", "b", "c", "d"]), ["b", "c"], "d");
  assert.deepEqual(next.map((segment) => segment.id), ["a", "d", "b", "c"]);
  assert.deepEqual(next.map((segment) => segment.index), [0, 1, 2, 3]);
});

test("moveSelectedSegmentBlock keeps list unchanged when dropped inside the selected block", () => {
  const next = moveSelectedSegmentBlock(makeSegments(["a", "b", "c", "d"]), ["b", "c"], "c");
  assert.deepEqual(next.map((segment) => segment.id), ["a", "b", "c", "d"]);
});

test("moveSelectedSegmentBlock keeps list unchanged for non-contiguous selections", () => {
  const next = moveSelectedSegmentBlock(makeSegments(["a", "b", "c", "d"]), ["b", "d"], "a");
  assert.deepEqual(next.map((segment) => segment.id), ["a", "b", "c", "d"]);
});

test("mergeSelectedSegments merges contiguous selections into the first segment", () => {
  const next = mergeSelectedSegments(makeSegments(["a", "b", "c", "d"]), ["b", "c", "d"]);
  assert.deepEqual(next.map((segment) => segment.id), ["a", "b"]);
  assert.equal(next[1].text, "B C D");
  assert.equal(next[1].speaker, "首段角色");
  assert.equal(next[1].type, "dialogue");
  assert.equal(next[1].emotion, "happy");
  assert.deepEqual(next[1].tts_overrides, { speed: 1.1 });
  assert.deepEqual(next.map((segment) => segment.index), [0, 1]);
});
