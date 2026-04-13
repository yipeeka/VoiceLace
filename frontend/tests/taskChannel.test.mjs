import test from "node:test";
import assert from "node:assert/strict";

import { runTaskChannel } from "../src/utils/taskChannel.js";

class MockWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    MockWebSocket.instances.push(this);
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitClose() {
    this.onclose?.();
  }

  close() {
    this.emitClose();
  }
}

function withMockWebSocket(fn) {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  globalThis.WebSocket = MockWebSocket;
  globalThis.window = globalThis;
  MockWebSocket.instances = [];
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.WebSocket = originalWebSocket;
      globalThis.window = originalWindow;
      MockWebSocket.instances = [];
    });
}

test("runTaskChannel resolves on complete message", async () => {
  await withMockWebSocket(async () => {
    const statuses = [];
    const promise = runTaskChannel({
      wsUrl: "ws://test/complete",
      timeoutMs: 500,
      onConnectionStatus: (s) => statuses.push(s),
      onMessage: ({ msg, done }) => {
        if (msg.type === "complete") {
          done({ ok: true, source: "ws" });
        }
      },
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitMessage({ type: "complete" });
    const result = await promise;
    assert.deepEqual(result, { ok: true, source: "ws" });
    assert.equal(statuses.includes("open"), true);
    assert.equal(statuses.at(-1), "closed");
  });
});

test("runTaskChannel attempts reconnect and can recover via syncTaskState", async () => {
  await withMockWebSocket(async () => {
    let syncCalled = 0;
    const promise = runTaskChannel({
      wsUrl: "ws://test/reconnect",
      timeoutMs: 500,
      baseDelayMs: 0,
      maxReconnectRetries: 2,
      syncTaskState: async ({ done }) => {
        syncCalled += 1;
        done({ ok: true, source: "sync" });
        return true;
      },
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitClose();

    const result = await promise;
    assert.equal(syncCalled, 1);
    assert.deepEqual(result, { ok: true, source: "sync" });
  });
});

test("runTaskChannel rejects on timeout", async () => {
  await withMockWebSocket(async () => {
    await assert.rejects(
      () =>
        runTaskChannel({
          wsUrl: "ws://test/timeout",
          timeoutMs: 5,
          onMessage: () => {},
        }),
      (error) => error && error.message.includes("timeout"),
    );
  });
});

test("runTaskChannel does not reconnect when shouldReconnect returns false", async () => {
  await withMockWebSocket(async () => {
    const statuses = [];
    const promise = runTaskChannel({
      wsUrl: "ws://test/no-reconnect",
      timeoutMs: 30,
      shouldReconnect: () => false,
      onConnectionStatus: (s) => statuses.push(s),
      onMessage: () => {},
    });

    const ws = MockWebSocket.instances[0];
    ws.emitOpen();
    ws.emitClose();

    await assert.rejects(
      () => promise,
      (error) => error && error.message.includes("timeout"),
    );
    assert.equal(MockWebSocket.instances.length, 1);
    assert.equal(statuses.includes("reconnecting"), false);
  });
});

test("runTaskChannel uses custom reconnect exhausted error", async () => {
  await withMockWebSocket(async () => {
    const promise = runTaskChannel({
      wsUrl: "ws://test/exhausted",
      timeoutMs: 100,
      baseDelayMs: 0,
      maxReconnectRetries: 1,
      syncTaskState: async () => false,
      onReconnectExhausted: () => new Error("custom exhausted"),
      onMessage: () => {},
    });

    const first = MockWebSocket.instances[0];
    first.emitOpen();
    first.emitClose();
    await new Promise((r) => setTimeout(r, 0));
    const second = MockWebSocket.instances[1];
    second.emitOpen();
    second.emitClose();

    await assert.rejects(
      () => promise,
      (error) => error && error.message === "custom exhausted",
    );
  });
});
