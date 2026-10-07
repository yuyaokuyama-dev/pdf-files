import test from "node:test";
import assert from "node:assert/strict";
import {
  cloudPath, makeScale, measure, formatLength, dimensionGeometry, rectPoints, signedArea,
  smoothPath, createPenFilter, simplify, pointInPolygon, distToSegment, arrowHead, ellipsePath, arrowSizeOf,
  arcGeometry, arcPath, arcBounds, arcAngleOf, clampSweep, rotateAbout,
} from "../js/geometry.js";

test("rectPoints は時計回り(画面)で面積が正", () => {
  const pts = rectPoints([0, 0], [100, 50]);
  assert.equal(pts.length, 4);
  assert.equal(signedArea(pts), 5000);
});

test("雲マーク: ピッチが小さいほど円弧が増える", () => {
  const pts = rectPoints([0, 0], [100, 100]);
  const arcs = (d) => (d.match(/A/g) || []).length;
  const big = arcs(cloudPath(pts, 40));
  const small = arcs(cloudPath(pts, 10));
  assert.ok(small > big, `${small} > ${big}`);
  assert.equal(big, 12); // 100/40 → round(2.5)=3 弧/辺 ×4辺
  assert.equal(small, 40);
});

test("雲マーク: 時計回り・反時計回りで sweep が反転(常に外側へ膨らむ)", () => {
  const cw = rectPoints([0, 0], [100, 100]);
  const ccw = [...cw].reverse();
  assert.match(cloudPath(cw, 25), / 0 0 1 /);
  assert.match(cloudPath(ccw, 25), / 0 0 0 /);
});

test("雲マーク: 閉じていて頂点数が増えても動作(多角形)", () => {
  const tri = [[0, 0], [120, 0], [60, 100]];
  const d = cloudPath(tri, 16);
  assert.ok(d.startsWith("M0 0"));
  assert.ok(d.endsWith("Z"));
});

test("縮尺: 2点間の実寸から縮尺を作り、別の2点を計測できる", () => {
  const s = makeScale([0, 0], [200, 0], 1000, "mm"); // 200pt = 1000mm
  assert.equal(s.ptsPerUnit, 0.2);
  assert.equal(measure([0, 0], [100, 0], s), 500);
  assert.equal(measure([0, 0], [30, 40], s), 250); // 斜め 50pt → 250mm
  assert.equal(makeScale([0, 0], [0, 0], 100), null);
  assert.equal(makeScale([0, 0], [10, 0], 0), null);
  assert.equal(measure([0, 0], [1, 1], null), null);
});

test("長さの表示形式", () => {
  assert.equal(formatLength(1234.56, "mm"), "1235 mm");
  assert.equal(formatLength(12.34, "mm"), "12.3 mm");
  assert.equal(formatLength(5, "mm"), "5 mm");
  assert.equal(formatLength(2.5, "m"), "2.5 m");
});

test("寸法線: 水平線は角度0、オフセット分だけ平行移動", () => {
  const g = dimensionGeometry([0, 0], [100, 0], 30);
  assert.equal(g.textAngle, 0);
  assert.equal(g.line[0][1], 30);
  assert.equal(g.line[1][0], 100);
  assert.ok(g.textPos[1] < g.line[0][1], "文字は寸法線の上側");
  assert.equal(g.length, 100);
});

test("寸法線: 文字は常に読みやすい向き(-90〜90度)", () => {
  for (const [a, b] of [[[0, 0], [0, 100]], [[100, 0], [0, 0]], [[0, 100], [100, 0]], [[50, 50], [0, 0]]]) {
    const g = dimensionGeometry(a, b, 20);
    assert.ok(g.textAngle > -90 - 1e-9 && g.textAngle <= 90 + 1e-9, String(g.textAngle));
  }
});

test("ペン平滑化: 点列→二次ベジェ、1点でもパスが出る", () => {
  assert.match(smoothPath([[0, 0], [10, 10], [20, 0], [30, 10]]), /^M0 0 Q10 10 15 5 Q20 0 25 5 L30 10$/);
  assert.ok(smoothPath([[5, 5]]).length > 0);
  assert.equal(smoothPath([]), "");
});

test("ペンフィルタ: 微小な動きは捨て、動きには追従する", () => {
  const f = createPenFilter({ smoothing: 0.5, minDist: 1 });
  assert.deepEqual(f.add([0, 0]), [0, 0]);
  assert.equal(f.add([0.5, 0]), null);
  const p = f.add([10, 0]);
  assert.ok(p[0] > 0 && p[0] < 10);
});

