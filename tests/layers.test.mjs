import test from "node:test";
import assert from "node:assert/strict";
import {
  baseLayer, newLayerId, uniqueName, resolveShape, visibleShapes, isLayerLocked, stampNewShape, deleteLayerFrom, normalizeLayers, BASE_LAYER_ID, BL_KEYS,
} from "../js/layers.js";

const mk = () => [baseLayer(), { ...baseLayer(), id: "L1", name: "壁", color: "#ff0000", width: 3, dash: "dashdot" }];

test("基本レイヤー(0)は既定で表示・ロックなし", () => {
  const l = baseLayer();
  assert.equal(l.id, BASE_LAYER_ID);
  assert.equal(l.visible, true);
  assert.equal(l.locked, false);
});

test("新しいレイヤーのidと名前は重ならない", () => {
  const ls = mk();
  assert.equal(newLayerId(ls), "L2");
  ls.push({ ...baseLayer(), id: "L2", name: "レイヤー1" });
  assert.equal(uniqueName(ls), "レイヤー2");
});

test("レイヤーに従う項目だけレイヤーの値になる(元の図形は変えない)", () => {
  const ls = mk();
  const sh = { type: "line", layer: "L1", bl: ["color", "dash"], style: { color: "#00ff00", width: 7, dash: false } };
  const r = resolveShape(sh, ls);
  assert.equal(r.style.color, "#ff0000");
  assert.equal(r.style.dash, "dashdot");
  assert.equal(r.style.width, 7, "太さは個別指定のまま");
  assert.equal(sh.style.color, "#00ff00", "元は変えない");
});

test("文字は color もレイヤーの色になる", () => {
  const r = resolveShape({ type: "text", layer: "L1", bl: ["color"], color: "#000", style: { color: "#000" } }, mk());
  assert.equal(r.color, "#ff0000");
});

test("bl が無い図形は個別指定のまま", () => {
  const sh = { type: "line", layer: "L1", style: { color: "#123456" } };
  assert.equal(resolveShape(sh, mk()), sh);
});

test("非表示レイヤーの図形は出さない", () => {
  const ls = mk();
  ls[1].visible = false;
  const shapes = [{ id: "a", layer: "L1" }, { id: "b" }, { id: "c", layer: "0" }];
  assert.deepEqual(visibleShapes(shapes, ls).map((s) => s.id), ["b", "c"]);
  assert.equal(visibleShapes(shapes, undefined), shapes, "layers 未指定なら何もしない");
});

test("存在しないレイヤーの図形は基本レイヤー扱い", () => {
  const ls = mk();
  assert.equal(isLayerLocked({ layer: "zzz" }, ls), false);
  ls[0].locked = true;
  assert.equal(isLayerLocked({ layer: "zzz" }, ls), true);
});

test("基本レイヤー以外に描くと色・太さ・線種がレイヤーに従う。画像は除く", () => {
  const a = stampNewShape({ type: "line" }, "L1");
  assert.equal(a.layer, "L1");
  assert.deepEqual(a.bl, BL_KEYS);
  const b = stampNewShape({ type: "line", bl: ["color"] }, BASE_LAYER_ID);
  assert.equal(b.bl, undefined);
  assert.equal(stampNewShape({ type: "image" }, "L1").bl, undefined);
});

test("レイヤーの削除は図形も消す。基本レイヤーは消せない", () => {
  const ls = mk();
  const pages = [{ shapes: [{ id: "a", layer: "L1" }, { id: "b" }] }, { shapes: [{ id: "c", layer: "L1" }, { id: "d", layer: "0" }] }];
  assert.equal(deleteLayerFrom(pages, ls, BASE_LAYER_ID), -1);
  assert.equal(deleteLayerFrom(pages, ls, "nope"), -1);
  assert.equal(deleteLayerFrom(pages, ls, "L1"), 2);
  assert.deepEqual(pages.map((p) => p.shapes.map((s) => s.id)), [["b"], ["d"]]);
  assert.deepEqual(ls.map((l) => l.id), ["0"]);
});

test("保存データの読み込み: 無い・壊れていても基本レイヤーが残る", () => {
  assert.deepEqual(normalizeLayers(undefined).map((l) => l.id), ["0"]);
  assert.deepEqual(normalizeLayers([null, { id: 5 }]).map((l) => l.id), ["0"]);
  const ls = normalizeLayers([{ id: "L1", name: "壁", color: "#f00" }, { id: "L1", name: "重複" }]);
  assert.deepEqual(ls.map((l) => l.id), ["0", "L1"]);
  assert.equal(ls[1].width, 1, "足りない項目は既定値");
});
