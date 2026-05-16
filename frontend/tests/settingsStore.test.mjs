import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeOrchestratorConfig,
  toOrchestratorPayload,
} from "../src/stores/useSettingsStore.js";

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
