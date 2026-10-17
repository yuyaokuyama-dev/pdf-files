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

import { trimPolyline, extendPolyline, filletLines, chamferLines, stretchShape, splitPolyline, joinChains, explodeShape } from "../js/modify.js";

test("トリム: 2本の線に挟まれた中央の区間を消すと2つに分かれる", () => {
  const cutters = [[[30, -10], [30, 10]], [[70, -10], [70, 10]]];
  const r = trimPolyline([[0, 0], [100, 0]], cutters, [50, 0]);
  assert.equal(r.length, 2);
  assert.ok(closeP(r[0][1], [30, 0]) && closeP(r[1][0], [70, 0]));
});
test("トリム: 端の区間を消すと1つ残る。交点がなければ null", () => {
  const cutters = [[[30, -10], [30, 10]]];
  const r = trimPolyline([[0, 0], [100, 0]], cutters, [10, 0]);
  assert.equal(r.length, 1);
  assert.ok(closeP(r[0][0], [30, 0]) && closeP(r[0][1], [100, 0]));
  assert.equal(trimPolyline([[0, 0], [100, 0]], [[[500, 0], [500, 10]]], [10, 0]), null);
});
test("トリム: 折れ線も交点で区切れる", () => {
  const r = trimPolyline([[0, 0], [50, 0], [50, 50]], [[[25, -5], [25, 5]]], [10, 0]);
  assert.equal(r.length, 1);
  assert.equal(r[0].length, 3);
  assert.ok(closeP(r[0][0], [25, 0]));
});
test("延長: 端を向きのまま最初の線分まで伸ばす", () => {
  const r = extendPolyline([[0, 0], [50, 0]], [[[100, -10], [100, 10]], [[200, -10], [200, 10]]], [48, 0]);
  assert.ok(closeP(r[1], [100, 0]));
  const r2 = extendPolyline([[0, 0], [50, 0]], [[[-30, -10], [-30, 10]]], [2, 0]);
  assert.ok(closeP(r2[0], [-30, 0]));
  assert.equal(extendPolyline([[0, 0], [50, 0]], [[[100, 10], [100, 20]]], [48, 0]), null);
});
test("フィレット: 半径0で角がそろう。半径ありで接点と円弧ができる", () => {
  const l1 = [[0, 0], [40, 0]]; // 手前で止まった横線
  const l2 = [[100, 100], [100, 20]]; // 縦線(上端 y=20)
  const p1 = [10, 0];
  const p2 = [100, 80];
  const sharp = filletLines(l1, l2, 0, p1, p2);
  assert.ok(closeP(sharp.l1[0], [100, 0]) && closeP(sharp.l2[0], [100, 0]));
  assert.equal(sharp.arc, null);
  // 角 (100,0)、左と下へ伸びる → 内角90°。半径10 → 接点は (90,0) と (100,10)
  const l1b = [[0, 0], [100, 0]];
  const l2b = [[100, 0], [100, 100]];
  const f = filletLines(l1b, l2b, 10, [20, 0], [100, 60]);
  assert.ok(closeP(f.l1[0], [90, 0]) && closeP(f.l2[0], [100, 10]));
  assert.ok(closeP(f.arc.pts[0], [90, 10]));
  assert.ok(close(f.arc.sweep, 90));
  // 半径が大きすぎる
  assert.equal(filletLines(l1b, l2b, 500, [20, 0], [100, 60]), null);
  // 平行
  assert.equal(filletLines([[0, 0], [10, 0]], [[0, 5], [10, 5]], 1, [1, 0], [1, 5]), null);
});
test("フィレット: 円弧の向きは時計回りで接点同士をつなぐ", () => {
  const f = filletLines([[0, 0], [100, 0]], [[100, 0], [100, 100]], 10, [20, 0], [100, 60]);
  const a = f.arc;
  const [c, st] = a.pts;
  const end = [c[0] + (st[0] - c[0]) * Math.cos((a.sweep * Math.PI) / 180) - (st[1] - c[1]) * Math.sin((a.sweep * Math.PI) / 180), c[1] + (st[0] - c[0]) * Math.sin((a.sweep * Math.PI) / 180) + (st[1] - c[1]) * Math.cos((a.sweep * Math.PI) / 180)];
  const ends = [f.l1[0], f.l2[0]];
  const other = closeP(st, ends[0]) ? ends[1] : ends[0];
  assert.ok(closeP(end, other), JSON.stringify({ st, end, ends }));
});
test("面取り: 交点から指定距離で切って斜めの線でつなぐ", () => {
  const r = chamferLines([[0, 0], [100, 0]], [[100, 0], [100, 100]], 10, 20, [20, 0], [100, 60]);
  assert.ok(closeP(r.l1[0], [90, 0]) && closeP(r.l2[0], [100, 20]));
  assert.ok(closeP(r.line[0], [90, 0]) && closeP(r.line[1], [100, 20]));
  assert.equal(chamferLines([[0, 0], [100, 0]], [[100, 0], [100, 100]], 500, 5, [20, 0], [100, 60]), null);
});
test("ストレッチ: 窓に入る頂点だけ動く。全部入っていれば図形ごと動く", () => {
  const w = { x: 90, y: -10, w: 40, h: 20 };
  const l = { id: "l", type: "line", pts: [[0, 0], [100, 0]] };
  const s = stretchShape(l, w, 0, 30, { x: 0, y: 0, w: 100, h: 0 });
  assert.ok(closeP(s.pts[0], [0, 0]) && closeP(s.pts[1], [100, 30]));
  const all = stretchShape(l, { x: -10, y: -10, w: 200, h: 20 }, 5, 5, { x: 0, y: 0, w: 100, h: 0 });
  assert.ok(closeP(all.pts[0], [5, 5]) && closeP(all.pts[1], [105, 5]));
  assert.equal(stretchShape(l, { x: 500, y: 500, w: 10, h: 10 }, 5, 5, { x: 0, y: 0, w: 100, h: 0 }), null);
});
test("ストレッチ: 四角は右の辺を窓で囲むと幅が変わる", () => {
  const r = { id: "r", type: "rect", pts: [[0, 0], [100, 50]] };
  const s = stretchShape(r, { x: 90, y: -10, w: 30, h: 70 }, 25, 0, { x: 0, y: 0, w: 100, h: 50 });
  assert.deepEqual(s.pts, [[0, 0], [125, 50]]);
  assert.equal(stretchShape(r, { x: 90, y: -10, w: 30, h: 20 }, 25, 0, { x: 0, y: 0, w: 100, h: 50 }), null); // 頂点1つだけは対象外
});
test("切断: 点で2つに分かれ、端に近すぎれば null", () => {
  const [a, b] = splitPolyline([[0, 0], [100, 0]], [40, 3]);
  assert.ok(closeP(a[1], [40, 0]) && closeP(b[0], [40, 0]) && closeP(b[1], [100, 0]));
  assert.equal(splitPolyline([[0, 0], [100, 0]], [0.1, 0]), null);
  const [c, d] = splitPolyline([[0, 0], [50, 0], [50, 50]], [50, 20]);
  assert.equal(c.length, 3);
  assert.equal(d.length, 2);
});
test("結合: つながる線をひと続きにし、輪になれば閉じる", () => {
  const r = joinChains([{ id: "a", pts: [[0, 0], [10, 0]] }, { id: "b", pts: [[10, 10], [10, 0]] }, { id: "c", pts: [[50, 50], [60, 60]] }]);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].ids, ["a", "b"]);
  assert.equal(r[0].pts.length, 3);
  const loop = joinChains([{ id: "a", pts: [[0, 0], [10, 0]] }, { id: "b", pts: [[10, 0], [10, 10]] }, { id: "c", pts: [[10, 10], [0, 0]] }]);
  assert.equal(loop.length, 1);
  assert.ok(loop[0].closed);
  assert.equal(loop[0].pts.length, 3);
});
test("分解: 四角は4本の線、ポリラインは区間ごとの線になる", () => {
  const e = explodeShape({ id: "r", type: "rect", pts: [[0, 0], [10, 10]], style: { color: "#f00", fill: "#0f0" } });
  assert.equal(e.length, 4);
  assert.ok(e.every((l) => l.type === "line" && l.style.color === "#f00" && l.style.fill === "none"));
  assert.equal(explodeShape({ id: "p", type: "polyline", pts: [[0, 0], [1, 1], [2, 0]] }).length, 2);
  assert.equal(explodeShape({ id: "l", type: "line", pts: [[0, 0], [1, 1]] }), null);
});

