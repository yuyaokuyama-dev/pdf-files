// 幾何ユーティリティ(DOM非依存・node でテスト可能)
// 座標系: ページ表示座標(pt, 左上原点, y下向き)

export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const f = (n) => Math.round(n * 100) / 100;

/** 多角形の符号付き面積(y下向き座標で >0 なら画面上 時計回り) */
export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function bbox(pts) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export function rectPoints(p0, p1) {
  return [
    [p0[0], p0[1]],
    [p1[0], p0[1]],
    [p1[0], p1[1]],
    [p0[0], p1[1]],
  ];
}

/** 直線(開いたパス) */
export function linePath(pts) {
  return pts.map((p, i) => `${i ? "L" : "M"}${f(p[0])} ${f(p[1])}`).join(" ");
}

export function polygonPath(pts) {
  return linePath(pts) + " Z";
}

export function ellipsePath(p0, p1) {
  const x = Math.min(p0[0], p1[0]);
  const y = Math.min(p0[1], p1[1]);
  const w = Math.abs(p1[0] - p0[0]);
  const h = Math.abs(p1[1] - p0[1]);
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y + ry;
  if (rx < 0.01 || ry < 0.01) return `M${f(x)} ${f(y)}`;
  return `M${f(cx - rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx + rx)} ${f(cy)} A${f(rx)} ${f(ry)} 0 1 0 ${f(cx - rx)} ${f(cy)} Z`;
}

/* ---------- 円弧(正円の一部) ----------
 * c: 中心、a: 始点(中心からの距離が半径、向きが始まりの角度)、
 * sweep: 開き角(度)。画面上で時計回りに測る(90=1/4円, 180=半円, 270=3/4円)。
 * 半径は1つだけなので、どう操作しても楕円にはならない。 */
export const ARC_MIN = 1;
export const ARC_MAX = 359;
export const clampSweep = (s) => Math.min(ARC_MAX, Math.max(ARC_MIN, Number.isFinite(+s) ? +s : 180));
const rad = (d) => (d * Math.PI) / 180;
const onCircle = (c, r, t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];

export function arcGeometry(c, a, sweep = 180) {
  const r = dist(c, a);
  const s = clampSweep(sweep);
  const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const t1 = t0 + rad(s);
  return { c, r, sweep: s, t0, t1, a: [a[0], a[1]], b: onCircle(c, r, t1), mid: onCircle(c, r, t0 + rad(s) / 2) };
}

/** 円弧のパス。r1/r2: 半径の直線①(中心→始点)・直線②(中心→終点)も描く */
export function arcPath(c, a, sweep = 180, { r1 = false, r2 = false } = {}) {
  const g = arcGeometry(c, a, sweep);
  if (g.r < 0.01) return `M${f(c[0])} ${f(c[1])}`;
  const large = g.sweep > 180 ? 1 : 0;
  let d = r1 ? `M${f(c[0])} ${f(c[1])} L${f(g.a[0])} ${f(g.a[1])}` : `M${f(g.a[0])} ${f(g.a[1])}`;
  d += ` A${f(g.r)} ${f(g.r)} 0 ${large} 1 ${f(g.b[0])} ${f(g.b[1])}`;
  if (r2) d += ` L${f(c[0])} ${f(c[1])}`;
  if (r1 && r2) d += " Z";
  return d;
}

/** 円弧の外接枠(端点 + 弧が通る上下左右の頂点 + 直線を出していれば中心) */
export function arcBounds(c, a, sweep = 180, { r1 = false, r2 = false } = {}) {
  const g = arcGeometry(c, a, sweep);
  const pts = [g.a, g.b];
  for (let k = Math.ceil(g.t0 / (Math.PI / 2)); k * (Math.PI / 2) <= g.t1; k++) pts.push(onCircle(c, g.r, k * (Math.PI / 2)));
  if (r1 || r2) pts.push(c);
  return bbox(pts);
}

/** 点 q の向き(中心から見た角度)。始点からの時計回りの角度(0〜360度) */
export function arcAngleOf(c, a, q) {
  const t0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const t = Math.atan2(q[1] - c[1], q[0] - c[0]);
  return ((((t - t0) * 180) / Math.PI) % 360 + 360) % 360;
}

/** 中心のまわりに点を回す(度, 時計回り) */
export function rotateAbout(p, c, deg) {
  const t = rad(deg);
  const dx = p[0] - c[0];
  const dy = p[1] - c[1];
  return [c[0] + dx * Math.cos(t) - dy * Math.sin(t), c[1] + dx * Math.sin(t) + dy * Math.cos(t)];
}

