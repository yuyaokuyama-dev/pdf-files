import test from "node:test";
import assert from "node:assert/strict";
import {
  cloudPath, makeScale, measure, formatLength, dimensionGeometry, rectPoints, signedArea,
  smoothPath, createPenFilter, simplify, pointInPolygon, distToSegment, arrowHead, ellipsePath,
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
