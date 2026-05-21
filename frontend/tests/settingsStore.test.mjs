import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeOrchestratorConfig,
  toOrchestratorPayload,
} from "../src/stores/useSettingsStore.js";
import {
  getPageUnloadEndpoint,
  isAutoSerialEnabled,
} from "../src/utils/modelLifecycle.js";

test("settings store preserves OpenAI-compatible config fields", () => {
  const normalized = normalizeOrchestratorConfig({
    llm_backend: "openai_compatible",
    openai_api_key: "sk-openai",
    openai_base_url: "https://api.example.test/v1",
    openai_model: "gpt-test",
    openai_compatible_api_key: "sk-compatible",
    openai_compatible_base_url: "http://localhost:11434/v1",
    openai_compatible_model: "qwen-test",
    gemini_api_key: "gemini-key",
    gemini_base_url: "https://generativelanguage.googleapis.com",
    gemini_model: "gemini-test",
  });

  assert.equal(normalized.llm_backend, "openai_compatible");
  assert.equal(normalized.openai_api_key, "sk-openai");
  assert.equal(normalized.openai_base_url, "https://api.example.test/v1");
  assert.equal(normalized.openai_model, "gpt-test");
  assert.equal(normalized.openai_compatible_api_key, "sk-compatible");
  assert.equal(normalized.openai_compatible_base_url, "http://localhost:11434/v1");
  assert.equal(normalized.openai_compatible_model, "qwen-test");
  assert.equal(normalized.gemini_api_key, "gemini-key");
  assert.equal(normalized.gemini_base_url, "https://generativelanguage.googleapis.com");
  assert.equal(normalized.gemini_model, "gemini-test");

  const payload = toOrchestratorPayload(normalized);
  assert.equal(payload.openai_api_key, "sk-openai");
  assert.equal(payload.openai_base_url, "https://api.example.test/v1");
  assert.equal(payload.openai_model, "gpt-test");
  assert.equal(payload.openai_compatible_api_key, "sk-compatible");
  assert.equal(payload.openai_compatible_base_url, "http://localhost:11434/v1");
  assert.equal(payload.openai_compatible_model, "qwen-test");
  assert.equal(payload.gemini_api_key, "gemini-key");
  assert.equal(payload.gemini_base_url, "https://generativelanguage.googleapis.com");
  assert.equal(payload.gemini_model, "gemini-test");
});

test("settings store preserves ASR vocal separation config fields", () => {
  const normalized = normalizeOrchestratorConfig({
    asr_vocal_separation_enabled: true,
    asr_vocal_separation_model: "htdemucs_ft",
    asr_vocal_separation_repo_dir: "E:/models/demucs",
    asr_vocal_separation_device: "cuda:1",
  });

  assert.equal(normalized.asr_vocal_separation_enabled, true);
  assert.equal(normalized.asr_vocal_separation_model, "htdemucs_ft");
  assert.equal(normalized.asr_vocal_separation_repo_dir, "E:/models/demucs");
  assert.equal(normalized.asr_vocal_separation_device, "cuda:1");

  const payload = toOrchestratorPayload(normalized);
  assert.equal(payload.asr_vocal_separation_enabled, true);
  assert.equal(payload.asr_vocal_separation_model, "htdemucs_ft");
  assert.equal(payload.asr_vocal_separation_repo_dir, "E:/models/demucs");
  assert.equal(payload.asr_vocal_separation_device, "cuda:1");
});

test("settings store preserves Qwen3 ASR preview line length", () => {
  const normalized = normalizeOrchestratorConfig({
    qwen3_asr_preview_max_line_length: 18,
  });

  assert.equal(normalized.qwen3_asr_preview_max_line_length, 18);

  const payload = toOrchestratorPayload(normalized);
  assert.equal(payload.qwen3_asr_preview_max_line_length, 18);
  assert.equal(toOrchestratorPayload({ qwen3_asr_preview_max_line_length: -1 }).qwen3_asr_preview_max_line_length, -1);
  assert.equal(toOrchestratorPayload({ qwen3_asr_preview_max_line_length: "" }).qwen3_asr_preview_max_line_length, -1);
  assert.equal(toOrchestratorPayload({ qwen3_asr_preview_max_line_length: "-" }).qwen3_asr_preview_max_line_length, -1);
  assert.equal(toOrchestratorPayload({ qwen3_asr_preview_max_line_length: 1 }).qwen3_asr_preview_max_line_length, 2);
  assert.equal(toOrchestratorPayload({ qwen3_asr_preview_max_line_length: 120 }).qwen3_asr_preview_max_line_length, 50);
});

test("model lifecycle maps workflow pages to unload endpoints", () => {
  assert.equal(getPageUnloadEndpoint("speech"), "/system/unload-asr");
  assert.equal(getPageUnloadEndpoint("text"), "/system/unload-llm");
  assert.equal(getPageUnloadEndpoint("synth"), "/system/unload-tts");
  assert.equal(getPageUnloadEndpoint("music"), "/system/unload-music");
  assert.equal(getPageUnloadEndpoint("settings"), "");
});

test("model lifecycle reads auto serial from config or system status", () => {
  assert.equal(isAutoSerialEnabled(null, { auto_serial: true }), true);
  assert.equal(isAutoSerialEnabled({ config: { auto_serial: false } }, null), false);
  assert.equal(isAutoSerialEnabled({ auto_serial: true }, null), true);
  assert.equal(isAutoSerialEnabled(null, null), null);
});
