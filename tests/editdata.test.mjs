import { test } from "node:test";
import assert from "node:assert/strict";
import { packEdit, unpackEdit, mergeLayers, remapShapes } from "../js/editdata.js";
import { baseLayer } from "../js/layers.js";

test("編集用データは圧縮して戻せる", async () => {
  const payload = { layers: [baseLayer()], pages: [{ shapes: [{ id: "a", type: "line", pts: [[0, 0], [10, 10]] }], scale: null }, null] };
  const packed = await packEdit(payload);
  assert.ok(packed instanceof Uint8Array);
  const back = await unpackEdit(packed);
  assert.deepEqual(back.pages, payload.pages);
  assert.deepEqual(back.layers, payload.layers);
});
test("壊れたデータ・版違いは null", async () => {
  assert.equal(await unpackEdit(new Uint8Array([1, 2, 3])), null);
  const bad = await packEdit({ pages: "x" });
  assert.equal(await unpackEdit(bad), null);
});
test("圧縮で小さくなる", async () => {
  const shapes = Array.from({ length: 500 }, (_, i) => ({ id: "s" + i, type: "line", pts: [[i, i], [i + 14, i]], style: { color: "#e11d48", width: 1 } }));
  const raw = JSON.stringify(shapes).length;
  const packed = await packEdit({ layers: [baseLayer()], pages: [{ shapes, scale: null }] });
  assert.ok(packed.length < raw / 3, `${packed.length} vs ${raw}`);
});
test("レイヤーの取り込み: 同じ名前は共有、idがぶつかれば付け替え", () => {
  const doc = [baseLayer(), { ...baseLayer(), id: "L1", name: "壁" }];
  const inc = [baseLayer(), { ...baseLayer(), id: "L1", name: "壁" }, { ...baseLayer(), id: "L2", name: "窓" }];
  const a = mergeLayers(doc, inc);
  assert.equal(a.layers.length, 3);
  assert.equal(a.idMap.get("L1"), "L1");
  const b = mergeLayers([baseLayer(), { ...baseLayer(), id: "L2", name: "別" }], inc);
  assert.notEqual(b.idMap.get("L2"), "L2"); // 名前が違うのにidが同じ → 新しいid
  assert.ok(b.layers.some((l) => l.name === "窓" && l.id === b.idMap.get("L2")));
});
test("図形のレイヤーidを付け替え、壊れた図形は捨てる", () => {
  const idMap = new Map([["L2", "L9"]]);
  const out = remapShapes([{ id: "a", type: "line", pts: [[0, 0], [1, 1]], layer: "L2" }, { id: "b", type: "line", pts: [[0, 0], [1, 1]], layer: "zzz" }, null, { type: "line" }], idMap);
  assert.equal(out.length, 2);
  assert.equal(out[0].layer, "L9");
  assert.equal(out[1].layer, undefined);
});
