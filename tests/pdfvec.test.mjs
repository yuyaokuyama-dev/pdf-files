import test from "node:test";
import assert from "node:assert/strict";
import { extractVectorPaths } from "../js/pdfvec.js";

const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, setLineWidth: 2, setStrokeRGBColor: 58, constructPath: 91, stroke: 20, closeStroke: 21, fill: 22, fillStroke: 24, closeFillStroke: 26 };
const VT = [1, 0, 0, -1, 0, 100]; // y 反転(高さ100)
const ol = (items) => ({ fnArray: items.map((i) => i[0]), argsArray: items.map((i) => i[1]) });
const path = (paint, data) => [OPS.constructPath, [paint, [Float32Array.from(data)], null]];

test("線: 色・太さ・座標(y反転)", () => {
  const r = extractVectorPaths(ol([[OPS.setStrokeRGBColor, ["#ff0000"]], [OPS.setLineWidth, [2]], path(OPS.stroke, [0, 10, 10, 1, 60, 10])]), OPS, VT);
  assert.equal(r.paths.length, 1);
  assert.deepEqual(r.paths[0].pts, [[10, 90], [60, 90]]);
  assert.equal(r.paths[0].color, "#ff0000");
  assert.equal(r.paths[0].width, 2);
  assert.equal(r.paths[0].closed, false);
});

test("塗りだけの図形は対象外、塗り+線と閉じる線は対象", () => {
  const sq = [0, 0, 0, 1, 10, 0, 1, 10, 10, 4];
  const r = extractVectorPaths(ol([path(OPS.fill, sq), path(OPS.fillStroke, sq), path(OPS.closeStroke, [0, 0, 0, 1, 5, 5])]), OPS, VT);
  assert.equal(r.paths.length, 2);
  assert.equal(r.paths[0].closed, true);
  assert.equal(r.paths[1].closed, true);
});

test("transform・save/restore・フォームの行列と線幅の拡大", () => {
  const r = extractVectorPaths(ol([
    [OPS.save, []], [OPS.transform, [2, 0, 0, 2, 5, 0]], [OPS.setLineWidth, [1]],
    path(OPS.stroke, [0, 0, 0, 1, 10, 0]),
    [OPS.restore, []],
    path(OPS.stroke, [0, 0, 0, 1, 10, 0]),
    [OPS.paintFormXObjectBegin, [[1, 0, 0, 1, 0, 20], null]], path(OPS.stroke, [0, 0, 0, 1, 1, 0]), [OPS.paintFormXObjectEnd, []],
  ]), OPS, VT);
  assert.deepEqual(r.paths[0].pts, [[5, 100], [25, 100]]);
  assert.equal(r.paths[0].width, 2);
  assert.deepEqual(r.paths[1].pts, [[0, 100], [10, 100]]);
  assert.deepEqual(r.paths[2].pts, [[0, 80], [1, 80]]);
});

test("曲線は折れ線にし、上限で打ち切る", () => {
  const c = extractVectorPaths(ol([path(OPS.stroke, [0, 0, 0, 2, 0, 10, 10, 10, 10, 0])]), OPS, VT, { curveSteps: 4 });
  assert.equal(c.paths[0].pts.length, 5);
  const many = extractVectorPaths(ol(Array.from({ length: 10 }, () => path(OPS.stroke, [0, 0, 0, 1, 1, 1]))), OPS, VT, { maxPaths: 3 });
  assert.equal(many.paths.length, 3);
  assert.equal(many.truncated, true);
});