/**
 * 雲マーク(リビジョンクラウド)。頂点列(閉多角形)の各辺を、ピッチ(円弧1つ分の弦長の目安)で
 * 分割し、外側に膨らむ円弧でつなぐ。
 */
export function cloudPath(pts, pitch = 16) {
  if (pts.length < 3) return linePath(pts);
  pitch = Math.max(4, pitch);
  const sweep = signedArea(pts) > 0 ? 1 : 0; // 外側へ膨らむ向き
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const L = dist(a, b);
    if (L < 0.01) continue;
    const n = Math.max(1, Math.round(L / pitch));
    const chord = L / n;
    const r = chord * 0.62;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      d += ` A${f(r)} ${f(r)} 0 0 ${sweep} ${f(x)} ${f(y)}`;
    }
  }
  return d + " Z";
}

/** 矢じり(塗りつぶし三角形)の3点。先端は tip、dir は軸方向(from→tip) */
export function arrowHead(from, tip, size) {
  const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const s = size;
  const w = Math.PI / 7;
  return [
    [tip[0], tip[1]],
    [tip[0] - s * Math.cos(ang - w), tip[1] - s * Math.sin(ang - w)],
    [tip[0] - s * Math.cos(ang + w), tip[1] - s * Math.sin(ang + w)],
  ];
}

/** 矢じりの大きさ(pt)。個別指定(headSize)が無い従来の図形は、線の太さに比例した大きさのまま */
export const arrowSizeOf = (shape, width) => shape.headSize ?? Math.max(10, (width ?? shape.style?.width ?? 1) * 4.5);

/** 矢印の線分(軸)は矢じりの根元までにして、先が太く見えないようにする */
export function arrowShaft(p0, p1, size) {
  const L = dist(p0, p1);
  if (L < 0.01) return [p0, p1];
  const k = Math.max(0, L - size * 0.8) / L;
  return [p0, [p0[0] + (p1[0] - p0[0]) * k, p0[1] + (p1[1] - p0[1]) * k]];
}

/**
 * 寸法線の幾何。p0,p1: 測点、off: 法線方向へのオフセット(pt)。
 * opts.endStyle: "dot"(黒丸) | "arrow"(矢印)  opts.endSize: 端部のサイズ(pt)  opts.textOff: 寸法値を動かしたときの移動量
 * 文字は常に寸法線の「上側」(文字の向きから見て寸法線が文字の下に来る側)に置く。縦寸法は下から上へ読む向き。
 * 返り値: 補助線2本・寸法線・端部・文字位置と角度・引き出し線
 */
export function dimensionGeometry(p0, p1, off, size = 12, opts = {}) {
  const { endStyle = "arrow", endSize = 6, textOff = null } = opts;
  const L = dist(p0, p1);
  const ux = L ? (p1[0] - p0[0]) / L : 1;
  const uy = L ? (p1[1] - p0[1]) / L : 0;
  const nx = -uy;
  const ny = ux;
  const sgn = off >= 0 ? 1 : -1;
  const a0 = [p0[0] + nx * off, p0[1] + ny * off];
  const a1 = [p1[0] + nx * off, p1[1] + ny * off];
  const ext = 4 * sgn; // 補助線は寸法線より少し突き出す
  const e0 = [a0[0] + nx * ext, a0[1] + ny * ext];
  const e1 = [a1[0] + nx * ext, a1[1] + ny * ext];
  const gap = 2 * sgn; // 測点から少し離して始める
  const s0 = [p0[0] + nx * gap, p0[1] + ny * gap];
  const s1 = [p1[0] + nx * gap, p1[1] + ny * gap];
  // 文字の角度は [-90, 90) に正規化(縦は -90° = 下から上へ読む)
  let ang = (Math.atan2(uy, ux) * 180) / Math.PI;
  if (ang >= 90) ang -= 180;
  if (ang < -90) ang += 180;
  const r = (ang * Math.PI) / 180;
  const up = [Math.sin(r), -Math.cos(r)]; // 文字の「上」方向(常に寸法線の文字側)
  const m = mid(a0, a1);
  const moved = textOff && (textOff[0] || textOff[1]);
  const base = moved ? [m[0] + textOff[0], m[1] + textOff[1]] : m;
  const textPos = [base[0] + up[0] * size * 0.6, base[1] + up[1] * size * 0.6];
  let leader = null;
  if (moved) {
    // 引き出し線: 寸法線上の最寄り点 → 移動した寸法値の下端
    const lenA = dist(a0, a1) || 1;
    const t = Math.max(0, Math.min(1, ((base[0] - a0[0]) * (a1[0] - a0[0]) + (base[1] - a0[1]) * (a1[1] - a0[1])) / (lenA * lenA)));
    leader = [[a0[0] + (a1[0] - a0[0]) * t, a0[1] + (a1[1] - a0[1]) * t], base];
  }
  const es = Math.max(0.5, endSize);
  const ends = [];
  if (endStyle === "dot") {
    const rad = Math.min(es / 2, L / 6);
    for (const c of [a0, a1]) ends.push({ type: "dot", c, r: rad });
  } else {
    const hs = Math.min(es * 2, L / 3);
    ends.push({ type: "arrow", poly: arrowHead(a1, a0, hs) }, { type: "arrow", poly: arrowHead(a0, a1, hs) });
  }
  return {
    ext0: [s0, e0],
    ext1: [s1, e1],
    line: [a0, a1],
    ends,
    head0: ends[0]?.poly,
    head1: ends[1]?.poly,
    textPos,
    textAngle: ang,
    textBase: base,
    textUp: up,
    leader,
    length: L,
  };
}

