import { test } from "node:test";
import assert from "node:assert/strict";
import { GROUPS, DEFAULT_PALETTE, normalizePalette, insertTool, removeTool, groupOf } from "../js/toolbar.js";

test("基本パレット: 未設定は初期の並び・知らない機能と重複は除く", () => {
  const known = new Set(["pen", "line", "rect", "text", "eraser", "arrow", "ellipse"]);
  assert.deepEqual(normalizePalette(undefined, known), DEFAULT_PALETTE);
  assert.deepEqual(normalizePalette(["line", "xx", "pen", "line"], known), ["line", "pen"]);
  assert.deepEqual(normalizePalette([], known), []);
});
test("入れる・並べ替える・外す", () => {
  assert.deepEqual(insertTool(["a", "b", "c"], "d", 1), ["a", "d", "b", "c"]);
  assert.deepEqual(insertTool(["a", "b", "c"], "d", 99), ["a", "b", "c", "d"]);
  assert.deepEqual(insertTool(["a", "b", "c"], "c", 0), ["c", "a", "b"]); // idx は自分を除いた並びでの位置
  assert.deepEqual(insertTool(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
  assert.deepEqual(removeTool(["a", "b"], "a"), ["b"]);
});
test("すべての機能がどれかのグループから選べる", () => {
  const all = ["pen", "eraser", "line", "arrow", "rect", "ellipse", "arc", "polygon", "cloud", "text", "leader", "dim", "calib", "measure", "sign", "stamp", "camera"];
  for (const id of all) assert.ok(groupOf(id), id);
  assert.equal(new Set(GROUPS.flatMap((g) => g.tools || [])).size, GROUPS.flatMap((g) => g.tools || []).length);
  for (const id of DEFAULT_PALETTE) assert.ok(groupOf(id), id);
});
