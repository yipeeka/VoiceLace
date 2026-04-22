import test from "node:test";
import assert from "node:assert/strict";

import { useScriptStore } from "../src/stores/useScriptStore.js";

function resetScriptStore() {
  useScriptStore.setState({
    sourceText: "",
    llmStreamOutput: "",
    parseProgress: 0,
    parseMode: "two_step_pipeline",
    parseStage: "",
    parseStageLabel: "",
    parseStageProgress: 0,
    status: "idle",
    connectionStatus: "idle",
    modelStatus: "",
    lastSyncError: "",
    parseTaskId: null,
    parseStats: null,
    isParsing: false,
    isSaving: false,
    error: "",
    script: {
      title: "",
      source_text: "",
      segments: [],
      characters: [],
      metadata: {},
    },
  });
}

function withWindowStorage(fn) {
  const originalWindow = globalThis.window;
  const storage = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
  return Promise.resolve()
    .then(() => fn(storage))
    .finally(() => {
      globalThis.window = originalWindow;
      resetScriptStore();
    });
}

test("setParseMode accepts read_aloud_single_voice and persists it", async () => {
  await withWindowStorage(async (storage) => {
    useScriptStore.getState().setParseMode("read_aloud_single_voice");
    assert.equal(useScriptStore.getState().parseMode, "read_aloud_single_voice");
    assert.equal(storage.get("beautyvoice.parse_mode"), "read_aloud_single_voice");
  });
});

test("setParseMode normalizes unsupported values back to default", async () => {
  await withWindowStorage(async (storage) => {
    useScriptStore.getState().setParseMode("unknown_mode");
    assert.equal(useScriptStore.getState().parseMode, "two_step_pipeline");
    assert.equal(storage.get("beautyvoice.parse_mode"), "two_step_pipeline");
  });
});