test("角丸め: 四角の1つの角を丸める(角が減って円弧の点が増える)", async () => {
  const { roundCorners } = await import("../js/modify.js");
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const out = roundCorners(sq, true, 20, [1]);
  assert.ok(out.length > 4);
  assert.ok(!out.some((p) => p[0] === 100 && p[1] === 0)); // 元の角は無くなる
  assert.ok(out.some((p) => Math.abs(p[0] - 80) < 0.01 && Math.abs(p[1]) < 0.01)); // 接点
  assert.ok(out.some((p) => Math.abs(p[0] - 100) < 0.01 && Math.abs(p[1] - 20) < 0.01));
  // 弧の中央は角から r(√2-1) だけ内側
  const dmin = Math.min(...out.map((p) => Math.hypot(p[0] - 100, p[1])));
  assert.ok(Math.abs(dmin - 20 * (Math.SQRT2 - 1)) < 0.3, String(dmin));
});
test("角丸め: 全部丸める・半径は辺の半分まで・端や一直線は対象外", async () => {
  const { roundCorners } = await import("../js/modify.js");
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const all = roundCorners(sq, true, 1000, null);
  assert.ok(all.every((p) => p[0] >= -0.01 && p[0] <= 100.01 && p[1] >= -0.01 && p[1] <= 100.01));
  const open = roundCorners([[0, 0], [50, 0], [50, 50]], false, 10, null);
  assert.deepEqual(open[0], [0, 0]);
  assert.deepEqual(open[open.length - 1], [50, 50]);
  assert.equal(roundCorners([[0, 0], [50, 0], [100, 0]], false, 10, null), null);
  assert.equal(roundCorners(sq, true, 0), null);
});

