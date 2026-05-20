import test from "node:test";
import assert from "node:assert/strict";

import {
  buildQcDisplayBySegmentId,
  extractQcIssueSegmentIds,
  qcSeverityShortLabel,
} from "../src/utils/parseQcDisplay.js";

test("qcSeverityShortLabel omits the risk suffix", () => {
  assert.equal(qcSeverityShortLabel("high"), "高");
  assert.equal(qcSeverityShortLabel("medium"), "中");
  assert.equal(qcSeverityShortLabel("low"), "低");
  assert.equal(qcSeverityShortLabel("unknown"), "");
});

test("extractQcIssueSegmentIds supports direct ids and evidence items", () => {
  assert.deepEqual(
    extractQcIssueSegmentIds({
      segment_id: "s1",
      segment_ids: ["s2"],
      segments: [{ segment_id: "s3" }, "s4"],
      evidence: { items: [{ segment_id: "s5" }] },
    }),
    ["s1", "s2", "s3", "s4", "s5"],
  );
});

test("buildQcDisplayBySegmentId picks highest severity risk first", () => {
  const display = buildQcDisplayBySegmentId([
    {
      type: "timeline_missing",
      severity: "medium",
      title: "时间轴缺失",
      segment_ids: ["s1", "s2"],
    },
    {
      type: "timeline_invalid",
      severity: "high",
      title: "时间轴非法",
      segment_ids: ["s1"],
    },
    {
      type: "segment_duplicate",
      severity: "low",
      title: "重复片段",
      evidence: { items: [{ segment_id: "s1" }] },
    },
  ]);

  assert.equal(display.severityBySegmentId.s1, "high");
  assert.equal(display.primaryRiskBySegmentId.s1.title, "时间轴非法");
  assert.equal(display.riskCountBySegmentId.s1, 3);
  assert.equal(display.severityBySegmentId.s2, "medium");
  assert.equal(display.primaryRiskBySegmentId.s2.title, "时间轴缺失");
});

test("buildQcDisplayBySegmentId falls back to issue type as title", () => {
  const display = buildQcDisplayBySegmentId([
    {
      type: "timeline_text_overrun",
      severity: "medium",
      segment_ids: ["s1"],
    },
  ]);

  assert.equal(display.primaryRiskBySegmentId.s1.title, "timeline_text_overrun");
  assert.equal(display.highlightBySegmentId.s1, "medium");
});
