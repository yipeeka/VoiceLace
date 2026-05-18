import test from "node:test";
import assert from "node:assert/strict";

import {
  applySegmentSelectionClick,
  buildCharacterStats,
  buildSpeakerOptions,
  filterSegmentsBySpeaker,
  filterSegmentsByWorkflowStatus,
  getInsertAnchorLabel,
  pruneSelectedSegmentIds,
} from "../src/utils/scriptSidebar.js";

test("buildCharacterStats aggregates speakers and sorts by count", () => {
  const stats = buildCharacterStats([
    { speaker: "narrator" },
    { speaker: "老周" },
    { speaker: "老周" },
    { speaker: "儿子" },
  ]);
  assert.deepEqual(stats, [
    { name: "老周", count: 2 },
    { name: "narrator", count: 1 },
    { name: "儿子", count: 1 },
  ]);
});

test("buildSpeakerOptions keeps narrator first and can add create option", () => {
  const options = buildSpeakerOptions(
    [{ name: "老周", count: 2 }, { name: "narrator", count: 1 }],
    { includeCreateOption: true },
  );
  assert.deepEqual(options, [
    { value: "narrator", label: "narrator" },
    { value: "老周", label: "老周" },
    { value: "__new__", label: "+ 添加新角色" },
  ]);
});

test("filterSegmentsBySpeaker returns all segments for all filter", () => {
  const segments = [{ speaker: "narrator" }, { speaker: "老周" }];
  assert.equal(filterSegmentsBySpeaker(segments, "all"), segments);
});

test("filterSegmentsBySpeaker narrows down by speaker", () => {
  const segments = [
    { segment_id: "1", speaker: "narrator" },
    { segment_id: "2", speaker: "老周" },
    { segment_id: "3", speaker: "老周" },
  ];
  assert.deepEqual(filterSegmentsBySpeaker(segments, "老周"), [
    { segment_id: "2", speaker: "老周" },
    { segment_id: "3", speaker: "老周" },
  ]);
});

test("filterSegmentsByWorkflowStatus narrows down by mapped workflow status", () => {
  const segments = [
    { segment_id: "1", workflow_status: "done" },
    { segment_id: "2", workflow_status: "stale" },
    { segment_id: "3", workflow_status: "missing" },
  ];
  assert.deepEqual(filterSegmentsByWorkflowStatus(segments, "stale"), [
    { segment_id: "2", workflow_status: "stale" },
  ]);
});

test("pruneSelectedSegmentIds keeps only visible segment ids", () => {
  const visible = [{ segment_id: "a" }, { id: "b" }];
  assert.deepEqual(pruneSelectedSegmentIds(["a", "b", "c"], visible), ["a", "b"]);
});

test("applySegmentSelectionClick selects visible range with shift click", () => {
  const visible = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(
    applySegmentSelectionClick({
      selectedIds: ["a"],
      visibleSegments: visible,
      targetId: "d",
      checked: true,
      shiftKey: true,
      anchorId: "a",
    }),
    ["a", "b", "c", "d"],
  );
});

test("applySegmentSelectionClick supports mixed segment_id and id values", () => {
  const visible = [{ segment_id: "a" }, { id: "b" }, { segment_id: "c" }];
  assert.deepEqual(
    applySegmentSelectionClick({
      selectedIds: ["a"],
      visibleSegments: visible,
      targetId: "c",
      checked: true,
      shiftKey: true,
      anchorId: "a",
    }),
    ["a", "b", "c"],
  );
});

test("applySegmentSelectionClick falls back to single toggle without visible anchor", () => {
  const visible = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(
    applySegmentSelectionClick({
      selectedIds: ["a"],
      visibleSegments: visible,
      targetId: "c",
      checked: true,
      shiftKey: true,
      anchorId: "missing",
    }),
    ["a", "c"],
  );
});

test("applySegmentSelectionClick can clear a selected range", () => {
  const visible = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(
    applySegmentSelectionClick({
      selectedIds: ["a", "b", "c", "d"],
      visibleSegments: visible,
      targetId: "c",
      checked: false,
      shiftKey: true,
      anchorId: "a",
    }),
    ["d"],
  );
});

test("getInsertAnchorLabel formats target segment index", () => {
  assert.equal(
    getInsertAnchorLabel([{ id: "seg-2", index: 1 }], "seg-2"),
    "将插入到 #2 之后",
  );
});