test("Douglas-Peucker: 直線上の点は削られる", () => {
  const pts = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];
  assert.equal(simplify(pts).length, 2);
});

test("当たり判定", () => {
  assert.equal(pointInPolygon([5, 5], rectPoints([0, 0], [10, 10])), true);
  assert.equal(pointInPolygon([15, 5], rectPoints([0, 0], [10, 10])), false);
  assert.equal(distToSegment([5, 3], [0, 0], [10, 0]), 3);
  assert.equal(distToSegment([-4, 3], [0, 0], [10, 0]), 5);
});

test("矢じりの先端は tip と一致", () => {
  const h = arrowHead([0, 0], [100, 0], 10);
  assert.deepEqual(h[0], [100, 0]);
  assert.ok(h[1][0] < 100 && h[2][0] < 100);
});

test("楕円パスは閉じている", () => {
  assert.ok(ellipsePath([0, 0], [100, 50]).endsWith("Z"));
});

test("線種: 実線/破線/一点鎖線/二点鎖線のパターン", async () => {
  const { dashArray, normDash } = await import("../js/geometry.js");
  assert.equal(dashArray(false, 1), null);
  assert.equal(dashArray("", 1), null);
  assert.deepEqual(dashArray(true, 2), [6, 4]); // 旧データ(boolean)は破線
  assert.equal(normDash(true), "dash");
  assert.equal(dashArray("dashdot", 1).length, 4);
  assert.equal(dashArray("dashdot2", 1).length, 6);
  assert.deepEqual(dashArray("dash", 0.5), [3, 2]); // 細い線でも潰れない
});

test("寸法線: 端部(黒丸/矢印)・縦寸法は下から上に読み文字は常に線の上側", async () => {
  const { dimensionGeometry } = await import("../js/geometry.js");
  const h = dimensionGeometry([0, 100], [200, 100], 24, 12, { endStyle: "dot", endSize: 6 });
  assert.equal(h.textAngle, 0);
  assert.ok(h.textPos[1] < h.line[0][1], "水平: 文字は線の上");
  assert.deepEqual(h.ends.map((e) => e.type), ["dot", "dot"]);
  assert.equal(h.ends[0].r, 3);
  const a = dimensionGeometry([0, 100], [200, 100], 24, 12, { endStyle: "arrow", endSize: 6 });
  assert.deepEqual(a.ends.map((e) => e.type), ["arrow", "arrow"]);
  // 縦(下向き・上向きどちらで描いても同じ向き)
  for (const pts of [[[100, 0], [100, 200]], [[100, 200], [100, 0]]]) {
    const v = dimensionGeometry(pts[0], pts[1], 24, 12, { endStyle: "dot" });
    assert.equal(v.textAngle, -90);
    // 文字の「上」(= 回転後の上方向)側に文字がある = 線から見て textUp 方向
    const dx = v.textPos[0] - (v.line[0][0] + v.line[1][0]) / 2;
    const dy = v.textPos[1] - (v.line[0][1] + v.line[1][1]) / 2;
    assert.ok(dx * v.textUp[0] + dy * v.textUp[1] > 0, "縦: 文字は寸法線の上側(文字の下に線)");
    assert.ok(Math.abs(v.textUp[0] + 1) < 1e-9, "縦: 文字の上は左向き");
  }
  // 斜めでも文字は読める向き(-90〜90°)で、常に上側
  const d = dimensionGeometry([0, 0], [100, -100], 20, 12, {});
  assert.ok(d.textAngle >= -90 && d.textAngle < 90);
  // 寸法値の移動 → 引き出し線
  const mv = dimensionGeometry([0, 100], [200, 100], 24, 12, { endStyle: "dot", textOff: [30, -40] });
  assert.ok(mv.leader, "移動したら引き出し線");
  assert.equal(mv.leader[1][0], mv.textBase[0]);
  assert.ok(mv.leader[0][0] >= 0 && mv.leader[0][0] <= 200, "引き出し線の起点は寸法線上");
  assert.equal(dimensionGeometry([0, 100], [200, 100], 24, 12, { textOff: [0, 0] }).leader, null);
});

test("矢印のサイズ: 個別指定が優先され、無い従来図形は線の太さに比例", () => {
  assert.equal(arrowSizeOf({ headSize: 25, style: { width: 8 } }), 25);
  assert.equal(arrowSizeOf({ style: { width: 1 } }), 10);
  assert.equal(arrowSizeOf({ style: { width: 4 } }), 18);
  assert.equal(arrowSizeOf({ headSize: 10, style: { width: 8 } }), 10);
});