/** 図形の寸法線オプション(未設定の既存データは従来どおり矢印) */
export const dimOpts = (sh) => ({ endStyle: sh.endStyle ?? "arrow", endSize: sh.endSize ?? (sh.size || 12) / 2, textOff: sh.textOff ?? null });

/* ---------- 縮尺・計測 ---------- */

/** 基準2点 p0,p1 の実寸 real(単位 unit) から縮尺を作る。ptsPerUnit = ページ上のpt / 実寸1単位 */
export function makeScale(p0, p1, real, unit = "mm") {
  const d = dist(p0, p1);
  if (!(real > 0) || d < 0.01) return null;
  return { ptsPerUnit: d / real, unit };
}

export function measure(p0, p1, scale) {
  if (!scale) return null;
  return dist(p0, p1) / scale.ptsPerUnit;
}

export function formatLength(v, unit = "mm") {
  if (v == null || Number.isNaN(v)) return "";
  const digits = unit === "m" ? 3 : unit === "cm" ? 2 : v >= 100 ? 0 : 1;
  const s = v.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return `${s} ${unit}`;
}

/* ---------- 当たり判定 ---------- */

export function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ---------- ペンの平滑化 ---------- */

/** 入力点の指数移動平均 + 近接点の間引き。リアルタイム描画向け */
export function createPenFilter({ smoothing = 0.55, minDist = 0.6 } = {}) {
  let last = null;
  return {
    add(p) {
      if (!last) {
        last = [p[0], p[1]];
        return [last[0], last[1]];
      }
      const x = last[0] + (p[0] - last[0]) * (1 - smoothing);
      const y = last[1] + (p[1] - last[1]) * (1 - smoothing);
      if (Math.hypot(x - last[0], y - last[1]) < minDist) return null;
      last = [x, y];
      return [x, y];
    },
    reset() {
      last = null;
    },
  };
}

/** 点列 → 滑らかな二次ベジェのパス(中点法) */
export function smoothPath(pts) {
  if (!pts.length) return "";
  if (pts.length === 1) {
    const [x, y] = pts[0];
    return `M${f(x)} ${f(y)} L${f(x + 0.01)} ${f(y)}`;
  }
  if (pts.length === 2) return linePath(pts);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const m = mid(pts[i], pts[i + 1]);
    d += ` Q${f(pts[i][0])} ${f(pts[i][1])} ${f(m[0])} ${f(m[1])}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${f(last[0])} ${f(last[1])}`;
  return d;
}

/** 手書き署名など: 点が少ない・短い線でも見えるよう、点列を簡略化(Douglas-Peucker) */
export function simplify(pts, eps = 0.4) {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let max = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > eps && idx > -1) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 線種。dash: false/"" = 実線, true/"dash" = 破線, "dashdot" = 一点鎖線, "dashdot2" = 二点鎖線 */
export const DASH_TYPES = [
  { id: "", label: "実線" },
  { id: "dash", label: "破線" },
  { id: "dashdot", label: "一点鎖線" },
  { id: "dashdot2", label: "二点鎖線" },
];
export const normDash = (d) => (d === true ? "dash" : d || "");
/** 線の太さに応じた点線パターン(pt)。実線は null */
export function dashArray(dash, width = 1) {
  const w = Math.max(width, 1); // 細い線でもパターンが潰れないように
  switch (normDash(dash)) {
    case "dash": return [3 * w, 2 * w];
    case "dashdot": return [6 * w, 1.5 * w, 1 * w, 1.5 * w];
    case "dashdot2": return [6 * w, 1.5 * w, 1 * w, 1.5 * w, 1 * w, 1.5 * w];
    default: return null;
  }
}
