// 図形データ → SVG 要素。画面表示・選択・画像化(書き出し)で共通利用する。
import {
  linePath, polygonPath, ellipsePath, cloudPath, arrowHead, arrowShaft, smoothPath,
  dimensionGeometry, rectPoints, mid, dist, measure, formatLength, bbox, dashArray,
} from "./geometry.js";

const NS = "http://www.w3.org/2000/svg";

/** 選べるフォント(端末に入っているフォントから選ぶ。オフラインでも使える) */
export const FONTS = [
  { id: "gothic", label: "ゴシック", css: '"Hiragino Sans","Yu Gothic UI","Yu Gothic","Meiryo","Noto Sans JP","Noto Sans CJK JP",sans-serif' },
  { id: "mincho", label: "明朝", css: '"Hiragino Mincho ProN","Yu Mincho","MS PMincho","Noto Serif JP","Noto Serif CJK JP",serif' },
  { id: "maru", label: "丸ゴシック", css: '"Hiragino Maru Gothic ProN","Meiryo UI","Zen Maru Gothic","Noto Sans JP",sans-serif' },
  { id: "mono", label: "等幅", css: '"SF Mono","Consolas","MS Gothic","Noto Sans Mono CJK JP",ui-monospace,monospace' },
  { id: "hand", label: "手書き風", css: '"Yusei Magic","Klee One","Hannotate SC","HGSeikaishotaiPRO","Comic Sans MS","Segoe Print",cursive' },
  { id: "serif-en", label: "欧文セリフ", css: '"Times New Roman","Georgia","Hiragino Mincho ProN",serif' },
];
export const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;

export const TEXT_ASCENT = 0.88; // 行の上端→ベースラインの比率
export const TEXT_LINE = 1.25;   // 行送り(フォントサイズ比)

let measureCtx = null;
function ctx2d() {
  if (!measureCtx) {
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(8, 8) : document.createElement("canvas");
    measureCtx = c.getContext("2d");
  }
  return measureCtx;
}

/** テキスト図形の寸法(左上原点)。幅は最長行、高さは行数 × 行送り */
export function textMetrics(shape) {
  const size = shape.size || 18;
  const lines = String(shape.text ?? "").split("\n");
  const c = ctx2d();
  c.font = `${shape.bold ? "bold " : ""}${size}px ${fontCss(shape.font)}`;
  let w = 0;
  for (const l of lines) w = Math.max(w, c.measureText(l || " ").width);
  return { w: Math.max(w, size * 0.6), h: lines.length * size * TEXT_LINE, lines };
}

/** 図形のバウンディングボックス(選択枠・当たり判定用) */
export function shapeBounds(shape, page) {
  switch (shape.type) {
    case "text": {
      const m = textMetrics(shape);
      return { x: shape.pts[0][0], y: shape.pts[0][1], w: m.w, h: m.h };
    }
    case "dim": {
      const g = dimensionGeometry(shape.pts[0], shape.pts[1], shape.off ?? 24, shape.size || 12);
      return bbox([...shape.pts, g.line[0], g.line[1], g.textPos]);
    }
    case "cloud": {
      const b = bbox(shape.pts);
      const m = (shape.pitch || 16) * 0.5;
      return { x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m };
    }
    default:
      return bbox(shape.pts);
  }
}

function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

/** 図形が持つ「頂点」(ハンドル表示・編集用)。寸法線のオフセットは別ハンドル */
export function shapeVertices(shape) {
  switch (shape.type) {
    case "text":
    case "pen":
      return [];
    case "rect":
    case "ellipse":
    case "image":
      return rectPoints(shape.pts[0], shape.pts[1]); // 4隅(対角を保って編集)
    default:
      return shape.pts;
  }
}

/** 寸法・計測のラベル文字列 */
export function labelFor(shape, page) {
  if (shape.type === "dim") return shape.text ?? "";
  if (shape.type === "measure") {
    const v = measure(shape.pts[0], shape.pts[1], page?.scale);
    return v == null ? "縮尺未設定" : formatLength(v, page.scale.unit);
  }
  return "";
}

/**
 * 1つの図形を <g> として生成して parent に追加する。
 * opts.page: 計測ラベル用(縮尺)。
 */
