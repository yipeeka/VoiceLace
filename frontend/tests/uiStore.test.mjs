import test from "node:test";
import assert from "node:assert/strict";

import { useUiStore } from "../src/stores/useUiStore.js";

test("ui store confirm dialog resolves requested action", async () => {
  const promise = useUiStore.getState().requestConfirm({
    title: "删除项目",
    description: "确认删除？",
    confirmLabel: "删除",
    danger: true,
  });

  const dialog = useUiStore.getState().confirmDialog;
  assert.equal(dialog.title, "删除项目");
  assert.equal(dialog.confirmLabel, "删除");
  assert.equal(dialog.danger, true);

  useUiStore.getState().resolveConfirm(true);
  assert.equal(await promise, true);
  assert.equal(useUiStore.getState().confirmDialog, null);
});

test("ui store confirm dialog resolves cancel", async () => {
  const promise = useUiStore.getState().requestConfirm({ title: "确认操作" });
  useUiStore.getState().resolveConfirm(false);
  assert.equal(await promise, false);
});
