import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_VERSION } from "../js/version.js";

test("画面に出すバージョンと sw.js の VERSION が一致する", () => {
  const sw = readFileSync("sw.js", "utf8");
  assert.equal(sw.match(/const VERSION = "([^"]+)"/)[1], APP_VERSION);
});
test("sw.js が version.js を事前キャッシュする", () => {
  assert.ok(readFileSync("sw.js", "utf8").includes('"js/version.js"'));
});
