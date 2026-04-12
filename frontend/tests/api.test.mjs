import test from "node:test";
import assert from "node:assert/strict";

import { api } from "../src/utils/api.js";

function withFetch(mockFetch, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

test("api.get parses JSON success response", async () => {
  await withFetch(
    async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ ok: true }),
    }),
    async () => {
      const data = await api.get("/system/status");
      assert.deepEqual(data, { ok: true });
    },
  );
});

test("api.get maps backend string detail to readable error", async () => {
  await withFetch(
    async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ detail: "bad request body" }),
    }),
    async () => {
      await assert.rejects(
        () => api.get("/x"),
        (error) => error && error.message === "bad request body" && error.status === 400 && error.path === "/x",
      );
    },
  );
});

test("api.get maps backend validation detail list", async () => {
  await withFetch(
    async () => ({
      ok: false,
      status: 422,
      text: async () =>
        JSON.stringify({
          detail: [
            { loc: ["body", "name"], msg: "Field required" },
            { loc: ["body", "age"], msg: "Input should be a valid integer" },
          ],
        }),
    }),
    async () => {
      await assert.rejects(
        () => api.get("/validate"),
        (error) =>
          error &&
          error.status === 422 &&
          error.message.includes("body.name: Field required") &&
          error.message.includes("body.age: Input should be a valid integer"),
      );
    },
  );
});

test("api.get maps unified backend message field", async () => {
  await withFetch(
    async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ message: "service unavailable", code: "http_503" }),
    }),
    async () => {
      await assert.rejects(
        () => api.get("/status"),
        (error) => error && error.status === 503 && error.message === "service unavailable",
      );
    },
  );
});

test("api.uploadFile maps plain text error response", async () => {
  await withFetch(
    async () => ({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    }),
    async () => {
      const fakeFile = new Blob(["x"], { type: "text/plain" });
      await assert.rejects(
        () => api.uploadFile("/voices/upload-ref", fakeFile),
        (error) => error && error.message === "internal server error" && error.status === 500,
      );
    },
  );
});
