import test from "node:test";
import assert from "node:assert/strict";
import { angleBetween, angleLabel, angleDimGeometry, chainDims, circleDimPts, defaultAngleRadius } from "../js/dimx.js";

const close = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const closeP = (p, q, t = 1e-6) => close(p[0], q[0], t) && close(p[1], q[1], t);

test("角度: 直角は90、向きに関係なく0〜180", () => {
  assert.ok(close(angleBetween([0, 0], [10, 0], [0, 10]), 90));
  assert.ok(close(angleBetween([0, 0], [0, 10], [10, 0]), 90));
  assert.ok(close(angleBetween([0, 0], [10, 0], [-10, 0]), 180));
  assert.ok(close(angleBetween([0, 0], [10, 0], [10, 10]), 45));
  assert.equal(angleBetween([0, 0], [0, 0], [1, 1]), null);
});
test("角度の文字: 整数は小数なし", () => {
  assert.equal(angleLabel(90), "90°");
  assert.equal(angleLabel(37.46), "37.5°");
});
test("角度寸法: 弧の端は2本の線上、文字は弧の外側", () => {
  const g = angleDimGeometry([[0, 0], [100, 0], [0, 100]], 40);
  assert.ok(closeP(g.p0, [40, 0]) && closeP(g.p1, [0, 40]));
  assert.equal(g.label, "90°");
  assert.ok(Math.hypot(g.textPos[0], g.textPos[1]) > 40);
  assert.ok(g.textPos[0] > 0 && g.textPos[1] > 0); // 2本の線の間(右下)
  assert.match(g.arc, /^M40 0 A40 40 0 0 1 0 40$/); // 画面で時計回り(右→下)
  assert.equal(g.ends.length, 2);
  assert.equal(angleDimGeometry([[0, 0], [0, 0], [1, 1]], 10), null);
});
test("角度寸法: 逆向きなら反時計回りの弧", () => {
  const g = angleDimGeometry([[0, 0], [0, 100], [100, 0]], 40);
  assert.match(g.arc, /^M0 40 A40 40 0 0 0 40 0$/);
});
test("角度寸法: 黒丸の端部", () => {
  const g = angleDimGeometry([[0, 0], [100, 0], [0, 100]], 40, 12, { endStyle: "dot", endSize: 6 });
  assert.ok(g.ends.every((e) => e.type === "dot"));
});
test("初期の円弧半径は短いほうの線から決まり、範囲に収まる", () => {
  assert.equal(defaultAngleRadius([0, 0], [10, 0], [0, 10]), 16);
  assert.ok(close(defaultAngleRadius([0, 0], [100, 0], [0, 200]), 55));
  assert.equal(defaultAngleRadius([0, 0], [1000, 0], [0, 1000]), 160);
});
test("直列寸法: 隣どうし。同じ向きの寸法線は1本の直線上にそろう", () => {
  const ds = chainDims([[0, 0], [100, 0], [250, 0]], "series", 24);
  assert.equal(ds.length, 2);
  assert.deepEqual(ds[0].pts, [[0, 0], [100, 0]]);
  assert.equal(ds[0].off, 24);
  assert.equal(ds[1].off, 24);
  // 段差のある測点でも、寸法線は最初と同じ直線(y=0 基準で off 24)になる
  const e = chainDims([[0, 0], [100, 0], [250, 30]], "series", 24);
  assert.ok(close(e[1].off, 24 + ((0 - 0) * 0 + (0 - 0) * 1))); // 向きが違うので既定のまま
});
test("直列寸法: 途中の点が基準線からずれていると、ずれを打ち消す", () => {
  // 最初の2点は水平。3点目は y=10 にあるが、次の測点との組(同じ水平)は寸法線を y=0+24 にそろえる
  const ds = chainDims([[0, 0], [100, 0], [100, 10], [200, 10]], "series", 24);
  // 3つ目の寸法: A=(100,10) → B=(200,10) 水平。基準 (0,0) との法線方向の差 = (0-100)*0 + (0-10)*1 = -10 → off = 24 - 10 = 14
  assert.ok(close(ds[2].off, 14));
});
test("並列寸法: 最初の点から各点へ、寸法線を段ごとに外へ", () => {
  const ds = chainDims([[0, 0], [100, 0], [250, 0], [400, 0]], "parallel", 24, 12);
  assert.equal(ds.length, 3);
  assert.deepEqual(ds[2].pts, [[0, 0], [400, 0]]);
  assert.ok(close(ds[1].off - ds[0].off, 26.4));
  assert.deepEqual(chainDims([[0, 0]], "series"), []);
});
test("半径・直径寸法の2点", () => {
  const r = circleDimPts([100, 100], 50, [200, 100], "radius");
  assert.deepEqual(r, [[100, 100], [150, 100]]);
  const d = circleDimPts([100, 100], 50, [100, 0], "diameter");
  assert.ok(closeP(d[0], [100, 150]) && closeP(d[1], [100, 50]));
});

import { leaderTipShape } from "../js/dimx.js";
test("寸法値の引出線の先端: 黒丸・矢印・なし", () => {
  const l = [[0, 0], [30, 0]];
  assert.deepEqual(leaderTipShape(l, "dot", 6), { type: "dot", c: [0, 0], r: 3 });
  assert.equal(leaderTipShape(l, "arrow", 6).type, "arrow");
  assert.equal(leaderTipShape(l, "none", 6), null);
  assert.equal(leaderTipShape(null, "dot"), null);
});

test("寸法の数値の測り直し: 縮尺あり・なし、R/⌀ の頭は残す", async () => {
  const { dimValueText, refreshedDimText } = await import("../js/dimx.js");
  const sc = { ptsPerUnit: 0.1, unit: "mm" };
  assert.equal(dimValueText(100, null), "100");
  assert.equal(dimValueText(100, sc), "1000");
  assert.equal(refreshedDimText("3600", 36, sc), "360");
  assert.equal(refreshedDimText("R50", 10, sc), "R100");
  assert.equal(refreshedDimText("⌀80", 20, null), "⌀20");
  assert.equal(refreshedDimText("", 20, null), "");
});
