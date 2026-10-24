// ハッチング(斜線・格子): 図形の塗りつぶしスタイル。線は図形の内側だけに引く
import { rectPoints } from "./geometry.js";

export const MM = 72 / 25.4;
export const HATCH_DEFAULT = { angle: 45, gap: 3, width: 0.5 }; // 角度(度)・間隔(mm、用紙上)・線の太さ(pt)
export const FILL_STYLES = [["solid", "べた塗り"], ["lines", "斜線"], ["cross", "格子"]];
const MAX_LINES = 3000; // 間隔が極端に狭いときの安全弁

export const isHatch = (style) => style?.fillStyle === "lines" || style?.fillStyle === "cross";

/** 図形の外形(多角形の頂点列)。丸は折れ線で近似する */
export function hatchOutline(shape) {
  const p = shape.pts;
  switch (shape.type) {
    case "rect":
      return rectPoints(p[0], p[1]);
    case "ellipse": {
      const cx = (p[0][0] + p[1][0]) / 2, cy = (p[0][1] + p[1][1]) / 2;
      const rx = Math.abs(p[1][0] - p[0][0]) / 2, ry = Math.abs(p[1][1] - p[0][1]) / 2;
      return Array.from({ length: 96 }, (_, i) => [cx + rx * Math.cos((i / 96) * Math.PI * 2), cy + ry * Math.sin((i / 96) * Math.PI * 2)]);
    }
    case "polygon":
    case "cloud":
      return p;
    default:
      return null;
  }
}

/** 向き θ(度)の平行線を、多角形の内側だけに引いた線分の一覧(格子線の位置は紙面に固定で、隣の図形ともそろう) */
function parallel(poly, deg, gap) {
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux;
  const dn = poly.map((q) => q[0] * nx + q[1] * ny);
  const lo = Math.min(...dn), hi = Math.max(...dn);
  if (!(hi > lo)) return [];
  const step = Math.max(gap, (hi - lo) / MAX_LINES);
  const out = [];
  for (let c = Math.ceil(lo / step) * step; c <= hi; c += step) {
    const ts = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length];
      const da = dn[i], db = dn[(i + 1) % poly.length];
      if (da <= c !== db <= c) {
        const r = (c - da) / (db - da);
        ts.push((A[0] + (B[0] - A[0]) * r) * ux + (A[1] + (B[1] - A[1]) * r) * uy);
      }
    }
    ts.sort((s, t) => s - t);
    for (let i = 0; i + 1 < ts.length; i += 2) out.push([[ux * ts[i] + nx * c, uy * ts[i] + ny * c], [ux * ts[i + 1] + nx * c, uy * ts[i + 1] + ny * c]]);
  }
  return out;
}

/** 設定(style)どおりのハッチング線 [[始点, 終点], …]。ハッチングでない/塗れない図形は空 */
export function hatchSegments(shape) {
  const st = shape.style || {};
  if (!isHatch(st) || !st.fill || st.fill === "none") return [];
  const poly = hatchOutline(shape);
  if (!poly || poly.length < 3) return [];
  const angle = Number.isFinite(st.hatchAngle) ? st.hatchAngle : HATCH_DEFAULT.angle;
  const gap = Math.max(0.3, (Number.isFinite(st.hatchGap) && st.hatchGap > 0 ? st.hatchGap : HATCH_DEFAULT.gap) * MM);
  const segs = parallel(poly, angle, gap);
  if (st.fillStyle === "cross") segs.push(...parallel(poly, angle + 90, gap));
  return segs;
}

export const hatchWidth = (st) => (Number.isFinite(st?.hatchWidth) && st.hatchWidth > 0 ? st.hatchWidth : HATCH_DEFAULT.width);
/** 線分の一覧を SVG のパス文字列に */
export const segmentsPath = (segs) => segs.map(([a, b]) => `M${+a[0].toFixed(2)} ${+a[1].toFixed(2)}L${+b[0].toFixed(2)} ${+b[1].toFixed(2)}`).join("");
