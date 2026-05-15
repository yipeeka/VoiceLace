import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDubbingProjectName,
  buildDubbingSegmentsFromPreview,
  buildTranslatedDubbingScriptPayload,
  collapseWhisperSegments,
  formatTimestamp,
  getDubbingTaskLabel,
  parseTimestampMs,
  renderCuesAsSrt,
  splitSpeakerText,
  stripTimelineText,
  validateEditedSubtitleSrt,
} from "../src/utils/speechRecognitionFormat.js";

test("formatTimestamp formats milliseconds with padding", () => {
  assert.equal(formatTimestamp(3723004), "01:02:03.004");
  assert.equal(formatTimestamp(-1), "00:00:00.000");
});

test("parseTimestampMs accepts dot and comma millisecond separators", () => {
  assert.equal(parseTimestampMs("01:02:03.004"), 3723004);
  assert.equal(parseTimestampMs("00:00:01,2"), 1200);
  assert.equal(parseTimestampMs("bad"), null);
});

test("splitSpeakerText extracts speaker labels and falls back", () => {
  assert.deepEqual(splitSpeakerText("角色A：你好", "旁白"), { speaker: "角色A", text: "你好" });
  assert.deepEqual(splitSpeakerText("没有标签", "旁白"), { speaker: "旁白", text: "没有标签" });
});

test("renderCuesAsSrt preserves existing speaker prefixes", () => {
  const result = renderCuesAsSrt([
    { start_ms: 0, end_ms: 1200, speaker: "角色A", text: "你好" },
    { start_ms: 1300, end_ms: 2500, speaker: "角色B", text: "角色B：来了" },
  ]);
  assert.match(result, /角色A：你好/);
  assert.match(result, /角色B：来了/);
  assert.equal((result.match(/角色B：来了/g) || []).length, 1);
});

test("validateEditedSubtitleSrt normalizes valid SRT and rejects invalid timing", () => {
  const valid = "1\r\n00:00:00,000 --> 00:00:01,000\r\n你好\r\n";
  assert.equal(validateEditedSubtitleSrt(valid), "1\n00:00:00,000 --> 00:00:01,000\n你好\n");
  assert.throws(
    () => validateEditedSubtitleSrt("1\n00:00:02,000 --> 00:00:01,000\n坏时间"),
    /时间轴无效/,
  );
});

test("collapseWhisperSegments joins CJK without spaces and latin with spaces", () => {
  assert.equal(collapseWhisperSegments("你\n好"), "你好");
  assert.equal(collapseWhisperSegments("hello\nworld"), "hello world");
});

test("stripTimelineText removes inline timeline prefixes", () => {
  const value = "[00:00:00.000 --> 00:00:01.000] 角色A：你好";
  assert.equal(stripTimelineText(value), "角色A：你好");
});

test("buildDubbingSegmentsFromPreview maps timeline edits back to ASR segments", () => {
  const result = buildDubbingSegmentsFromPreview({
    alignments: [
      { id: "a", speaker: "旁白", text: "旧文本", start_ms: 0, end_ms: 1000 },
    ],
    previewText: "[00:00:00.000 --> 00:00:01.200] 角色A：新文本",
  });
  assert.deepEqual(result, [
    { id: "a", speaker: "角色A", text: "新文本", start_ms: 0, end_ms: 1200 },
  ]);
});

test("buildDubbingSegmentsFromPreview validates plain text line counts", () => {
  assert.throws(
    () => buildDubbingSegmentsFromPreview({
      alignments: [
        { speaker: "旁白", text: "一", start_ms: 0, end_ms: 1000 },
        { speaker: "旁白", text: "二", start_ms: 1000, end_ms: 2000 },
      ],
      previewText: "只有一行",
    }),
    /普通文本模式需要 2 行/,
  );
});

test("dubbing project helpers build labels names and script payloads", () => {
  assert.equal(getDubbingTaskLabel("polish_only"), "润色配音任务排队中");
  assert.equal(buildDubbingProjectName({ projectName: "", audioFileName: "voice.wav", mode: "passthrough" }), "voice-直通配音");
  const payload = buildTranslatedDubbingScriptPayload({
    payload: { translated_text: "你好", mode: "translate_polish" },
    title: "项目",
    translationMode: "translate_polish",
    translationSource: "openai",
    translationTargetLanguage: "中文",
    translatedSegments: [
      { id: "s1", speaker: "角色A", text: "你好", source_text: "hello", start_ms: 100, end_ms: 900 },
    ],
  });
  assert.equal(payload.title, "项目");
  assert.equal(payload.metadata.dubbing_segment_count, 1);
  assert.equal(payload.segments[0].source_duration_ms, 800);
  assert.equal(payload.segments[0].type, "dialogue");
});
