import test from "node:test";
import assert from "node:assert/strict";

import { createTaskChannelBridge } from "../src/utils/taskChannelBridge.js";

test("taskChannelBridge blocks reconnect when status is cancel_requested", () => {
  const state = { status: "cancel_requested" };
  const bridge = createTaskChannelBridge({
    set: () => {},
    getStatus: () => state.status,
    exhaustedMessage: "x",
    timeoutMessage: "y",
  });
  assert.equal(bridge.shouldReconnect(), false);
});

test("taskChannelBridge allows reconnect when status is running", () => {
  const state = { status: "running" };
  const bridge = createTaskChannelBridge({
    set: () => {},
    getStatus: () => state.status,
    exhaustedMessage: "x",
    timeoutMessage: "y",
  });
  assert.equal(bridge.shouldReconnect(), true);
});

test("taskChannelBridge emits reconnect and timeout errors", () => {
  const updates = [];
  const bridge = createTaskChannelBridge({
    set: (patch) => updates.push(patch),
    getStatus: () => "running",
    exhaustedMessage: "reconnect exhausted",
    timeoutMessage: "channel timeout",
  });

  bridge.onReconnectScheduled({ reconnectAttempts: 2, delay: 1500 });
  assert.equal(updates.at(-1).modelStatus.includes("1500ms"), true);

  const exhaustedErr = bridge.onReconnectExhausted();
  assert.equal(exhaustedErr.message, "reconnect exhausted");

  const timeoutErr = bridge.onTimeout();
  assert.equal(timeoutErr.message, "channel timeout");
});
