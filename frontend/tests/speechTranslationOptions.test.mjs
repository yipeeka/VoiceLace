import test from "node:test";
import assert from "node:assert/strict";

import { SPEECH_TRANSLATION_TARGET_LANGUAGE_OPTIONS } from "../src/constants/speechTranslationOptions.js";

test("speech translation target languages keep defaults and add Qwen-friendly common targets", () => {
  const values = SPEECH_TRANSLATION_TARGET_LANGUAGE_OPTIONS.map((option) => option.value);
  assert.deepEqual(values.slice(0, 3), ["中文", "英文", "日文"]);
  for (const language of ["韩文", "法文", "德文", "西班牙文", "葡萄牙文", "俄文", "阿拉伯文", "越南文", "泰文"]) {
    assert.ok(values.includes(language), `${language} should be available`);
  }
});

test("speech translation target language options use stable value labels", () => {
  for (const option of SPEECH_TRANSLATION_TARGET_LANGUAGE_OPTIONS) {
    assert.equal(option.value, option.label);
    assert.ok(option.value);
  }
});
