import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeSnapPoints, collectSnapPoints, nearestSnap, segmentIntersection, polarOf, pointAt, polarSnap } from "../js/snap.js";

const line = (id, a, b) => ({ id, type: "line", pts: [a, b] });
const near = (a, b, t = 1e-6) => Math.abs(a - b) < t;

test("線の端点と中点", () => {
  const p = shapeSnapPoints(line("a", [0, 0], [10, 0]));
  assert.equal(p.filter((q) => q.kind === "end").length, 2);
  assert.deepEqual(p.find((q) => q.kind === "mid").p, [5, 0]);
});
test("四角: 角4・中点4・中心", () => {
  const p = shapeSnapPoints({ id: "r", type: "rect", pts: [[0, 0], [10, 20]] });
  assert.equal(p.filter((q) => q.kind === "end").length, 4);
  assert.equal(p.filter((q) => q.kind === "mid").length, 4);
  assert.deepEqual(p.find((q) => q.kind === "center").p, [5, 10]);
});
test("楕円: 中心と四半円点", () => {
  const p = shapeSnapPoints({ id: "e", type: "ellipse", pts: [[0, 0], [20, 10]] });
  assert.deepEqual(p.find((q) => q.kind === "center").p, [10, 5]);
  assert.equal(p.filter((q) => q.kind === "quad").length, 4);
});
test("ペン・文字・画像は対象外", () => {
  for (const type of ["pen", "text", "image"]) assert.equal(shapeSnapPoints({ id: "x", type, pts: [[0, 0], [1, 1]] }).length, 0);
});
test("線分の交点", () => {
  assert.deepEqual(segmentIntersection([0, 0], [10, 10], [0, 10], [10, 0]), [5, 5]);
  assert.equal(segmentIntersection([0, 0], [1, 0], [0, 1], [1, 1]), null);
  assert.equal(segmentIntersection([0, 0], [1, 1], [5, 0], [5, 10]), null);
});
test("collect: 交点・種類の絞り込み・除外", () => {
  const shapes = [line("a", [0, 0], [10, 10]), line("b", [0, 10], [10, 0])];
  const all = collectSnapPoints(shapes);
  assert.ok(all.some((q) => q.kind === "int" && near(q.p[0], 5) && near(q.p[1], 5)));
  assert.equal(collectSnapPoints(shapes, { kinds: ["end"] }).every((q) => q.kind === "end"), true);
  assert.equal(collectSnapPoints(shapes, { exclude: new Set(["a", "b"]) }).length, 0);
});
test("nearestSnap: 半径内で最も近い点", () => {
  const pts = [{ p: [0, 0], kind: "end" }, { p: [5, 0], kind: "end" }];
  assert.deepEqual(nearestSnap(pts, [4, 1], 3).p, [5, 0]);
  assert.equal(nearestSnap(pts, [20, 20], 3), null);
});
test("角度は上向きが正(0=右)", () => {
  assert.ok(near(polarOf([0, 0], [10, 0]).ang, 0));
  assert.ok(near(polarOf([0, 0], [0, -10]).ang, 90));
  const q = pointAt([0, 0], 90, 10);
  assert.ok(near(q[0], 0) && near(q[1], -10));
});
test("極トラッキング: 刻み角に近ければ合わせる", () => {
  const r = polarSnap([0, 0], [100, -2], { step: 15, tol: 3 });
  assert.ok(r.snapped && near(r.ang, 0) && near(r.p[1], 0, 1e-6));
  const r2 = polarSnap([0, 0], [100, -10], { step: 15, tol: 3 });
  assert.equal(r2.snapped, false);
  assert.ok(polarSnap([0, 0], [100, -26], { step: 30, tol: 3 }).snapped === false);
});
test("Shiftの直交ロック: 常に90°刻み", () => {
  const r = polarSnap([0, 0], [100, -40], { lock90: true });
  assert.ok(r.snapped && near(r.ang, 0) && near(r.p[1], 0) && near(r.p[0], Math.hypot(100, 40)));
  const r2 = polarSnap([0, 0], [10, -100], { lock90: true });
  assert.ok(near(r2.ang, 90) && near(r2.p[0], 0, 1e-6));
});

import { DrawAid } from "../js/drawaid.js";
test("スナップを効かせる条件: 既定はCtrl(⌘)中だけ・指では常に・モードalwaysなら常に・OFFなら無効", () => {
  const a = new DrawAid({ emit() {} });
  assert.equal(a.cfg.mode, "ctrl");
  assert.equal(a.snapOn({ pointerType: "mouse" }), false);
  assert.equal(a.snapOn({ pointerType: "mouse", ctrlKey: true }), true);
  assert.equal(a.snapOn({ pointerType: "mouse", metaKey: true }), true);
  assert.equal(a.snapOn({ pointerType: "touch" }), true);
  a.cfg.mode = "always";
  assert.equal(a.snapOn({ pointerType: "mouse" }), true);
  a.cfg.osnap = false;
  assert.equal(a.snapOn({ pointerType: "mouse", ctrlKey: true }), false);
});

test("極トラッキングを効かせる条件: 既定はAlt中だけ・指では常に・モードalwaysなら常に・OFFなら無効", () => {
  const a = new DrawAid({ emit() {} });
  assert.equal(a.cfg.polarMode, "alt");
  assert.equal(a.polarOn({ pointerType: "mouse" }), false);
  assert.equal(a.polarOn({ pointerType: "mouse", altKey: true }), true);
  assert.equal(a.polarOn({ pointerType: "touch" }), true);
  a.cfg.polarMode = "always";
  assert.equal(a.polarOn({ pointerType: "mouse" }), true);
  a.cfg.polar = false;
  assert.equal(a.polarOn({ pointerType: "mouse", altKey: true }), false);
});
