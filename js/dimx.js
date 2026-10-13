// 寸法の拡張(角度寸法・直列/並列寸法・半径/直径寸法)の幾何(DOM非依存・node でテスト可能)
import { arrowHead } from "./geometry.js";

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const f = (n) => +n.toFixed(2);

/** 角度寸法の初期の円弧半径(2本の線の短いほうの約半分。短すぎ・長すぎを避ける) */
export function defaultAngleRadius(v, a, b) {
  const m = Math.min(dist(v, a), dist(v, b));
  return Math.max(16, Math.min(m * 0.55, 160));
}

/** 2つの向き(頂点 v から a, b)の間の角度(0〜180度)。退化していれば null */
export function angleBetween(v, a, b) {
  if (dist(v, a) < 1e-6 || dist(v, b) < 1e-6) return null;
  const ta = Math.atan2(a[1] - v[1], a[0] - v[0]);
  const tb = Math.atan2(b[1] - v[1], b[0] - v[0]);
  let d = tb - ta;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return (Math.abs(d) * 180) / Math.PI;
}

/** 角度の表示文字(整数なら小数なし) */
export const angleLabel = (deg) => `${deg.toFixed(1).replace(/\.0$/, "")}°`;

/**
 * 角度寸法の幾何。pts = [頂点, 1本目の線上の点, 2本目の線上の点]、r: 円弧の半径。
 * 返り値: arc(SVGパス)・ext(補助線2本)・ends(端部)・textPos・label・deg。退化していれば null
 */
export function angleDimGeometry(pts, r, size = 12, { endStyle = "arrow", endSize = 6 } = {}) {
  const [v, a, b] = pts;
  const deg = angleBetween(v, a, b);
  if (deg == null || !(r > 0)) return null;
  const ta = Math.atan2(a[1] - v[1], a[0] - v[0]);
  const tb = Math.atan2(b[1] - v[1], b[0] - v[0]);
  let d = tb - ta;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  const at = (t, rr = r) => [v[0] + rr * Math.cos(t), v[1] + rr * Math.sin(t)];
  const p0 = at(ta);
  const p1 = at(ta + d);
  const sweepFlag = d > 0 ? 1 : 0; // 画面で時計回り = 角度が増える向き
  const large = Math.abs(d) > Math.PI ? 1 : 0;
  const arc = `M${f(p0[0])} ${f(p0[1])} A${f(r)} ${f(r)} 0 ${large} ${sweepFlag} ${f(p1[0])} ${f(p1[1])}`;
  const over = 4;
  const ext = [
    [at(ta, r), at(ta, r + over)],
    [at(ta + d, r), at(ta + d, r + over)],
  ];
  const ends = [];
  const es = Math.max(0.5, endSize);
  if (endStyle === "dot") {
    const rad = Math.min(es / 2, (r * Math.abs(d)) / 6);
    ends.push({ type: "dot", c: p0, r: rad }, { type: "dot", c: p1, r: rad });
  } else {
    const hs = Math.min(es * 2, (r * Math.abs(d)) / 3);
    const dt = hs / r; // 弧に沿って矢じりの長さだけ戻った点から先端へ
    ends.push({ type: "arrow", poly: arrowHead(at(ta + Math.sign(d) * dt), p0, hs) }, { type: "arrow", poly: arrowHead(at(ta + d - Math.sign(d) * dt), p1, hs) });
  }
  const tm = ta + d / 2;
  const textPos = at(tm, r + size * 0.8);
  return { arc, ext, ends, textPos, label: angleLabel(deg), deg, p0, p1 };
}

/**
 * 直列・並列寸法。points: 測点の並び(2点以上)。
 * mode "series": 隣り合う点どうし / "parallel": 最初の点から各点まで(寸法線を size*2.2 ずつ外へ重ねる)
 * 戻り値: [{ pts: [A,B], off }]。直列は、最初の2点の向きに並ぶ点の寸法線を1本の直線にそろえる
 */
export function chainDims(points, mode, off = 24, size = 12) {
  if (points.length < 2) return [];
  const out = [];
  if (mode === "parallel") {
    const step = size * 2.2;
    for (let i = 1; i < points.length; i++) out.push({ pts: [points[0], points[i]], off: off + (i - 1) * step });
    return out;
  }
  const p0 = points[0];
  const L0 = dist(p0, points[1]) || 1;
  const u = [(points[1][0] - p0[0]) / L0, (points[1][1] - p0[1]) / L0];
  const n = [-u[1], u[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const A = points[i];
    const B = points[i + 1];
    const L = dist(A, B);
    let o = off;
    if (L > 1e-6) {
      const cos = ((B[0] - A[0]) * u[0] + (B[1] - A[1]) * u[1]) / L;
      // 最初の寸法と同じ向きなら、寸法線が同じ直線上に並ぶようにずらし量を調整する
      if (Math.abs(cos) > 0.9999) o = off + ((p0[0] - A[0]) * n[0] + (p0[1] - A[1]) * n[1]) * (cos > 0 ? 1 : -1);
    }
    out.push({ pts: [A, B], off: o });
  }
  return out;
}

/**
 * 半径・直径寸法の2点。center・半径 r、方向 dir(中心から見た向きの点)。
 * 半径: [中心, 円周上の点] / 直径: [反対側の円周上の点, 円周上の点]
 */
export function circleDimPts(center, r, dir, kind) {
  const L = dist(center, dir) || 1;
  const u = [(dir[0] - center[0]) / L, (dir[1] - center[1]) / L];
  const edge = [center[0] + u[0] * r, center[1] + u[1] * r];
  if (kind === "diameter") return [[center[0] - u[0] * r, center[1] - u[1] * r], edge];
  return [center, edge];
}

/** 寸法値の引出線(文字を動かしたときの線)の、寸法線側の先端。kind: "dot" | "arrow" | その他(なし)。leader = [寸法線上の点, 文字側の点] */
export function leaderTipShape(leader, kind, endSize = 6) {
  if (!leader || (kind !== "dot" && kind !== "arrow")) return null;
  const [c0, c1] = leader;
  const es = Math.max(0.5, endSize);
  if (kind === "dot") return { type: "dot", c: c0, r: es / 2 };
  return { type: "arrow", poly: arrowHead(c1, c0, Math.min(es * 2, dist(c0, c1) / 2 || es * 2)) };
}
