// オブジェクトスナップ・極トラッキング(DOM非依存・node でテスト可能)
// 座標系: ページ表示座標(pt, 左上原点)
import { arcGeometry } from "./geometry.js";
import { shapePolyline } from "./select.js";

export const SNAP_KINDS = [
  { id: "end", label: "端点・頂点" },
  { id: "mid", label: "中点" },
  { id: "center", label: "中心" },
  { id: "quad", label: "四半円点" },
  { id: "int", label: "交点" },
];
export const DEFAULT_SNAP = { osnap: true, kinds: ["end", "mid", "center", "quad", "int"], polar: true, step: 45, dyn: true };

const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const SKIP = new Set(["pen", "text", "image"]);

/** 図形1つのスナップ点。[{ p, kind }] */
export function shapeSnapPoints(shape) {
  if (SKIP.has(shape.type)) return [];
  const out = [];
  const add = (p, kind) => out.push({ p, kind });
  const pts = shape.pts || [];
  switch (shape.type) {
    case "rect": {
      const [a, b] = pts;
      const c = [a, [b[0], a[1]], b, [a[0], b[1]]];
      c.forEach((p) => add(p, "end"));
      for (let i = 0; i < 4; i++) add(mid(c[i], c[(i + 1) % 4]), "mid");
      add(mid(a, b), "center");
      break;
    }
    case "ellipse": {
      const [a, b] = pts;
      const cx = (a[0] + b[0]) / 2;
      const cy = (a[1] + b[1]) / 2;
      const rx = Math.abs(b[0] - a[0]) / 2;
      const ry = Math.abs(b[1] - a[1]) / 2;
      add([cx, cy], "center");
      add([cx + rx, cy], "quad");
      add([cx - rx, cy], "quad");
      add([cx, cy + ry], "quad");
      add([cx, cy - ry], "quad");
      break;
    }
    case "arc": {
      const g = arcGeometry(pts[0], pts[1], shape.sweep);
      add(g.c, "center");
      add([g.c[0] + g.r * Math.cos(g.t0), g.c[1] + g.r * Math.sin(g.t0)], "end");
      add([g.c[0] + g.r * Math.cos(g.t1), g.c[1] + g.r * Math.sin(g.t1)], "end");
      const tm = (g.t0 + g.t1) / 2;
      add([g.c[0] + g.r * Math.cos(tm), g.c[1] + g.r * Math.sin(tm)], "mid");
      break;
    }
    case "cloud": {
      const [a, b] = [pts[0], pts[2] || pts[1]];
      add(a, "end");
      add(b, "end");
      add(mid(a, b), "center");
      break;
    }
    default: {
      // line / arrow / dim / measure / polygon …
      pts.forEach((p) => add(p, "end"));
      const closed = shape.type === "polygon";
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) add(mid(pts[i], pts[(i + 1) % pts.length]), "mid");
    }
  }
  return out;
}

/** 2線分 ab, cd の交点(端を含む)。平行なら null */
export function segmentIntersection(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

const segmentsOf = (shape) => {
  if (shape.type === "ellipse" || shape.type === "arc" || shape.type === "cloud") return [];
  const poly = shapePolyline(shape);
  if (!poly) return [];
  const segs = [];
  const n = poly.closed ? poly.pts.length : poly.pts.length - 1;
  for (let i = 0; i < n; i++) segs.push([poly.pts[i], poly.pts[(i + 1) % poly.pts.length]]);
  return segs;
};

/**
 * ページ内の図形から、使うスナップ点をまとめる。
 * opts: { kinds, exclude: Set<id>, maxInt: 交点を調べる図形数の上限 }
 */
export function collectSnapPoints(shapes, { kinds = DEFAULT_SNAP.kinds, exclude, maxInt = 60, maxTests = 40000 } = {}) {
  const use = new Set(kinds);
  const out = [];
  const items = shapes.filter((s) => !(exclude && exclude.has(s.id)));
  for (const s of items) {
    for (const q of shapeSnapPoints(s)) if (use.has(q.kind)) out.push(q);
  }
  if (use.has("int")) {
    const lists = items.slice(0, maxInt).map(segmentsOf).filter((l) => l.length);
    let budget = maxTests; // 重くならないよう、交点の計算回数に上限を置く
    outer: for (let i = 0; i < lists.length; i++) {
      for (let j = i + 1; j < lists.length; j++) {
        for (const [a, b] of lists[i]) {
          for (const [c, d] of lists[j]) {
            if (--budget < 0) break outer;
            const p = segmentIntersection(a, b, c, d);
            if (p) out.push({ p, kind: "int" });
          }
        }
      }
    }
  }
  return out;
}

/** radius 以内で最も近いスナップ点。無ければ null */
export function nearestSnap(points, p, radius) {
  let best = null;
  let bd = radius;
  for (const q of points) {
    const d = Math.hypot(q.p[0] - p[0], q.p[1] - p[1]);
    if (d <= bd) {
      bd = d;
      best = q;
    }
  }
  return best;
}

export const toDeg = (r) => (r * 180) / Math.PI;
/** p0 から p への角度(度, 0=右, 反時計回りが正。画面の上方向が +) と長さ */
export function polarOf(p0, p) {
  const dx = p[0] - p0[0];
  const dy = p[1] - p0[1];
  return { len: Math.hypot(dx, dy), ang: toDeg(Math.atan2(-dy, dx)) };
}
/** p0 から角度 ang(度)・長さ len の点 */
export function pointAt(p0, ang, len) {
  const r = (ang * Math.PI) / 180;
  return [p0[0] + Math.cos(r) * len, p0[1] - Math.sin(r) * len];
}

/**
 * 極トラッキング: 角度が step の倍数に近ければ、その角度に合わせる。
 * lock90 のとき(Shift)は 90° 刻みに固定(直交モード)。{ p, ang, snapped } を返す
 */
export function polarSnap(p0, p, { step = 45, tol = 3, lock90 = false } = {}) {
  const { len, ang } = polarOf(p0, p);
  if (len < 1e-6) return { p, ang, snapped: false };
  if (lock90) {
    const a = Math.round(ang / 90) * 90;
    return { p: pointAt(p0, a, len), ang: ((a % 360) + 360) % 360, snapped: true };
  }
  if (!(step > 0)) return { p, ang, snapped: false };
  const a = Math.round(ang / step) * step;
  if (Math.abs(ang - a) <= tol) return { p: pointAt(p0, a, len), ang: ((a % 360) + 360) % 360, snapped: true };
  return { p, ang, snapped: false };
}
