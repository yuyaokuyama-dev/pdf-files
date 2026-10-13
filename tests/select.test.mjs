import test from "node:test";
import assert from "node:assert/strict";
import { normRect, pickByRect, pickByLasso, segmentHitsRect, shapePolyline } from "../js/select.js";
import { pointInPolygon } from "../js/geometry.js";

const bounds = (pts) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const item = (id, shape) => {
  const poly = shapePolyline(shape);
  return { id, bounds: bounds(poly ? poly.pts : shape.pts), poly };
};

test("normRect は向きに関係なく矩形にする", () => {
  assert.deepEqual(normRect([10, 20], [4, 2]), { x: 4, y: 2, w: 6, h: 18 });
});

test("線分と矩形の交差(内側・横切り・外れ)", () => {
  const r = { x: 0, y: 0, w: 10, h: 10 };
  assert.ok(segmentHitsRect([2, 2], [3, 3], r));
  assert.ok(segmentHitsRect([-5, 5], [15, 5], r));
  assert.ok(!segmentHitsRect([-5, -5], [-1, 20], r));
  assert.ok(!segmentHitsRect([11, 0], [11, 10], r));
});

test("窓: 完全に入る図形だけ。交差: 触れる図形も", () => {
  const items = [
    item("in", { type: "line", pts: [[10, 10], [20, 20]] }),
    item("cross", { type: "line", pts: [[40, 40], [90, 90]] }),
    item("out", { type: "line", pts: [[100, 100], [120, 120]] }),
  ];
  const rect = { x: 0, y: 0, w: 60, h: 60 };
  assert.deepEqual(pickByRect(items, rect, "window"), ["in"]);
  assert.deepEqual(pickByRect(items, rect, "crossing"), ["in", "cross"]);
});

test("交差: 外接枠だけが重なる斜めの線は選ばない", () => {
  // 斜め線 (0,100)-(100,0)。矩形は左上 (0,0)-(30,30)。枠は重なるが線は触れない
  const items = [item("diag", { type: "line", pts: [[0, 100], [100, 0]] })];
  assert.deepEqual(pickByRect(items, { x: 0, y: 0, w: 30, h: 30 }, "crossing"), []);
  assert.deepEqual(pickByRect(items, { x: 40, y: 40, w: 30, h: 30 }, "crossing"), ["diag"]);
});

test("交差: 四角の内側にドラッグが収まっていても辺に触れなければ選ばない", () => {
  const items = [item("r", { type: "rect", pts: [[0, 0], [100, 100]] })];
  assert.deepEqual(pickByRect(items, { x: 40, y: 40, w: 10, h: 10 }, "crossing"), []);
  assert.deepEqual(pickByRect(items, { x: 90, y: 40, w: 20, h: 10 }, "crossing"), ["r"]);
});

test("文字・画像は外接枠で判定する", () => {
  const items = [{ id: "t", bounds: { x: 10, y: 10, w: 30, h: 20 }, poly: null }];
  assert.deepEqual(pickByRect(items, { x: 35, y: 0, w: 20, h: 20 }, "crossing"), ["t"]);
  assert.deepEqual(pickByRect(items, { x: 35, y: 0, w: 20, h: 20 }, "window"), []);
});

test("円弧は弧に沿って判定する(弦の内側だけの矩形は選ばない)", () => {
  // 中心(0,0)・始点(50,0)・半円(下半分: y下向きで時計回り)
  const arc = { type: "arc", pts: [[0, 0], [50, 0]], sweep: 180 };
  const items = [item("arc", arc)];
  assert.deepEqual(pickByRect(items, { x: -10, y: 5, w: 20, h: 20 }, "crossing"), [], "弧(半径50)に届かない中心付近");
  assert.deepEqual(pickByRect(items, { x: -10, y: 40, w: 20, h: 20 }, "crossing"), ["arc"]);
});

test("pointInPolygon", () => {
  const sq = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.ok(pointInPolygon([5, 5], sq));
  assert.ok(!pointInPolygon([15, 5], sq));
});

test("投げ縄: 囲みに完全に入る図形だけ選ぶ", () => {
  const items = [
    item("a", { type: "line", pts: [[10, 10], [20, 20]] }),
    item("b", { type: "line", pts: [[10, 10], [80, 80]] }),
  ];
  const lasso = [[0, 0], [50, 0], [50, 50], [0, 50]];
  assert.deepEqual(pickByLasso(items, lasso), ["a"]);
  assert.deepEqual(pickByLasso(items, [[0, 0], [5, 5]]), [], "点が3つ未満なら何も選ばない");
});
