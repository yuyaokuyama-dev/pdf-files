// 範囲選択(窓・交差・投げ縄)の判定(DOM非依存・node でテスト可能)
// 座標系: ページ表示座標(pt, 左上原点)
import { arcGeometry, rectPoints, pointInPolygon } from "./geometry.js";

export const normRect = (a, b) => {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
};
const inRect = (p, r) => p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
export const rectsIntersect = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const rectContains = (outer, inner) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** 線分 ab が矩形と交わる(内側にある場合も含む) */
export function segmentHitsRect(a, b, r) {
  if (inRect(a, r) || inRect(b, r)) return true;
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const clip = (p, q) => {
    if (p === 0) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return clip(-dx, a[0] - r.x) && clip(dx, r.x + r.w - a[0]) && clip(-dy, a[1] - r.y) && clip(dy, r.y + r.h - a[1]);
}

/** 図形の形を折れ線で近似する。{ pts, closed }。文字・画像は null(外形の四角で判定する) */
export function shapePolyline(shape) {
  switch (shape.type) {
    case "text":
    case "image":
      return null;
    case "rect":
      return { pts: rectPoints(shape.pts[0], shape.pts[1]), closed: true };
    case "ellipse": {
      const [p0, p1] = shape.pts;
      const cx = (p0[0] + p1[0]) / 2;
      const cy = (p0[1] + p1[1]) / 2;
      const rx = Math.abs(p1[0] - p0[0]) / 2;
      const ry = Math.abs(p1[1] - p0[1]) / 2;
      const pts = [];
      for (let i = 0; i < 48; i++) {
        const t = (i / 48) * Math.PI * 2;
        pts.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
      }
      return { pts, closed: true };
    }
    case "arc": {
      const g = arcGeometry(shape.pts[0], shape.pts[1], shape.sweep);
      const n = Math.max(8, Math.ceil(g.sweep / 7.5));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = g.t0 + ((g.t1 - g.t0) * i) / n;
        pts.push([g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)]);
      }
      return { pts, closed: false };
    }
    case "polygon":
    case "cloud":
      return { pts: shape.pts, closed: true };
    default:
      return { pts: shape.pts, closed: false };
  }
}

const corners = (b) => rectPoints([b.x, b.y], [b.x + b.w, b.y + b.h]);

/**
 * 矩形で図形を選ぶ。
 * items: [{ id, bounds:{x,y,w,h}, poly?:{pts,closed} }]
 * mode: "window" = 矩形に完全に入る / "crossing" = 矩形に触れる
 */
export function pickByRect(items, rect, mode) {
  const out = [];
  for (const it of items) {
    if (mode === "window") {
      if (rectContains(rect, it.bounds)) out.push(it.id);
      continue;
    }
    if (!rectsIntersect(rect, it.bounds)) continue;
    const poly = it.poly;
    if (!poly) {
      out.push(it.id); // 文字・画像: 外形が触れていれば選ぶ
      continue;
    }
    const pts = poly.pts;
    let hit = pts.some((p) => inRect(p, rect));
    for (let i = 0; !hit && i < pts.length - (poly.closed ? 0 : 1); i++) hit = segmentHitsRect(pts[i], pts[(i + 1) % pts.length], rect);
    if (hit) out.push(it.id);
  }
  return out;
}

/** 投げ縄(自由な多角形)の内側に完全に入る図形を選ぶ */
export function pickByLasso(items, polygon) {
  if (polygon.length < 3) return [];
  const out = [];
  for (const it of items) {
    const pts = it.poly ? it.poly.pts : corners(it.bounds);
    if (pts.length && pts.every((p) => pointInPolygon(p, polygon))) out.push(it.id);
  }
  return out;
}
