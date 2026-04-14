import test from "node:test";
import assert from "node:assert/strict";

import { parseCsvList, parseOverridesJson } from "../src/utils/segmentDraft.js";

test("parseCsvList trims and removes empty items", () => {
  assert.deepEqual(parseCsvList(" laugh,  sigh , ,"), ["laugh", "sigh"]);
  assert.deepEqual(parseCsvList(""), []);
});

test("parseOverridesJson validates object JSON", () => {
  const ok = parseOverridesJson('{"speed":1.05}');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { speed: 1.05 });

  const badArray = parseOverridesJson("[1,2,3]");
  assert.equal(badArray.ok, false);

  const badSyntax = parseOverridesJson("{");
  assert.equal(badSyntax.ok, false);
});
