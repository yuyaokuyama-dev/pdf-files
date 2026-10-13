import test from "node:test";
import assert from "node:assert/strict";
import { leaderGeometry, stadiumPath } from "../js/leader.js";

const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;
const base = { type: "leader", pts: [[0, 0], [100, 50]], size: 14, box: "underline", tip: "arrow", tipSize: 8 };

test("文字なしは線と先端だけ", () => {
  const g = leaderGeometry(base, null);
  assert.equal(g.box, null);
  assert.equal(g.textTL, null);
  assert.equal(g.tipShape.type, "arrow");
  assert.deepEqual(g.line[0], [100, 50]);
  assert.ok(Math.hypot(g.line[1][0], g.line[1][1]) > 0 && Math.hypot(g.line[1][0], g.line[1][1]) < 10); // 先端の手前(矢じりの根元)で止まる
});
test("アンダーライン: 線は文字の下の端につながり、文字は線の上に乗る", () => {
  const m = { w: 40, h: 17.5 };
  const g = leaderGeometry(base, m);
  assert.equal(g.dir, 1);
  assert.equal(g.box.type, "underline");
  const [p, q] = g.box.pts;
  assert.deepEqual(p, [100, 50]);
  assert.ok(near(q[1], 50) && q[0] > 100 + m.w);
  assert.ok(g.textTL[1] + m.h <= 50 && g.textTL[0] >= 100);
});
test("先端が右にあれば、文字は左へ伸びる", () => {
  const g = leaderGeometry({ ...base, pts: [[200, 0], [100, 50]] }, { w: 40, h: 17.5 });
  assert.equal(g.dir, -1);
  assert.ok(g.box.pts[1][0] < 100);
  assert.ok(g.textTL[0] + 40 <= 100);
});
test("丸で囲う: 1文字は円、長い文字は長丸。引出線は囲みの高さの中央から出る", () => {
  const one = leaderGeometry({ ...base, box: "circle" }, { w: 8, h: 17.5 });
  assert.equal(one.box.type, "stadium");
  assert.ok(near(one.box.w, one.box.h)); // 円
  assert.ok(near(one.box.y + one.box.h / 2, 50)); // 高さの中央
  assert.ok(near(one.box.x, 100)); // 縁に接する
  const many = leaderGeometry({ ...base, box: "circle" }, { w: 60, h: 17.5 });
  assert.ok(many.box.w > many.box.h);
  // 文字は囲みの中央
  assert.ok(near(many.textTL[0] + 30, many.box.x + many.box.w / 2));
});
test("囲みなし: 文字は端に隣り合う", () => {
  const g = leaderGeometry({ ...base, box: "none" }, { w: 40, h: 17.5 });
  assert.equal(g.box, null);
  assert.ok(near(g.textTL[1] + 17.5 / 2, 50));
});
test("先端: 黒丸・なし", () => {
  const d = leaderGeometry({ ...base, tip: "dot", tipSize: 10 }, null);
  assert.equal(d.tipShape.type, "dot");
  assert.equal(d.tipShape.r, 5);
  assert.deepEqual(d.line, [[100, 50], [0, 0]]);
  assert.equal(leaderGeometry({ ...base, tip: "none" }, null).tipShape, null);
});
test("外接枠は先端・文字・囲みを含む", () => {
  const g = leaderGeometry({ ...base, box: "circle" }, { w: 8, h: 17.5 });
  assert.ok(g.bounds.x <= 0 && g.bounds.y <= 0);
  assert.ok(g.bounds.x + g.bounds.w >= g.box.x + g.box.w);
});
test("丸のパスは閉じた文字列", () => {
  assert.match(stadiumPath({ x: 0, y: 0, w: 30, h: 20 }), /^M.*Z$/);
});
