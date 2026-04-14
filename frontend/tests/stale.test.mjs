import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRecommendedRegenerateIds,
  buildStaleTargetIds,
  getSegmentStaleLabel,
  resolveSegmentDisplayStatus,
} from "../src/utils/stale.js";

test("buildStaleTargetIds merges and deduplicates stale/missing ids", () => {
  const ids = buildStaleTargetIds({
    stale_segment_ids: ["a", "b"],
    missing_segment_ids: ["b", "c"],
  });
  assert.deepEqual(ids, ["b", "c", "a"]);
});

test("buildStaleTargetIds handles empty or invalid report", () => {
  assert.deepEqual(buildStaleTargetIds(null), []);
  assert.deepEqual(buildStaleTargetIds({}), []);
});

test("resolveSegmentDisplayStatus prefers stale and missing status", () => {
  assert.equal(resolveSegmentDisplayStatus("done", "stale"), "stale");
  assert.equal(resolveSegmentDisplayStatus("done", "missing"), "missing");
  assert.equal(resolveSegmentDisplayStatus("running", "ready"), "running");
});

test("buildRecommendedRegenerateIds prefers edited/missing segments", () => {
  const ids = buildRecommendedRegenerateIds({
    items: [
      { segment_id: "seg-1", status: "stale", reasons: ["synthesis_config_changed"] },
      { segment_id: "seg-2", status: "stale", reasons: ["text_changed"] },
      { segment_id: "seg-3", status: "missing", reasons: ["missing_audio"] },
    ],
  });
  assert.deepEqual(ids, ["seg-2", "seg-3"]);
});

test("getSegmentStaleLabel maps report item to user-facing label", () => {
  assert.equal(getSegmentStaleLabel({ status: "missing", reasons: ["missing_audio"] }), "缺失音频");
  assert.equal(getSegmentStaleLabel({ status: "stale", reasons: ["text_changed"] }), "已修改待重新生成");
  assert.equal(getSegmentStaleLabel({ status: "stale", reasons: ["synthesis_config_changed"] }), "配置变化待重新生成");
  assert.equal(getSegmentStaleLabel({ status: "ready", reasons: [] }), "已同步");
});