test("円弧: 半円は中心の反対側で終わり、半径は1つ(正円)", () => {
  const g = arcGeometry([100, 100], [150, 100], 180);
  assert.equal(g.r, 50);
  assert.ok(Math.abs(g.b[0] - 50) < 1e-9 && Math.abs(g.b[1] - 100) < 1e-9);
  assert.ok(Math.abs(g.mid[1] - 150) < 1e-9); // 時計回り(画面)なので下側を通る
  assert.match(arcPath([100, 100], [150, 100], 180), /^M150 100 A50 50 0 0 1 50 100$/);
});

test("円弧: 3/4円は大きい弧フラグ、直線①②の表示切り替え", () => {
  assert.match(arcPath([0, 0], [10, 0], 270), / A10 10 0 1 1 /);
  assert.ok(arcPath([0, 0], [10, 0], 90, { r1: true }).startsWith("M0 0 L10 0 A"));
  assert.ok(arcPath([0, 0], [10, 0], 90, { r2: true }).endsWith("L0 0"));
  assert.ok(arcPath([0, 0], [10, 0], 90, { r1: true, r2: true }).endsWith("L0 0 Z"));
  assert.ok(!/L/.test(arcPath([0, 0], [10, 0], 90)));
});

test("円弧: 外接枠は弧が通る範囲だけ(直線を出すと中心も含む)", () => {
  const b = arcBounds([0, 0], [10, 0], 90);
  assert.deepEqual([b.x, b.y, b.w, b.h].map((v) => +v.toFixed(6)), [0, 0, 10, 10]);
  const h = arcBounds([0, 0], [0, -10], 180); // 上 → 右 → 下
  assert.ok(Math.abs(h.x) < 1e-9 && Math.abs(h.w - 10) < 1e-9 && Math.abs(h.h - 20) < 1e-9);
  const q = arcBounds([0, 0], [10, 0], 45, { r1: true });
  assert.ok(Math.abs(q.x) < 1e-9 && Math.abs(q.y) < 1e-9);
});

test("円弧: 開き角の範囲と角度計算・回転", () => {
  assert.equal(clampSweep(0), 1);
  assert.equal(clampSweep(400), 359);
  assert.equal(clampSweep("x"), 180);
  assert.ok(Math.abs(arcAngleOf([0, 0], [10, 0], [0, 10]) - 90) < 1e-9);
  assert.ok(Math.abs(arcAngleOf([0, 0], [10, 0], [0, -10]) - 270) < 1e-9);
  const p = rotateAbout([10, 0], [0, 0], 90);
  assert.ok(Math.abs(p[0]) < 1e-9 && Math.abs(p[1] - 10) < 1e-9);
});

test("eraseStroke: 触れていなければ null", async () => {
  const { eraseStroke } = await import("../js/geometry.js");
  assert.equal(eraseStroke([[0, 0], [100, 0]], [50, 30], [50, 30], 10), null);
});

test("eraseStroke: 中央を円で消すと2本に分かれ、切れ目は円の境界", async () => {
  const { eraseStroke } = await import("../js/geometry.js");
  const r = eraseStroke([[0, 0], [100, 0]], [50, 0], [50, 0], 10);
  assert.equal(r.length, 2);
  const endA = r[0][r[0].length - 1], startB = r[1][0];
  assert.ok(Math.abs(endA[0] - 40) < 0.01, `left cut ${endA}`);
  assert.ok(Math.abs(startB[0] - 60) < 0.01, `right cut ${startB}`);
  assert.deepEqual(r[0][0], [0, 0]);
  assert.deepEqual(r[1][r[1].length - 1], [100, 0]);
});

test("eraseStroke: 端を消すと1本、全体を覆うと空", async () => {
  const { eraseStroke } = await import("../js/geometry.js");
  const r = eraseStroke([[0, 0], [50, 0], [100, 0]], [100, 0], [100, 0], 10);
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0][r[0].length - 1][0] - 90) < 0.01);
  assert.deepEqual(eraseStroke([[0, 0], [10, 0]], [0, 0], [10, 0], 5), []);
});

test("eraseStroke: なぞった軌跡(線分)が線を横切ると切れる", async () => {
  const { eraseStroke } = await import("../js/geometry.js");
  const r = eraseStroke([[0, 0], [100, 0]], [50, -40], [50, 40], 5);
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0].at(-1)[0] - 45) < 0.01 && Math.abs(r[1][0][0] - 55) < 0.01);
});
