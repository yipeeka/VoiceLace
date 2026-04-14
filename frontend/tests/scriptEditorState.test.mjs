import test from "node:test";
import assert from "node:assert/strict";

import {
  pruneSegmentDrafts,
  reconcileSegmentOrder,
  sameIdSequence,
} from "../src/utils/scriptEditorState.js";

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
