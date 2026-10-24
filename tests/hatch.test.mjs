import test from "node:test";
import assert from "node:assert/strict";
import { hatchSegments, hatchOutline, isHatch, MM } from "../js/hatch.js";

const rect = (style = {}) => ({ id: "r", type: "rect", pts: [[100, 100], [200, 160]], style: { fill: "#ff0000", fillStyle: "lines", ...style } });
const inside = (poly, p, eps = 0.01) => {
  // 外形の外接矩形に収まっているか(四角・丸の確認用)
  const xs = poly.map((q) => q[0]), ys = poly.map((q) => q[1]);
  return p[0] >= Math.min(...xs) - eps && p[0] <= Math.max(...xs) + eps && p[1] >= Math.min(...ys) - eps && p[1] <= Math.max(...ys) + eps;
};

test("ハッチングでない塗り・塗りなしは線を出さない", () => {
  assert.equal(hatchSegments(rect({ fillStyle: "solid" })).length, 0);
  assert.equal(hatchSegments(rect({ fillStyle: undefined })).length, 0);
  assert.equal(hatchSegments(rect({ fill: "none" })).length, 0);
  assert.equal(isHatch({ fillStyle: "cross" }), true);
});

test("四角の斜線: 線は四角の中だけで、間隔が指定どおり", () => {
  const sh = rect({ hatchAngle: 0, hatchGap: 5 }); // 水平線・5mm間隔
  const segs = hatchSegments(sh);
  assert.ok(segs.length > 0);
  const poly = hatchOutline(sh);
  for (const [a, b] of segs) {
    assert.ok(inside(poly, a) && inside(poly, b));
    assert.ok(Math.abs(a[1] - b[1]) < 1e-6, "水平");
    assert.ok(Math.abs(Math.abs(b[0] - a[0]) - 100) < 1e-6, "四角の幅いっぱい");
  }
  const ys = segs.map((s) => s[0][1]).sort((x, y) => x - y);
  for (let i = 1; i < ys.length; i++) assert.ok(Math.abs(ys[i] - ys[i - 1] - 5 * MM) < 1e-6);
  assert.equal(segs.length, Math.floor(160 / (5 * MM)) - Math.ceil(100 / (5 * MM)) + 1);
});

test("格子は斜線の2倍近い本数で、直交する2方向になる", () => {
  const lines = hatchSegments(rect({ hatchAngle: 45, hatchGap: 4 })).length;
  const cross = hatchSegments(rect({ fillStyle: "cross", hatchAngle: 45, hatchGap: 4 }));
  assert.ok(cross.length > lines * 1.8 && cross.length < lines * 2.2, `${lines} ${cross.length}`);
  const dirs = new Set(cross.map(([a, b]) => Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 360) % 180));
  assert.deepEqual([...dirs].sort((x, y) => x - y), [45, 135]);
});

test("丸と多角形の内側だけに引く", () => {
  const ell = { id: "e", type: "ellipse", pts: [[0, 0], [100, 60]], style: { fill: "#00f", fillStyle: "lines", hatchAngle: 30, hatchGap: 2 } };
  for (const [a, b] of hatchSegments(ell)) for (const p of [a, b]) {
    const x = (p[0] - 50) / 50, y = (p[1] - 30) / 30;
    assert.ok(x * x + y * y <= 1.0005, "丸の内側");
  }
  const tri = { id: "t", type: "polygon", pts: [[0, 0], [100, 0], [0, 100]], style: { fill: "#0f0", fillStyle: "lines", hatchAngle: 90, hatchGap: 3 } };
  const segs = hatchSegments(tri);
  assert.ok(segs.length > 5);
  for (const [a, b] of segs) for (const p of [a, b]) assert.ok(p[0] >= -1e-6 && p[1] >= -1e-6 && p[0] + p[1] <= 100 + 1e-6, "三角形の内側");
});

test("へこんだ多角形でも外に線を引かない(偶奇規則)", () => {
  const L = { id: "l", type: "polygon", pts: [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]], style: { fill: "#000", fillStyle: "lines", hatchAngle: 0, hatchGap: 3 } };
  for (const [a, b] of hatchSegments(L)) {
    const y = a[1];
    const mid = (a[0] + b[0]) / 2;
    assert.ok(y >= 0 && y <= 100 && mid >= 0 && mid <= 100);
    if (y > 40) assert.ok(b[0] <= 40 + 1e-6, "L字のへこみに線が出ない");
  }
});

test("間隔が極端に狭くても本数に上限がある", () => {
  const n = hatchSegments(rect({ hatchGap: 0.0001 })).length;
  assert.ok(n <= 3100, String(n));
});
