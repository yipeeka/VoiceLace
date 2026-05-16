import test from "node:test";
import assert from "node:assert/strict";

import {
  BPM_OPTIONS,
  MUSIC_CATEGORY_UNCATEGORIZED,
  formatFileSize,
  getDefaultInferenceSteps,
  inferAssetNameFromResult,
  normalizeAssetCategories,
  normalizeNearestNumericOptionValue,
  normalizeSelectOptionValue,
  parseMusicEvent,
  toNumberOrNull,
} from "../src/utils/musicPageData.js";

test("toNumberOrNull parses finite values only", () => {
  assert.equal(toNumberOrNull("12.5"), 12.5);
  assert.equal(toNumberOrNull(""), null);
  assert.equal(toNumberOrNull("nope"), null);
});

test("getDefaultInferenceSteps switches by model variant", () => {
  assert.equal(getDefaultInferenceSteps("base"), 50);
  assert.equal(getDefaultInferenceSteps("turbo"), 8);
  assert.equal(getDefaultInferenceSteps(""), 8);
});

test("normalizeSelectOptionValue matches case-insensitively", () => {
  assert.equal(normalizeSelectOptionValue("BPM", [{ value: "bpm" }], ""), "bpm");
  assert.equal(normalizeSelectOptionValue("", [{ value: "x" }], "fallback"), "fallback");
});

test("normalizeNearestNumericOptionValue chooses nearest numeric option", () => {
  assert.equal(normalizeNearestNumericOptionValue("72", BPM_OPTIONS, ""), "70");
  assert.equal(normalizeNearestNumericOptionValue("118", BPM_OPTIONS, ""), "120");
  assert.equal(normalizeNearestNumericOptionValue("bad", BPM_OPTIONS, "100"), "100");
});

test("formatFileSize uses compact units", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(1536), "1.50 KB");
  assert.equal(formatFileSize(1024 * 1024), "1.00 MB");
});

test("inferAssetNameFromResult supports windows and posix paths", () => {
  assert.equal(inferAssetNameFromResult({ output_path: "C:\\tmp\\song.wav" }), "song.wav");
  assert.equal(inferAssetNameFromResult({ output_path: "/tmp/song.mp3" }), "song.mp3");
});

test("parseMusicEvent accepts JSON strings and objects", () => {
  assert.deepEqual(parseMusicEvent('{"status":"done"}'), { status: "done" });
  assert.deepEqual(parseMusicEvent({ status: "done" }), { status: "done" });
  assert.equal(parseMusicEvent("{"), null);
});

test("normalizeAssetCategories deduplicates and injects uncategorized", () => {
  assert.deepEqual(normalizeAssetCategories([
    { id: "score", name: "配乐" },
    { id: "score", name: "重复" },
    { id: "", name: "空" },
  ]), [
    { id: MUSIC_CATEGORY_UNCATEGORIZED, name: "未分类", builtin: true },
    { id: "score", name: "配乐", builtin: false },
  ]);
});
