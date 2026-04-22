import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCharacterStats,
  buildSpeakerOptions,
  filterSegmentsBySpeaker,
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

test("pruneSelectedSegmentIds keeps only visible segment ids", () => {
  const visible = [{ segment_id: "a" }, { id: "b" }];
  assert.deepEqual(pruneSelectedSegmentIds(["a", "b", "c"], visible), ["a", "b"]);
});

test("getInsertAnchorLabel formats target segment index", () => {
  assert.equal(
    getInsertAnchorLabel([{ id: "seg-2", index: 1 }], "seg-2"),
    "将插入到 #2 之后",
  );
});
