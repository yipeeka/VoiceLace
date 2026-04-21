import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjectOption,
  getProjectSourceTag,
  getSameNameSiblingProjects,
  shortProjectId,
  toProjectFileDisplayName,
} from "../src/utils/projectToolbar.js";

test("toProjectFileDisplayName trims known project file suffixes", () => {
  assert.equal(toProjectFileDisplayName("demo.bvtproject.json"), "demo");
  assert.equal(toProjectFileDisplayName("demo.json"), "demo");
  assert.equal(toProjectFileDisplayName(" demo "), "demo");
});

test("buildProjectOption keeps label compact and moves file/id to meta", () => {
  const option = buildProjectOption(
    {
      id: "72b3cef4-1234",
      name: "test",
      project_file_name: "test.bvtproject.json",
    },
    "project_file",
  );

  assert.equal(option.label, "test [文件]");
  assert.equal(option.meta, "test · #72b3cef4");
  assert.equal(option.title, "test [文件] · test · #72b3cef4");
});

test("project source tags stay human readable", () => {
  assert.equal(getProjectSourceTag("project_file"), "文件");
  assert.equal(getProjectSourceTag("archive_import"), "ZIP");
  assert.equal(getProjectSourceTag("local"), "本地");
  assert.equal(shortProjectId("abcdef123456"), "abcdef12");
});

test("getSameNameSiblingProjects excludes current project", () => {
  const siblings = getSameNameSiblingProjects(
    [
      { id: "a", name: "金瓶梅" },
      { id: "b", name: "金瓶梅" },
      { id: "c", name: "红楼梦" },
    ],
    { id: "a", name: "金瓶梅" },
  );

  assert.deepEqual(
    siblings.map((item) => item.id),
    ["b"],
  );
});
