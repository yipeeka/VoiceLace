import test from "node:test";
import assert from "node:assert/strict";

import { formatError, getErrorMessage } from "../src/utils/errors.js";

test("getErrorMessage returns fallback for empty values", () => {
  assert.equal(getErrorMessage(undefined, "fallback"), "fallback");
  assert.equal(getErrorMessage(null, "fallback"), "fallback");
});

test("getErrorMessage handles string and Error", () => {
  assert.equal(getErrorMessage("plain error"), "plain error");
  assert.equal(getErrorMessage(new Error("boom")), "boom");
});

test("getErrorMessage handles object with message", () => {
  assert.equal(getErrorMessage({ message: "api failed" }), "api failed");
});

test("formatError joins prefix and resolved message", () => {
  assert.equal(formatError("加载失败", new Error("network")), "加载失败：network");
});