import { trimRing, trimArc } from "../js/modify.js";
test("四角のトリム: 交差する2本のあいだの辺を消すと、残りは開いた1本の折れ線", () => {
  const ring = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const cutters = [[[40, -10], [40, 110]], [[60, -10], [60, 110]]]; // 上辺と下辺の x=40, 60 で交わる縦線2本
  const out = trimRing(ring, cutters, [50, 0]); // 上辺の x=40〜60 を消す
  assert.ok(out);
  assert.ok(closeP(out[0], [60, 0]) && closeP(out.at(-1), [40, 0]));
  assert.equal(out.length, 6); // 60,0 → 100,0 → 100,100 → 0,100 → 0,0 → 40,0
  assert.ok(closeP(out[2], [100, 100]));
});
test("四角のトリム: 交点が1つでは足りない", () => {
  const ring = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.equal(trimRing(ring, [[[50, -10], [50, 50]]], [50, 0]), null);
  assert.equal(trimRing(ring, [], [50, 0]), null);
});
test("四角のトリム: 0 をまたぐ区間(最初の頂点を含む辺)も消せる", () => {
  const ring = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const cutters = [[[0, 40], [-10, 40]], [[40, -10], [40, 10]]]; // 左辺 y=40 と 上辺 x=40
  const out = trimRing(ring, cutters, [0, 0]); // 角(0,0)の付近を消す
  assert.ok(out);
  assert.ok(closeP(out[0], [40, 0]) && closeP(out.at(-1), [0, 40]));
  assert.ok(out.length === 5 && closeP(out[1], [100, 0]));
});
test("円弧のトリム: 途中の交点で区切って、つまんだ側を消す", () => {
  // 中心(0,0)・半径100・右(0°)から時計回りに180°(下半分)。x=0 の縦線で交わる位置は 90°
  const cutters = [[[0, -200], [0, 200]]];
  const keepRight = trimArc([0, 0], 100, 0, 180, cutters, [-80, 60]); // 左側(90°〜180°)を消す
  assert.equal(keepRight.length, 1);
  assert.ok(Math.abs(keepRight[0].u0) < 1e-6 && Math.abs(keepRight[0].sweep - 90) < 0.5);
  const keepLeft = trimArc([0, 0], 100, 0, 180, cutters, [80, 60]);
  assert.ok(Math.abs(keepLeft[0].u0 - 90) < 0.5 && Math.abs(keepLeft[0].sweep - 90) < 0.5);
  assert.equal(trimArc([0, 0], 100, 0, 180, [[[300, -200], [300, 200]]], [80, 60]), null);
});
test("円のトリム: 2点で交わる弦の片側を消すと、残りは1つの円弧", () => {
  const cutters = [[[-200, 0], [200, 0]]]; // 水平線: 円と 0°・180° で交わる
  const out = trimArc([0, 0], 100, 0, 360, cutters, [0, 100]); // 下側(0〜180°)を消す
  assert.equal(out.length, 1);
  assert.ok(Math.abs(out[0].u0 - 180) < 0.5 && Math.abs(out[0].sweep - 180) < 0.5);
  assert.equal(trimArc([0, 0], 100, 0, 360, [[[0, 0], [200, 0]]], [0, 100]), null); // 交点1つでは足りない
});
