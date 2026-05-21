import test from "node:test";
import assert from "node:assert/strict";

import { useSpeechRecognitionStore } from "../src/stores/useSpeechRecognitionStore.js";

test("speech recognition store normalizes vocal separation model", () => {
  const store = useSpeechRecognitionStore.getState();
  assert.equal(store.silenceAwareSplit, false);
  store.setVocalSeparationEnabled(true);
  store.setVocalSeparationModel("htdemucs_ft");
  store.setSilenceAwareSplit(false);
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationEnabled, true);
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationModel, "htdemucs_ft");
  assert.equal(useSpeechRecognitionStore.getState().silenceAwareSplit, false);

  useSpeechRecognitionStore.getState().setVocalSeparationModel("unknown");
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationModel, "htdemucs");

  useSpeechRecognitionStore.getState().clearResult();
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationEnabled, false);
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationModel, "htdemucs");
  assert.equal(useSpeechRecognitionStore.getState().silenceAwareSplit, false);
});

test("speech recognition store keeps hybrid qwen whisper timeline backend", () => {
  useSpeechRecognitionStore.getState().setAsrBackend("qwen3_text_whisper_timeline");
  assert.equal(useSpeechRecognitionStore.getState().asrBackend, "qwen3_text_whisper_timeline");

  useSpeechRecognitionStore.getState().setAsrBackend("qwen3_crispasr");
  assert.equal(useSpeechRecognitionStore.getState().asrBackend, "qwen3_crispasr");

  useSpeechRecognitionStore.getState().setAsrBackend("unknown");
  assert.equal(useSpeechRecognitionStore.getState().asrBackend, "whisper");
});

test("speech recognition store clamps hybrid preview max line length", () => {
  useSpeechRecognitionStore.getState().setQwen3PreviewMaxLineLength(18);
  assert.equal(useSpeechRecognitionStore.getState().qwen3PreviewMaxLineLength, 18);

  useSpeechRecognitionStore.getState().setQwen3PreviewMaxLineLength(0);
  assert.equal(useSpeechRecognitionStore.getState().qwen3PreviewMaxLineLength, 2);

  useSpeechRecognitionStore.getState().setQwen3PreviewMaxLineLength(120);
  assert.equal(useSpeechRecognitionStore.getState().qwen3PreviewMaxLineLength, 50);
});
