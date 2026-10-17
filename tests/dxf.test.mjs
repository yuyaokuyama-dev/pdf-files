import test from "node:test";
import assert from "node:assert/strict";
import { buildDxf, lineWeight, nearestAci, layerName, mtextEscape, mmPerPt } from "../js/dxf.js";

/** DXF を [コード, 値] の並びにして、ENTITIES の図形ごとに分ける */
function parse(text) {
  const lines = text.split("\n");
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) pairs.push([+lines[i], lines[i + 1]]);
  const ents = [];
  let inEnt = false;
  let cur = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === "SECTION" && pairs[i + 1][1] === "ENTITIES") inEnt = true;
    else if (c === 0 && v === "ENDSEC") inEnt = false;
    else if (inEnt && c === 0) {
      cur = { type: v, g: [] };
      ents.push(cur);
    } else if (inEnt && cur) cur.g.push([c, v]);
  }
  const get = (e, code) => e.g.filter(([c]) => c === code).map(([, v]) => v);
  return { pairs, ents, get };
}
const st = { color: "#e11d48", width: 2 };
const base = (shapes, scale = null) => ({ w: 600, h: 800, scale, shapes });
const layers = [{ id: "0", name: "0", color: "#111827", width: 1, visible: true }];

test("単位の換算と y 軸の向き: 縮尺なしは用紙上の mm、y は上向き", () => {
  assert.ok(Math.abs(mmPerPt(base([])) - 25.4 / 72) < 1e-9);
  const r = buildDxf(base([{ id: "a", type: "line", pts: [[0, 800], [72, 700]], style: st }]), layers);
  const { ents, get } = parse(r.text);
  const l = ents.find((e) => e.type === "LINE");
  const [x1, y1, x2, y2] = [10, 20, 11, 21].map((c) => +get(l, c)[0]);
  assert.deepEqual([x1, y1, x2], [0, 0, 25.4]); // 72pt = 1インチ = 25.4mm、下端が y=0
  assert.ok(Math.abs(y2 - (100 * 25.4) / 72) < 1e-3); // 画面で100pt上 = DXFで y が大きい
});
test("縮尺があれば実寸: 1pt=0.1mm の縮尺では 100pt が 1000mm", () => {
  const r = buildDxf(base([{ id: "a", type: "line", pts: [[0, 800], [100, 800]], style: st }], { ptsPerUnit: 0.1, unit: "mm" }), layers);
  const { ents, get } = parse(r.text);
  assert.equal(+get(ents.find((e) => e.type === "LINE"), 11)[0], 1000);
  const m = buildDxf(base([{ id: "a", type: "line", pts: [[0, 800], [100, 800]], style: st }], { ptsPerUnit: 100, unit: "m" }), layers);
  assert.equal(+parse(m.text).get(parse(m.text).ents.find((e) => e.type === "LINE"), 11)[0], 1000); // 100pt = 1m = 1000mm
});
test("図形の種類: 円・楕円・円弧・四角・雲・文字・寸法", () => {
  const shapes = [
    { id: "1", type: "ellipse", pts: [[100, 100], [200, 200]], style: st },
    { id: "2", type: "ellipse", pts: [[100, 300], [200, 350]], style: st },
    { id: "3", type: "arc", pts: [[300, 300], [350, 300]], sweep: 90, style: st },
    { id: "4", type: "rect", pts: [[10, 10], [60, 40]], style: st },
    { id: "5", type: "cloud", pts: [[300, 450], [420, 450], [420, 530], [300, 530]], pitch: 16, style: st },
    { id: "6", type: "text", pts: [[100, 600]], text: "日本語\n2行目", size: 14, style: st },
    { id: "7", type: "dim", pts: [[100, 700], [300, 700]], off: 24, size: 12, text: "2000", endStyle: "arrow", endSize: 6, style: st },
    { id: "8", type: "dimang", pts: [[400, 700], [500, 700], [400, 620]], r: 40, size: 12, style: st },
    { id: "9", type: "image", pts: [[0, 0], [5, 5]] },
  ];
  const r = buildDxf(base(shapes), layers);
  const { ents, get } = parse(r.text);
  const by = (t) => ents.filter((e) => e.type === t);
  assert.equal(by("CIRCLE").length, 1); // 正円(楕円の縦横が同じ)
  assert.equal(by("ELLIPSE").length, 1);
  assert.equal(+get(by("ELLIPSE")[0], 40)[0], 0.5);
  // 円弧: 画面で時計回り90度(右→下)は、DXFでは 270°〜360° の反時計回り
  const a = by("ARC").find((e) => Math.abs(+get(e, 40)[0] - 50 * 25.4 / 72) < 1e-3);
  assert.equal(+get(a, 50)[0], 270);
  assert.equal(+get(a, 51)[0], 0);
  assert.equal(by("LWPOLYLINE")[0] && get(by("LWPOLYLINE")[0], 90)[0], "4");
  const cloud = by("LWPOLYLINE").find((e) => get(e, 42).length > 10);
  assert.ok(cloud && +get(cloud, 42)[0] > 0, "雲は膨らみつきの閉じたポリライン");
  const mt = by("MTEXT").map((e) => get(e, 1)[0]);
  assert.ok(mt.includes("日本語\\P2行目") && mt.includes("2000") && mt.includes("90°"));
  assert.equal(by("SOLID").length, 2 + 2); // 寸法の矢じり2 + 角度寸法の矢じり2
  assert.equal(r.skipped, 1); // 画像
});
test("レイヤー: 名前・色・太さ・線種、図形は ByLayer か個別指定", () => {
  const ls = [
    { id: "0", name: "0", color: "#111827", width: 1, visible: true },
    { id: "L1", name: "壁/外壁", color: "#2563eb", width: 2, dash: "dashdot", visible: true },
    { id: "L2", name: "非表示", color: "#000000", width: 1, visible: false },
  ];
  const shapes = [
    { id: "a", type: "line", pts: [[0, 0], [10, 0]], layer: "L1", bl: ["color", "width", "dash"], style: st },
    { id: "b", type: "line", pts: [[0, 0], [10, 0]], style: { color: "#2563eb", width: 1, dash: "dash" } },
    { id: "c", type: "line", pts: [[0, 0], [10, 0]], layer: "L2", style: st },
  ];
  const r = buildDxf(base(shapes), ls);
  const { ents, get, pairs } = parse(r.text);
  assert.equal(ents.filter((e) => e.type === "LINE").length, 2); // 非表示レイヤーは出さない
  const [a, b] = ents;
  assert.equal(get(a, 8)[0], "壁_外壁");
  assert.equal(get(a, 62).length, 0); // ByLayer: 色・太さ・線種は書かない
  assert.equal(get(a, 370).length, 0);
  assert.equal(get(a, 6).length, 0);
  assert.equal(get(b, 8)[0], "0");
  assert.equal(get(b, 62)[0], String(nearestAci("#2563eb")));
  assert.equal(get(b, 6)[0], "DASHED");
  // LAYER テーブルに全レイヤー、線種は DASHDOT
  const names = [];
  let last0 = "";
  for (const [c, v] of pairs) {
    if (c === 0) last0 = v;
    else if (c === 2 && last0 === "LAYER") names.push(v);
  }
  assert.deepEqual(names, ["0", "壁_外壁", "非表示"]);
  assert.ok(r.text.includes("DASHDOT"));
});
test("ファイルの骨格: ヘッダ・テーブル・ENTITIES・EOF、ハンドルは重ならない", () => {
  const r = buildDxf(base([{ id: "a", type: "line", pts: [[0, 0], [10, 0]], style: st }]), layers);
  assert.match(r.text, /^0\nSECTION\n2\nHEADER\n9\n\$ACADVER\n1\nAC1021\n/);
  assert.ok(r.text.trimEnd().endsWith("0\nEOF"));
  const { pairs } = parse(r.text);
  const hs = pairs.filter(([c]) => c === 5).map(([, v]) => v);
  assert.equal(new Set(hs).size, hs.length);
});
test("補助関数", () => {
  assert.equal(nearestAci("#ff0000"), 1);
  assert.equal(nearestAci("#0000ff"), 5);
  assert.equal(lineWeight(0.5), 18);
  assert.equal(lineWeight(2), 70);
  assert.equal(layerName("a/b:c"), "a_b_c");
  assert.equal(layerName(""), "0");
  assert.equal(mtextEscape("a\\b{c}\nd"), "a\\\\b\\{c\\}\\Pd");
});

test("元PDFの線は別レイヤー「PDF元図」に入る", () => {
  const r = buildDxf({ w: 100, h: 100, shapes: [], scale: null }, [], { pdfPaths: [{ pts: [[0, 0], [50, 0]], closed: false, color: "#000000", width: 1 }, { pts: [[0, 0], [10, 0], [10, 10]], closed: true, color: "#ff0000", width: 0.5 }] });
  assert.equal(r.count, 2);
  assert.ok(r.text.includes("PDF元図"));
  assert.ok(/\nLINE\n/.test(r.text) && /LWPOLYLINE/.test(r.text));
});
