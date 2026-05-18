import test from "node:test";
import assert from "node:assert/strict";

import { useSpeechRecognitionStore } from "../src/stores/useSpeechRecognitionStore.js";

test("speech recognition store normalizes vocal separation model", () => {
  const store = useSpeechRecognitionStore.getState();
  store.setVocalSeparationEnabled(true);
  store.setVocalSeparationModel("htdemucs_ft");
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationEnabled, true);
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationModel, "htdemucs_ft");

  useSpeechRecognitionStore.getState().setVocalSeparationModel("unknown");
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationModel, "htdemucs");

  useSpeechRecognitionStore.getState().clearResult();
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationEnabled, false);
  assert.equal(useSpeechRecognitionStore.getState().vocalSeparationModel, "htdemucs");
});
