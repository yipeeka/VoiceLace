import test from "node:test";
import assert from "node:assert/strict";

import { initializeLanguage, setLanguage, getLanguage, translate } from "../src/i18n/core.js";

test("initializeLanguage prefers navigator language when no storage", () => {
  Object.defineProperty(globalThis, "navigator", { value: { language: "en-US" }, configurable: true });
  globalThis.document = { documentElement: { lang: "" } };
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
  };

  const language = initializeLanguage();
  assert.equal(language, "en");
  assert.equal(document.documentElement.lang, "en");
});

test("initializeLanguage prefers stored language", () => {
  Object.defineProperty(globalThis, "navigator", { value: { language: "en-US" }, configurable: true });
  globalThis.document = { documentElement: { lang: "" } };
  const store = new Map([["voicelace.language", "zh"]]);
  globalThis.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
  };

  const language = initializeLanguage();
  assert.equal(language, "zh");
  assert.equal(document.documentElement.lang, "zh-CN");
});

test("setLanguage persists and translation resolves placeholders", () => {
  globalThis.document = { documentElement: { lang: "" } };
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    },
  };

  setLanguage("en");
  assert.equal(getLanguage(), "en");
  assert.equal(store.get("voicelace.language"), "en");
  assert.equal(translate("解析 {chunks} 段", { chunks: 3 }, "en"), "Parse 3 seg");
});
