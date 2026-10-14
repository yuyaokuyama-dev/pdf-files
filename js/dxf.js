// DXF書き出し(描いた図形 → DXF)。DOM非依存・node でテスト可能。
// 座標: ページ表示座標(pt, 左上原点, y下向き)→ DXF(y上向き)。縮尺があれば実寸(mm)、なければ用紙上の寸法(mm)。
// 形式は AutoCAD 2007 形式(AC1021, UTF-8)。文字はそのまま日本語で書き、図形は線・ポリライン・円・円弧・楕円・文字(MTEXT)・塗り三角形で表す。
import { dimensionGeometry, dimOpts, arrowHead, arrowShaft, arrowSizeOf, rectPoints, signedArea, formatLength, measure } from "./geometry.js";
import { angleDimGeometry, defaultAngleRadius } from "./dimx.js";
import { leaderGeometry, LEADER_DEFAULT } from "./leader.js";
import { visibleShapes, layerIdOf, BASE_LAYER_ID } from "./layers.js";

const PT_MM = 25.4 / 72;
const UNIT_MM = { mm: 1, cm: 10, m: 1000 };
const deg = (r) => (r * 180) / Math.PI;
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const num = (v) => {
  const s = (+v).toFixed(4);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/** 画面の1ptが DXF の何mmか。縮尺があれば実寸 */
export function mmPerPt(page) {
  const sc = page?.scale;
  if (sc && sc.ptsPerUnit > 0) return (UNIT_MM[sc.unit] ?? 1) / sc.ptsPerUnit;
  return PT_MM;
}

/* ---- 色・線の太さ・線種 ---- */
const ACI = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]], [6, [255, 0, 255]],
  [7, [0, 0, 0]], [8, [128, 128, 128]], [9, [192, 192, 192]],
];
export function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** いちばん近い基本色(ACI)。白に近い色は 7(白/黒) */
export function nearestAci(hex) {
  const c = hexRgb(hex);
  let best = 7;
  let bd = Infinity;
  for (const [i, p] of ACI) {
    const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
const LW = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
/** 線の太さ(pt)→ DXF の線の太さ(1/100mm の規定値のうち近いもの) */
export function lineWeight(widthPt) {
  const v = Math.max(0, widthPt) * PT_MM * 100;
  return LW.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
}
const LTYPES = {
  "": null,
  dash: "DASHED",
  dashdot: "DASHDOT",
  dashdot2: "DIVIDE",
};
const LTYPE_DEFS = [
  ["DASHED", "Dashed", [6, -3]],
  ["DASHDOT", "Dash dot", [6, -2, 0, -2]],
  ["DIVIDE", "Divide", [6, -2, 0, -2, 0, -2]],
];
const ltypeOf = (dash) => LTYPES[dash === true ? "dash" : dash || ""] || null;

/** レイヤー名に使えない文字を置き換える(DXFの規則) */
export function layerName(name) {
  const s = String(name ?? "").replace(/[<>/\\":;?*|=`,]/g, "_").trim();
  return (s || "0").slice(0, 200);
}
/** MTEXT 用に文字をエスケープ(\ { } と改行) */
export function mtextEscape(t) {
  return String(t ?? "").replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\P");
}

/** DXF のグループ(コード・値)を溜める */
class Writer {
  constructor() {
    this.out = [];
    this.h = 0x100;
  }
  add(code, value) {
    this.out.push(String(code), typeof value === "number" ? num(value) : String(value));
  }
  handle() {
    return (this.h++).toString(16).toUpperCase();
  }
  text() {
    return this.out.join("\n") + "\n";
  }
}

/**
 * ページの図形を DXF の文字列にする。
 * page: { w, h, shapes, scale }  layers: 文書のレイヤー  opts.metrics(shape): 文字の大きさ { w, h, lines }(引出線の囲みに使う)  opts.pdfPaths: 元PDFの線(pdfvec.js の paths)
 * 返り値: { text, count, skipped, mmPerPt }
 */
export const PDF_LAYER_ID = "__pdf";

export function buildDxf(page, layers = [], opts = {}) {
  const k = mmPerPt(page);
  const H = page.h;
  const P = (p) => [p[0] * k, (H - p[1]) * k];
  const shapes = visibleShapes(page.shapes || [], layers);
  const layerList = (layers.length ? layers : [{ id: BASE_LAYER_ID, name: "0", color: "#111827", width: 1, dash: "" }]).slice();
  const pdfPaths = opts.pdfPaths || [];
  if (pdfPaths.length) layerList.push({ id: PDF_LAYER_ID, name: "PDF元図", color: "#000000", width: 0.5, dash: "" });
  const names = new Map(layerList.map((l) => [l.id, layerName(l.name)]));
  const used = new Set();
  for (const l of layerList) {
    let n = names.get(l.id);
    while (used.has(n.toUpperCase())) n += "_";
    used.add(n.toUpperCase());
    names.set(l.id, n);
  }

  const w = new Writer(); // ファイル全体(ヘッダ・テーブル)。図形の handle も同じ連番を使う
  const ent = new Writer();
  ent.handle = () => w.handle();
  let count = 0;
  let skipped = 0;
  /** 図形ごとの共通属性: レイヤー・色・太さ・線種(レイヤーに従う項目は省略=ByLayer) */
  const common = (w, sh, { fill = false } = {}) => {
    w.add(5, w.handle());
    w.add(100, "AcDbEntity");
    w.add(8, names.get(layerIdOf(sh)) || "0");
    const st = sh.style || {};
    const bl = sh.bl || [];
    if (!bl.includes("color")) {
      const c = (sh.type === "text" ? sh.color : null) || st.color || "#e11d48";
      w.add(62, nearestAci(c));
      const [r, g, b] = hexRgb(c);
      w.add(420, (r << 16) | (g << 8) | b);
    }
    if (!fill && !bl.includes("width")) w.add(370, lineWeight(st.width ?? 1));
    const lt = bl.includes("dash") ? null : ltypeOf(st.dash);
    if (lt) w.add(6, lt);
    else if (!bl.includes("dash") && !st.dash) w.add(6, "Continuous");
  };

  const line = (sh, a, b) => {
    const [x1, y1] = P(a);
    const [x2, y2] = P(b);
    ent.add(0, "LINE");
    common(ent, sh);
    ent.add(100, "AcDbLine");
    ent.add(10, x1); ent.add(20, y1); ent.add(30, 0);
    ent.add(11, x2); ent.add(21, y2); ent.add(31, 0);
    count++;
  };
  /** pts: [[x,y,bulge?]] 画面座標。bulge は画面で時計回りが正(DXFに直すとき向きを反転しない: yの反転と相殺) */
  const poly = (sh, pts, closed, bulges = null) => {
    if (pts.length < 2) return;
    ent.add(0, "LWPOLYLINE");
    common(ent, sh);
    ent.add(100, "AcDbPolyline");
    ent.add(90, pts.length);
    ent.add(70, closed ? 1 : 0);
    pts.forEach((p, i) => {
      const [x, y] = P(p);
      ent.add(10, x);
      ent.add(20, y);
      if (bulges && bulges[i]) ent.add(42, bulges[i]);
    });
    count++;
  };
  const circle = (sh, c, r) => {
    const [x, y] = P(c);
    ent.add(0, "CIRCLE");
    common(ent, sh);
    ent.add(100, "AcDbCircle");
    ent.add(10, x); ent.add(20, y); ent.add(30, 0);
    ent.add(40, r * k);
    count++;
  };
  /** 円弧: 画面の角度 lo から hi(ラジアン、hi>lo、画面で時計回りに増える)の範囲 */
  const arc = (sh, c, r, lo, hi) => {
    if (hi - lo >= Math.PI * 2 - 1e-4) return circle(sh, c, r);
    const [x, y] = P(c);
    const norm = (d) => ((d % 360) + 360) % 360;
    ent.add(0, "ARC");
    common(ent, sh);
    ent.add(100, "AcDbCircle");
    ent.add(10, x); ent.add(20, y); ent.add(30, 0);
    ent.add(40, r * k);
    ent.add(100, "AcDbArc");
    ent.add(50, norm(deg(-hi)));
    ent.add(51, norm(deg(-lo)));
    count++;
  };
  const ellipse = (sh, c, rx, ry) => {
    if (Math.abs(rx - ry) < 1e-6) return circle(sh, c, rx);
    const [x, y] = P(c);
    ent.add(0, "ELLIPSE");
    common(ent, sh);
    ent.add(100, "AcDbEllipse");
    ent.add(10, x); ent.add(20, y); ent.add(30, 0);
    if (rx >= ry) {
      ent.add(11, rx * k); ent.add(21, 0); ent.add(31, 0);
      ent.add(40, ry / rx);
    } else {
      ent.add(11, 0); ent.add(21, ry * k); ent.add(31, 0);
      ent.add(40, rx / ry);
    }
    ent.add(41, 0);
    ent.add(42, "6.283185307179586");
    count++;
  };
  /** 塗りつぶし三角形(矢じり) */
  const solid = (sh, tri) => {
    ent.add(0, "SOLID");
    common(ent, sh, { fill: true });
    ent.add(100, "AcDbTrace");
    tri.forEach((p, i) => {
      const [x, y] = P(p);
      ent.add(10 + i, x);
      ent.add(20 + i, y);
      ent.add(30 + i, 0);
    });
    const [x, y] = P(tri[2]);
    ent.add(13, x); ent.add(23, y); ent.add(33, 0);
    count++;
  };
  /** 文字(MTEXT)。attach: 1=左上 5=中央。angle: 画面で時計回りの度 */
  const text = (sh, at, str, size, { attach = 1, angle = 0 } = {}) => {
    if (!str) return;
    const [x, y] = P(at);
    ent.add(0, "MTEXT");
    common(ent, sh, { fill: true });
    ent.add(100, "AcDbMText");
    ent.add(10, x); ent.add(20, y); ent.add(30, 0);
    ent.add(40, size * k * 0.8);
    ent.add(71, attach);
    ent.add(72, 5);
    ent.add(1, mtextEscape(str));
    if (angle) ent.add(50, ((-angle % 360) + 360) % 360);
    count++;
  };
  const end = (sh, e) => {
    if (e.type === "dot") circle(sh, e.c, e.r);
    else solid(sh, e.poly);
  };
  const labelOf = (sh) => {
    if (sh.type === "dim") return sh.text ?? "";
    const v = measure(sh.pts[0], sh.pts[1], page.scale);
    return v == null ? "" : formatLength(v, page.scale.unit);
  };

  // 元PDFの線(あれば図形の下=先に書く)
  for (const p of pdfPaths) {
    const sh = { layer: PDF_LAYER_ID, style: { color: p.color, width: Math.max(0.1, p.width) }, bl: [] };
    if (p.pts.length === 2 && !p.closed) line(sh, p.pts[0], p.pts[1]);
    else poly(sh, p.pts, p.closed);
  }

  for (const sh of shapes) {
    switch (sh.type) {
      case "line":
        line(sh, sh.pts[0], sh.pts[1]);
        break;
      case "arrow": {
        const size = arrowSizeOf(sh, sh.style?.width);
        const [a, b] = sh.pts;
        const [s0, s1] = arrowShaft(a, b, size);
        line(sh, s0, s1);
        solid(sh, arrowHead(a, b, size));
        break;
      }
      case "pen":
      case "polyline":
        poly(sh, sh.pts, false);
        break;
      case "polygon":
        poly(sh, sh.pts, true);
        break;
      case "rect":
        poly(sh, rectPoints(sh.pts[0], sh.pts[1]), true);
        break;
      case "ellipse": {
        const [p0, p1] = sh.pts;
        ellipse(sh, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], Math.abs(p1[0] - p0[0]) / 2, Math.abs(p1[1] - p0[1]) / 2);
        break;
      }
      case "arc": {
        const [c, a] = sh.pts;
        const r = dist(c, a);
        const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
        const s = (Math.min(360, Math.max(1, sh.sweep ?? 180)) * Math.PI) / 180;
        arc(sh, c, r, t0, t0 + s);
        if (sh.r1) line(sh, c, a);
        if (sh.r2) line(sh, c, [c[0] + r * Math.cos(t0 + s), c[1] + r * Math.sin(t0 + s)]);
        break;
      }
      case "cloud": {
        const pts = sh.pts;
        if (pts.length < 3) {
          poly(sh, pts, false);
          break;
        }
        const pitch = Math.max(4, sh.pitch || 16);
        const sweepSign = signedArea(pts) > 0 ? 1 : -1; // 外側へ膨らむ向き(画面で時計回り=+)
        const verts = [{ p: pts[0], b: 0 }];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          const L = dist(a, b);
          if (L < 0.01) continue;
          const n = Math.max(1, Math.round(L / pitch));
          const chord = L / n;
          const r = chord * 0.62;
          const bulge = sweepSign * Math.tan(Math.asin(Math.min(1, chord / (2 * r))) / 2);
          for (let j = 1; j <= n; j++) {
            verts[verts.length - 1].b = bulge;
            verts.push({ p: [a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n], b: 0 });
          }
        }
        verts.pop(); // 最後は始点と同じ点(閉じるので不要)
        poly(sh, verts.map((v) => v.p), true, verts.map((v) => v.b));
        break;
      }
      case "text": {
        text(sh, sh.pts[0], sh.text, sh.size || 18, { attach: 1, angle: sh.angle || 0 });
        break;
      }
      case "dim":
      case "measure": {
        const size = sh.size || 12;
        const geo = dimensionGeometry(sh.pts[0], sh.pts[1], sh.type === "dim" ? sh.off ?? 24 : 0, size, dimOpts(sh));
        if (sh.type === "dim" && !sh.noExt) {
          line(sh, geo.ext0[0], geo.ext0[1]);
          line(sh, geo.ext1[0], geo.ext1[1]);
        }
        line(sh, geo.line[0], geo.line[1]);
        for (const e of geo.ends) end(sh, e);
        if (geo.leader) line(sh, geo.leader[0], geo.leader[1]);
        text(sh, geo.textPos, labelOf(sh), size, { attach: 5, angle: geo.textAngle });
        break;
      }
      case "dimang": {
        const size = sh.size || 12;
        const r = sh.r ?? defaultAngleRadius(...sh.pts);
        const geo = angleDimGeometry(sh.pts, r, size, { endStyle: sh.endStyle ?? "arrow", endSize: sh.endSize ?? size / 2 });
        if (!geo) {
          skipped++;
          break;
        }
        const [v, a, b] = sh.pts;
        const ta = Math.atan2(a[1] - v[1], a[0] - v[0]);
        let d = Math.atan2(b[1] - v[1], b[0] - v[0]) - ta;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d <= -Math.PI) d += 2 * Math.PI;
        arc(sh, v, r, Math.min(ta, ta + d), Math.max(ta, ta + d));
        geo.ext.forEach((e) => line(sh, e[0], e[1]));
        for (const e of geo.ends) end(sh, e);
        text(sh, geo.textPos, sh.text || geo.label, size, { attach: 5 });
        break;
      }
      case "leader": {
        const size = sh.size || LEADER_DEFAULT.size;
        const m = sh.text && opts.metrics ? opts.metrics({ ...sh, size }) : null;
        const geo = leaderGeometry(sh, m);
        line(sh, geo.line[0], geo.line[1]);
        if (geo.tipShape) end(sh, geo.tipShape);
        if (geo.box?.type === "underline") line(sh, geo.box.pts[0], geo.box.pts[1]);
        else if (geo.box?.type === "stadium") {
          const { x, y, w, h, stub } = geo.box;
          const r = h / 2;
          poly(sh, [[x + r, y], [x + w - r, y], [x + w - r, y + h], [x + r, y + h]], true, [0, 1, 0, 1]);
          line(sh, stub[0], stub[1]);
        }
        if (m && geo.textTL) text(sh, geo.textTL, sh.text, size, { attach: 1 });
        break;
      }
      default:
        skipped++; // 写真・スタンプ・署名など(画像)は含めない
        break;
    }
  }

  // ---- ファイル全体 ----
  const sec = (name) => {
    w.add(0, "SECTION");
    w.add(2, name);
  };
  const endsec = () => w.add(0, "ENDSEC");
  sec("HEADER");
  w.add(9, "$ACADVER"); w.add(1, "AC1021");
  w.add(9, "$INSUNITS"); w.add(70, 4);
  w.add(9, "$MEASUREMENT"); w.add(70, 1);
  w.add(9, "$LTSCALE"); w.add(40, 1);
  endsec();
  sec("TABLES");
  // 線種
  w.add(0, "TABLE"); w.add(2, "LTYPE"); w.add(70, LTYPE_DEFS.length + 1);
  const ltype = (name, desc, pat) => {
    w.add(0, "LTYPE"); w.add(5, w.handle()); w.add(100, "AcDbSymbolTableRecord"); w.add(100, "AcDbLinetypeTableRecord");
    w.add(2, name); w.add(70, 0); w.add(3, desc); w.add(72, 65); w.add(73, pat.length);
    w.add(40, pat.reduce((s, v) => s + Math.abs(v), 0));
    for (const v of pat) { w.add(49, v); w.add(74, 0); }
  };
  ltype("Continuous", "Solid line", []);
  for (const [n, d, p] of LTYPE_DEFS) ltype(n, d, p);
  w.add(0, "ENDTAB");
  // 文字スタイル
  w.add(0, "TABLE"); w.add(2, "STYLE"); w.add(70, 1);
  w.add(0, "STYLE"); w.add(5, w.handle()); w.add(100, "AcDbSymbolTableRecord"); w.add(100, "AcDbTextStyleTableRecord");
  w.add(2, "Standard"); w.add(70, 0); w.add(40, 0); w.add(41, 1); w.add(50, 0); w.add(71, 0); w.add(42, 2.5); w.add(3, "txt"); w.add(4, "");
  w.add(0, "ENDTAB");
  // レイヤー
  w.add(0, "TABLE"); w.add(2, "LAYER"); w.add(70, layerList.length);
  for (const l of layerList) {
    w.add(0, "LAYER"); w.add(5, w.handle()); w.add(100, "AcDbSymbolTableRecord"); w.add(100, "AcDbLayerTableRecord");
    w.add(2, names.get(l.id)); w.add(70, 0);
    w.add(62, nearestAci(l.color));
    const [r, g, b] = hexRgb(l.color);
    w.add(420, (r << 16) | (g << 8) | b);
    w.add(6, ltypeOf(l.dash) || "Continuous");
    w.add(370, lineWeight(l.width ?? 1));
  }
  w.add(0, "ENDTAB");
  endsec();
  sec("ENTITIES");
  const body = w.out.concat(ent.out);
  const tail = new Writer();
  tail.add(0, "ENDSEC");
  tail.add(0, "EOF");
  return { text: body.concat(tail.out).join("\n") + "\n", count, skipped, mmPerPt: k };
}
