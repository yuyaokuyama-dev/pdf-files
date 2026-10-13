import test from "node:test";
import assert from "node:assert/strict";
import { moveM, rotateM, scaleM, mirrorM, applyM, transformShape, rectArray, polarArray, offsetShape, offsetPolyline } from "../js/modify.js";

const close = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const closeP = (p, q, t = 1e-6) => close(p[0], q[0], t) && close(p[1], q[1], t);

test("回転: 画面で時計回りに回る", () => {
  assert.ok(closeP(applyM(rotateM([0, 0], 90), [10, 0]), [0, 10]));
  assert.ok(closeP(applyM(rotateM([5, 5], 180), [10, 5]), [0, 5]));
});
test("尺度: 基点は動かない", () => {
  const m = scaleM([10, 10], 2);
  assert.ok(closeP(applyM(m, [10, 10]), [10, 10]));
  assert.ok(closeP(applyM(m, [20, 10]), [30, 10]));
});
test("鏡像: 軸上の点は動かず、反対側へ写る", () => {
  const m = mirrorM([0, 0], [10, 0]);
  assert.ok(closeP(applyM(m, [3, 4]), [3, -4]));
  assert.ok(closeP(applyM(m, [3, 0]), [3, 0]));
  assert.equal(mirrorM([1, 1], [1, 1]), null);
});
test("線は点が写る", () => {
  const s = transformShape({ id: "a", type: "line", pts: [[0, 0], [10, 0]] }, rotateM([0, 0], 90));
  assert.ok(closeP(s.pts[1], [0, 10]));
  assert.equal(s.id, "a");
});
test("四角は90°回しなら四角のまま、斜めなら多角形になる", () => {
  const r = { id: "r", type: "rect", pts: [[0, 0], [20, 10]] };
  assert.equal(transformShape(r, rotateM([0, 0], 90)).type, "rect");
  const t = transformShape(r, rotateM([0, 0], 30));
  assert.equal(t.type, "polygon");
  assert.equal(t.pts.length, 4);
});
test("丸を斜めに回すと多角形(近似)になる。尺度なら丸のまま", () => {
  const e = { id: "e", type: "ellipse", pts: [[0, 0], [20, 10]] };
  assert.equal(transformShape(e, rotateM([0, 0], 45)).type, "polygon");
  const s = transformShape(e, scaleM([0, 0], 2));
  assert.equal(s.type, "ellipse");
  assert.ok(closeP(s.pts[1], [40, 20]));
});
test("円弧: 回転で中心と始点が回り、鏡像で始点と終点が入れ替わる", () => {
  const a = { id: "a", type: "arc", pts: [[0, 0], [10, 0]], sweep: 90 }; // 右 → 下 へ時計回り
  const r = transformShape(a, rotateM([0, 0], 90));
  assert.ok(closeP(r.pts[1], [0, 10]));
  assert.equal(r.sweep, 90);
  const m = transformShape(a, mirrorM([0, 0], [10, 0])); // x軸で鏡像 → 始点は元の終点(0,10)を写した(0,-10)
  assert.ok(closeP(m.pts[1], [0, -10]));
  assert.equal(m.sweep, 90);
});
test("寸法線: 尺度でずらし量も変わり、鏡像で向きが逆になる", () => {
  const d = { id: "d", type: "dim", pts: [[0, 0], [10, 0]], off: 24 };
  assert.equal(transformShape(d, scaleM([0, 0], 2)).off, 48);
  assert.equal(transformShape(d, mirrorM([0, 0], [1, 0])).off, -24);
});
test("文字: 回転で角度が増え、箱の中心が写る", () => {
  const metrics = () => ({ w: 40, h: 20 });
  const t = { id: "t", type: "text", pts: [[100, 100]], text: "x", size: 20 };
  const r = transformShape(t, rotateM([120, 110], 180), { metrics });
  assert.equal(r.angle, 180);
  // 中心 (120,110) は不動 → 回転後の左上は (140,120)
  assert.ok(closeP(r.pts[0], [140, 120]));
});
test("画像は移動できるが、斜めの回転は対象外", () => {
  const im = { id: "i", type: "image", pts: [[0, 0], [10, 10]] };
  assert.ok(transformShape(im, moveM(5, 5)));
  assert.equal(transformShape(im, rotateM([0, 0], 30)), null);
});
test("矩形状配列: 元を除く rows×cols-1 個", () => {
  const ms = rectArray(2, 3, 10, 20);
  assert.equal(ms.length, 5);
  assert.ok(closeP(applyM(ms[ms.length - 1], [0, 0]), [20, 20]));
});
test("円形状配列: 360°ならcount等分、元を除く", () => {
  const ms = polarArray([0, 0], 4, 360);
  assert.equal(ms.length, 3);
  assert.ok(closeP(applyM(ms[0], [10, 0]), [0, 10]));
  const ms2 = polarArray([0, 0], 3, 180); // 端から端まで
  assert.ok(closeP(applyM(ms2[1], [10, 0]), [-10, 0]));
});
test("オフセット: 線は指定した側へ平行にずれる", () => {
  const l = { id: "l", type: "line", pts: [[0, 0], [100, 0]] };
  const up = offsetShape(l, 10, [50, -30]);
  assert.ok(closeP(up.pts[0], [0, -10]) && closeP(up.pts[1], [100, -10]));
  const dn = offsetShape(l, 10, [50, 30]);
  assert.ok(closeP(dn.pts[0], [0, 10]));
});
test("オフセット: 四角・丸は外か内かで大きさが変わる", () => {
  const r = { id: "r", type: "rect", pts: [[0, 0], [100, 50]] };
  assert.deepEqual(offsetShape(r, 5, [200, 200]).pts, [[-5, -5], [105, 55]]);
  assert.deepEqual(offsetShape(r, 5, [50, 25]).pts, [[5, 5], [95, 45]]);
  assert.equal(offsetShape(r, 30, [50, 25]), null); // つぶれる
  const e = { id: "e", type: "ellipse", pts: [[0, 0], [100, 100]] };
  assert.deepEqual(offsetShape(e, 10, [50, 50]).pts, [[10, 10], [90, 90]]);
});
test("オフセット: 円弧は半径が変わる", () => {
  const a = { id: "a", type: "arc", pts: [[0, 0], [10, 0]], sweep: 90 };
  const o = offsetShape(a, 5, [30, 0]);
  assert.ok(closeP(o.pts[1], [15, 0]));
  const i = offsetShape(a, 5, [1, 0]);
  assert.ok(closeP(i.pts[1], [5, 0]));
});
test("オフセット: 多角形の角はマイターで結ぶ", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const out = offsetPolyline(sq, 1, -1, true); // この向きの法線は外側
  const xs = out.map((p) => p[0]);
  const ys = out.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  assert.ok((close(w, 12) && close(h, 12)) || (close(w, 8) && close(h, 8)));
  const poly = offsetShape({ id: "p", type: "polygon", pts: sq }, 1, [5, 5]);
  const w2 = Math.max(...poly.pts.map((p) => p[0])) - Math.min(...poly.pts.map((p) => p[0]));
  assert.ok(close(w2, 8)); // 内側
  assert.ok(close(Math.max(...offsetShape({ id: "p", type: "polygon", pts: sq }, 1, [50, 5]).pts.map((p) => p[0])) - Math.min(...offsetShape({ id: "p", type: "polygon", pts: sq }, 1, [50, 5]).pts.map((p) => p[0])), 12));
});
