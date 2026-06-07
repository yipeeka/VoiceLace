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

test("ui store prompt dialog resolves entered value", async () => {
  const promise = useUiStore.getState().requestPrompt({
    title: "改名项目",
    label: "项目名称",
    defaultValue: "旧名称",
    confirmLabel: "保存名称",
  });

  const dialog = useUiStore.getState().promptDialog;
  assert.equal(dialog.title, "改名项目");
  assert.equal(dialog.label, "项目名称");
  assert.equal(dialog.defaultValue, "旧名称");
  assert.equal(dialog.confirmLabel, "保存名称");

  useUiStore.getState().resolvePrompt("新名称");
  assert.equal(await promise, "新名称");
  assert.equal(useUiStore.getState().promptDialog, null);
});

test("ui store prompt dialog resolves cancel as null", async () => {
  const promise = useUiStore.getState().requestPrompt({ title: "新建项目" });
  useUiStore.getState().resolvePrompt(null);
  assert.equal(await promise, null);
});
