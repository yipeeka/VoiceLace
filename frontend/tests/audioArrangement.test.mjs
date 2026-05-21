import test from "node:test";
import assert from "node:assert/strict";

import {
  buildArrangementDraft,
  buildScriptSegmentsWithArrangement,
  getArrangementWarnings,
  moveArrangementSegment,
  resizeArrangementSegment,
} from "../src/utils/audioArrangement.js";

const baseSegments = [
  {
    segment_id: "a",
    index: 0,
    speaker: "narrator",
    text: "A",
    duration_ms: 1000,
  },
  {
    segment_id: "b",
    index: 1,
    speaker: "alice",
    text: "B",
    duration_ms: 1500,
  },
];

test("buildArrangementDraft creates a sequential timeline by default", () => {
  const draft = buildArrangementDraft({ segments: baseSegments, gapDurationMs: 300 });

  assert.equal(draft.segments[0].startMs, 0);
  assert.equal(draft.segments[0].endMs, 1000);
  assert.equal(draft.segments[1].startMs, 1300);
  assert.equal(draft.segments[1].endMs, 2800);
});

test("buildArrangementDraft uses source timing when timeline lock is active", () => {
  const draft = buildArrangementDraft({
    useSourceTimeline: true,
    segments: [
      { ...baseSegments[0], source_start_ms: 5000, source_end_ms: 6400, source_duration_ms: 1400 },
      baseSegments[1],
    ],
  });

  assert.equal(draft.segments[0].startMs, 5000);
  assert.equal(draft.segments[0].endMs, 6400);
  assert.equal(draft.segments[1].startMs, 6400);
});

test("moveArrangementSegment shifts start and end together", () => {
  const draft = buildArrangementDraft({ segments: baseSegments, gapDurationMs: 300 });
  const moved = moveArrangementSegment(draft, "b", 425);

  assert.equal(moved.segments[1].startMs, 1750);
  assert.equal(moved.segments[1].endMs, 3250);
});

test("resizeArrangementSegment changes duration without crossing minimum duration", () => {
  const draft = buildArrangementDraft({ segments: baseSegments, gapDurationMs: 300 });
  const resizedEnd = resizeArrangementSegment(draft, "a", "end", 450);
  assert.equal(resizedEnd.segments[0].endMs, 1450);
  assert.equal(resizedEnd.segments[0].durationMs, 1450);

  const resizedStart = resizeArrangementSegment(resizedEnd, "a", "start", 1300);
  assert.equal(resizedStart.segments[0].startMs, 1150);
  assert.equal(resizedStart.segments[0].durationMs, 300);
});

test("buildScriptSegmentsWithArrangement writes source timing fields", () => {
  const draft = buildArrangementDraft({ segments: baseSegments, gapDurationMs: 300 });
  const moved = moveArrangementSegment(draft, "b", 700);
  const nextSegments = buildScriptSegmentsWithArrangement([
    { id: "a", index: 0, speaker: "narrator", text: "A" },
    { id: "b", index: 1, speaker: "alice", text: "B" },
  ], moved);

  assert.equal(nextSegments[1].source_start_ms, 2000);
  assert.equal(nextSegments[1].source_end_ms, 3500);
  assert.equal(nextSegments[1].source_duration_ms, 1500);
});

test("getArrangementWarnings reports overlaps", () => {
  const draft = buildArrangementDraft({ segments: baseSegments, gapDurationMs: 300 });
  const moved = moveArrangementSegment(draft, "b", -600);
  const warnings = getArrangementWarnings(moved);

  assert.match(warnings.a.join(","), /下一段/);
  assert.match(warnings.b.join(","), /上一段/);
});
