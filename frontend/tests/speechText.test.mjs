import test from "node:test";
import assert from "node:assert/strict";

import { appendSpeechText, replaceSpeechText } from "../src/utils/speechText.js";

test("appendSpeechText appends with blank line", () => {
  const result = appendSpeechText("第一段", "第二段");
  assert.equal(result, "第一段\n\n第二段");
});

test("appendSpeechText returns incoming when base empty", () => {
  const result = appendSpeechText("", "  第二段  ");
  assert.equal(result, "第二段");
});

test("replaceSpeechText trims text", () => {
  const result = replaceSpeechText("  说话人1：测试  ");
  assert.equal(result, "说话人1：测试");
});
