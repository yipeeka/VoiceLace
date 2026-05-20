import test from "node:test";
import assert from "node:assert/strict";

import { parseCsvList, parseOverridesJson } from "../src/utils/segmentDraft.js";
import { buildSegmentEditorDraft, normalizeSegmentFromEditorDraft } from "../src/utils/segmentEditorState.js";
import { getSegmentDurationMismatch } from "../src/utils/segmentTiming.js";

test("parseCsvList trims and removes empty items", () => {
  assert.deepEqual(parseCsvList(" laugh,  sigh , ,"), ["laugh", "sigh"]);
  assert.deepEqual(parseCsvList(""), []);
});

test("parseOverridesJson validates object JSON", () => {
  const ok = parseOverridesJson('{"speed":1.05}');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { speed: 1.05 });

  const badArray = parseOverridesJson("[1,2,3]");
  assert.equal(badArray.ok, false);

  const badSyntax = parseOverridesJson("{");
  assert.equal(badSyntax.ok, false);

  const badField = parseOverridesJson('{"temperature":0.3}');
  assert.equal(badField.ok, false);
});

test("normalizeSegmentFromEditorDraft accepts source timing edits within original bounds", () => {
  const draft = buildSegmentEditorDraft({
    id: "seg-1",
    index: 0,
    speaker: "narrator",
    text: "hello",
    type: "dialogue",
    emotion: "neutral",
    non_verbal: [],
    tts_overrides: { duration: 3 },
    source_start_ms: 10_000,
    source_end_ms: 15_000,
    source_duration_ms: 5_000,
  });
  const normalized = normalizeSegmentFromEditorDraft({
    ...draft,
    sourceStartText: "00:00:11.000",
    sourceEndText: "00:00:14.500",
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.source_start_ms, 11_000);
  assert.equal(normalized.value.source_end_ms, 14_500);
  assert.equal(normalized.value.source_duration_ms, 3_500);
});

test("normalizeSegmentFromEditorDraft accepts source timing expanded within adjacent bounds", () => {
  const segments = [
    { id: "prev", index: 0, text: "prev", source_start_ms: 5_000, source_end_ms: 9_500 },
    {
      id: "seg-1",
      index: 1,
      speaker: "narrator",
      text: "hello",
      type: "dialogue",
      emotion: "neutral",
      non_verbal: [],
      tts_overrides: {},
      source_start_ms: 10_000,
      source_end_ms: 15_000,
      source_duration_ms: 5_000,
    },
    { id: "next", index: 2, text: "next", source_start_ms: 15_500, source_end_ms: 18_000 },
  ];
  const draft = buildSegmentEditorDraft(segments[1], { segments });
  const normalized = normalizeSegmentFromEditorDraft({
    ...draft,
    sourceStartText: "00:00:09.500",
    sourceEndText: "00:00:15.500",
  });
  assert.equal(normalized.ok, true);
  assert.equal(normalized.value.source_start_ms, 9_500);
  assert.equal(normalized.value.source_end_ms, 15_500);
  assert.equal(normalized.value.source_duration_ms, 6_000);
});

test("normalizeSegmentFromEditorDraft rejects source timing outside adjacent bounds", () => {
  const segments = [
    { id: "prev", index: 0, text: "prev", source_start_ms: 5_000, source_end_ms: 9_500 },
    {
      id: "seg-1",
      index: 1,
      speaker: "narrator",
      text: "hello",
      type: "dialogue",
      emotion: "neutral",
      non_verbal: [],
      tts_overrides: {},
      source_start_ms: 10_000,
      source_end_ms: 15_000,
      source_duration_ms: 5_000,
    },
    { id: "next", index: 2, text: "next", source_start_ms: 15_500, source_end_ms: 18_000 },
  ];
  const draft = buildSegmentEditorDraft(segments[1], { segments });
  const normalized = normalizeSegmentFromEditorDraft({
    ...draft,
    sourceStartText: "00:00:09.499",
    sourceEndText: "00:00:15.000",
  });
  assert.equal(normalized.ok, false);
  assert.match(normalized.error, /相邻片段边界/);
});

test("getSegmentDurationMismatch flags large target and duration gaps only", () => {
  const large = getSegmentDurationMismatch({
    source_start_ms: 0,
    source_end_ms: 11_730,
    tts_overrides: { duration: 4 },
  });
  assert.equal(large.isMismatch, true);

  const buffered = getSegmentDurationMismatch({
    source_start_ms: 0,
    source_end_ms: 11_730,
    tts_overrides: { duration: 11.63 },
  });
  assert.equal(buffered.isMismatch, false);

  const targetShorter = getSegmentDurationMismatch({
    source_start_ms: 0,
    source_end_ms: 4000,
    tts_overrides: { duration: 5 },
  });
  assert.equal(targetShorter.isMismatch, true);
  assert.equal(targetShorter.direction, "target_shorter");

  const veryShortTarget = getSegmentDurationMismatch({
    source_start_ms: 51_880,
    source_end_ms: 51_960,
    tts_overrides: { duration: 0.3 },
  });
  assert.equal(veryShortTarget.isMismatch, true);
  assert.equal(veryShortTarget.direction, "target_shorter");

  const targetLongerSimilarGap = getSegmentDurationMismatch({
    source_start_ms: 0,
    source_end_ms: 5000,
    tts_overrides: { duration: 4 },
  });
  assert.equal(targetLongerSimilarGap.isMismatch, false);
  assert.equal(targetLongerSimilarGap.direction, "target_longer");
});