export function renderShape(shape, parent, opts = {}) {
  const s = shape.style || {};
  const color = s.color || "#e11d48";
  const width = s.width ?? 2;
  const g = el("g", { class: `shape shape-${shape.type}`, "data-id": shape.id }, parent);
  const common = {
    stroke: color,
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "stroke-dasharray": dashArray(s.dash, width)?.join(" ") ?? null,
    opacity: s.opacity != null && s.opacity < 1 ? s.opacity : null,
  };
  const fill = s.fill && s.fill !== "none" ? s.fill : "none";
  const fillAttrs = { fill, "fill-opacity": fill !== "none" ? (s.fillOpacity ?? 0.25) : null };
  // 当たり判定用の太い透明線(細い線でも指で選びやすい)
  const hit = (d, filled) =>
    el("path", { d, class: "hit", fill: filled ? "transparent" : "none", stroke: "transparent", "stroke-width": Math.max(14, width + 10), "pointer-events": filled ? "all" : "stroke" }, g);

  switch (shape.type) {
    case "line": {
      const d = linePath(shape.pts);
      el("path", { d, fill: "none", ...common }, g);
      hit(d);
      break;
    }
    case "arrow": {
      const size = Math.max(10, width * 4.5);
      const [a, b] = shape.pts;
      const [sa, sb] = arrowShaft(a, b, size);
      el("path", { d: linePath([sa, sb]), fill: "none", ...common }, g);
      el("path", { d: polygonPath(arrowHead(a, b, size)), fill: color, stroke: color, "stroke-width": 1, "stroke-linejoin": "round", opacity: common.opacity }, g);
      hit(linePath([a, b]));
      break;
    }
    case "rect": {
      const d = polygonPath(rectPoints(shape.pts[0], shape.pts[1]));
      el("path", { d, ...fillAttrs, ...common }, g);
      hit(d, fill !== "none");
      break;
    }
    case "ellipse": {
      const d = ellipsePath(shape.pts[0], shape.pts[1]);
      el("path", { d, ...fillAttrs, ...common }, g);
      hit(d, fill !== "none");
      break;
    }
    case "polygon": {
      const d = polygonPath(shape.pts);
      el("path", { d, ...fillAttrs, ...common }, g);
      hit(d, fill !== "none");
      break;
    }
    case "cloud": {
      const d = cloudPath(shape.pts, shape.pitch || 16);
      el("path", { d, ...fillAttrs, ...common }, g);
      hit(d, true);
      break;
    }
    case "pen": {
      const d = smoothPath(shape.pts);
      el("path", { d, fill: "none", ...common, "stroke-width": width }, g);
      hit(d);
      break;
    }
    case "text": {
      const m = textMetrics(shape);
      const size = shape.size || 18;
      const [x, y] = shape.pts[0];
      if (shape.bg) el("rect", { x, y, width: m.w, height: m.h, fill: shape.bg }, g);
      const t = el("text", {
        x, y: y + size * TEXT_ASCENT, "font-size": size,
        "font-family": fontCss(shape.font), "font-weight": shape.bold ? "bold" : null,
        fill: shape.color || color, style: "white-space:pre",
      }, g);
      m.lines.forEach((line, i) => {
        const ts = el("tspan", { x, dy: i === 0 ? 0 : size * TEXT_LINE }, t);
        ts.textContent = line || " ";
      });
      el("rect", { x: x - 3, y: y - 3, width: m.w + 6, height: m.h + 6, fill: "transparent", class: "hit" }, g);
      break;
    }
    case "dim":
    case "measure": {
      const size = shape.size || 12;
      const label = labelFor(shape, opts.page);
      let geo;
      if (shape.type === "dim") {
        geo = dimensionGeometry(shape.pts[0], shape.pts[1], shape.off ?? 24, size);
        el("path", { d: linePath(geo.ext0), fill: "none", ...common, "stroke-width": Math.max(0.6, width * 0.6) }, g);
        el("path", { d: linePath(geo.ext1), fill: "none", ...common, "stroke-width": Math.max(0.6, width * 0.6) }, g);
      } else {
        geo = dimensionGeometry(shape.pts[0], shape.pts[1], 0, size);
        // 計測は測点上に線を引き、両端に小さな縦棒(エンドマーク)
      }
      const [a0, a1] = geo.line;
      el("path", { d: linePath([a0, a1]), fill: "none", ...common }, g);
      for (const h of [geo.head0, geo.head1]) el("path", { d: polygonPath(h), fill: color, stroke: color, "stroke-width": 0.5, opacity: common.opacity }, g);
      const t = el("text", {
        x: geo.textPos[0], y: geo.textPos[1] + size * 0.35, "text-anchor": "middle", "font-size": size,
        "font-family": fontCss(shape.font), fill: shape.color || color,
        transform: `rotate(${geo.textAngle} ${geo.textPos[0]} ${geo.textPos[1]})`, style: "white-space:pre",
      }, g);
      t.textContent = label;
      hit(linePath([a0, a1]));
      break;
    }
    case "image": {
      const [p0, p1] = shape.pts;
      const x = Math.min(p0[0], p1[0]);
      const y = Math.min(p0[1], p1[1]);
      const w = Math.abs(p1[0] - p0[0]);
      const h = Math.abs(p1[1] - p0[1]);
      const href = opts.images?.get(shape.imgId) || "";
      el("image", { x, y, width: w, height: h, href, preserveAspectRatio: "none" }, g);
      el("rect", { x, y, width: w, height: h, fill: "transparent", class: "hit" }, g);
      break;
    }
    default:
      break;
  }
  return g;
}

/** ページ全体の図形レイヤを作る(opts.exclude: 編集中の図形idを除外) */
export function renderShapes(shapes, parent, opts = {}) {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  for (const sh of shapes) {
    if (opts.exclude && opts.exclude === sh.id) continue;
    renderShape(sh, parent, opts);
  }
}

/** 書き出し/画像化用: 図形だけの独立した SVG 文字列 */
export function serializeOverlay(page, images, w, h) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("xmlns", NS);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  renderShapes(page.shapes, svg, { page, images });
  // 当たり判定用の要素は不要
  svg.querySelectorAll(".hit").forEach((n) => n.remove());
  return new XMLSerializer().serializeToString(svg);
}
