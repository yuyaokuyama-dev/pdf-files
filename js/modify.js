// 修正コマンド(移動・回転・尺度・鏡像・配列・オフセット)の計算(DOM非依存・node でテスト可能)
// 座標系: ページ表示座標(pt, 左上原点, y は下向き)。回転角は画面で時計回りが正(度)。
import { ellipsePolygonPts, rectPoints } from "./geometry.js";

const rad = (d) => (d * Math.PI) / 180;
const clone = (o) => JSON.parse(JSON.stringify(o));
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const near0 = (v) => Math.abs(v) < 1e-9;

/** 平行移動 */
export const moveM = (dx, dy) => ({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy, k: 1, rot: 0, flip: false });
/** c を中心に deg 度(時計回り)回す */
export function rotateM(c, deg) {
  const t = rad(deg);
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return { a: cos, b: sin, c: -sin, d: cos, e: c[0] - c[0] * cos + c[1] * sin, f: c[1] - c[0] * sin - c[1] * cos, k: 1, rot: deg, flip: false };
}
/** c を中心に k 倍する */
export const scaleM = (c, k) => ({ a: k, b: 0, c: 0, d: k, e: c[0] * (1 - k), f: c[1] * (1 - k), k, rot: 0, flip: false });
/** 点 p1・p2 を通る直線で鏡像にする。同じ点なら null */
export function mirrorM(p1, p2) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-12) return null;
  const a = (dx * dx - dy * dy) / L2;
  const b = (2 * dx * dy) / L2;
  return { a, b, c: b, d: -a, e: p1[0] - a * p1[0] - b * p1[1], f: p1[1] - b * p1[0] + a * p1[1], k: 1, rot: 0, flip: true, axis: (Math.atan2(dy, dx) * 180) / Math.PI };
}
export const applyM = (m, p) => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];

/** 軸に平行な矩形(2点の四角・丸)のまま写せる変換か */
const keepsAxes = (m) => (near0(m.b) && near0(m.c)) || (near0(m.a) && near0(m.d));

/**
 * 図形に変換 m をかけた新しい図形(id は元のまま)。対応できなければ null。
 * opts.metrics(shape) → { w, h }: 文字の大きさ(文字の回転・移動に必要)
 */
export function transformShape(shape, m, opts = {}) {
  const s = clone(shape);
  const map = (p) => applyM(m, p);
  switch (shape.type) {
    case "rect":
    case "ellipse": {
      if (keepsAxes(m)) {
        s.pts = shape.pts.map(map);
        return s;
      }
      s.type = "polygon";
      s.pts = (shape.type === "rect" ? rectPoints(shape.pts[0], shape.pts[1]) : ellipsePolygonPts(shape.pts[0], shape.pts[1], 48)).map(map);
      if (shape.type === "rect") delete s.pitch;
      return s;
    }
    case "arc": {
      const c = map(shape.pts[0]);
      let a = map(shape.pts[1]);
      if (m.flip) {
        // 向きが逆になるので、終点を新しい始点にする
        const t = (shape.sweep * Math.PI) / 180;
        const [cx, cy] = shape.pts[0];
        const [ax, ay] = shape.pts[1];
        const end = [cx + (ax - cx) * Math.cos(t) - (ay - cy) * Math.sin(t), cy + (ax - cx) * Math.sin(t) + (ay - cy) * Math.cos(t)];
        a = map(end);
      }
      s.pts = [c, a];
      return s;
    }
    case "text": {
      const mt = opts.metrics?.(shape);
      if (!mt) {
        s.pts = [map(shape.pts[0])];
        return s;
      }
      const ang = rad(shape.angle || 0);
      const ctr = [shape.pts[0][0] + (mt.w / 2) * Math.cos(ang) - (mt.h / 2) * Math.sin(ang), shape.pts[0][1] + (mt.w / 2) * Math.sin(ang) + (mt.h / 2) * Math.cos(ang)];
      const nc = map(ctr);
      if (m.k !== 1) s.size = Math.max(1, (shape.size || 18) * m.k);
      const na = (((shape.angle || 0) + (m.flip ? 0 : m.rot)) % 360 + 360) % 360;
      if (na) s.angle = na;
      else delete s.angle;
      const mt2 = m.k !== 1 ? opts.metrics(s) : mt;
      const r = rad(na);
      s.pts = [[nc[0] - ((mt2.w / 2) * Math.cos(r) - (mt2.h / 2) * Math.sin(r)), nc[1] - ((mt2.w / 2) * Math.sin(r) + (mt2.h / 2) * Math.cos(r))]];
      return s;
    }
    case "image":
    case "stamp":
    case "sign": {
      // 向きは変えず、位置(と大きさ)だけ写す。回転・斜めの鏡像は対象外
      if (!keepsAxes(m) || m.rot % 90 !== 0) return null;
      const a = map(shape.pts[0]);
      const b = map(shape.pts[1]);
      s.pts = [a, b];
      return s;
    }
    case "leader":
      s.pts = shape.pts.map(map);
      if (m.k !== 1) {
        s.size = Math.max(1, (shape.size || 14) * m.k);
        if (shape.tipSize) s.tipSize = shape.tipSize * m.k;
      }
      return s;
    case "pen":
    case "line":
    case "arrow":
    case "polygon":
    case "polyline":
    case "cloud":
    case "measure":
      s.pts = shape.pts.map(map);
      return s;
    case "dimang": {
      s.pts = shape.pts.map(map);
      if (shape.r != null) s.r = shape.r * m.k;
      return s;
    }
    case "dim": {
      s.pts = shape.pts.map(map);
      s.off = (shape.off ?? 24) * m.k * (m.flip ? -1 : 1);
      if (shape.textOff) s.textOff = shape.textOff.map((v) => v * m.k);
      return s;
    }
    default:
      return null;
  }
}

/** 矩形状配列: 行 rows × 列 cols。dx は列の間隔、dy は行の間隔(画面で右・下が正)。{ m, row, col } の一覧(元の位置 0,0 を除く) */
export function rectArray(rows, cols, dx, dy) {
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (r || c) out.push(moveM(c * dx, r * dy));
  return out;
}
/** 円形状配列: 中心 c のまわりに count 個(元を含む)。angle は全体の角度(360 なら一周)。 */
export function polarArray(c, count, angle) {
  const out = [];
  const step = Math.abs(angle) >= 360 - 1e-9 ? angle / count : count > 1 ? angle / (count - 1) : 0;
  for (let i = 1; i < count; i++) {
    out.push(rotateM(c, step * i));
  }
  return out;
}

/** 点 p から線分 ab までの符号つき距離(左右)と最短距離 */
function sideOf(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (L * L)));
  const q = [a[0] + dx * t, a[1] + dy * t];
  return { side: (p[0] - a[0]) * nx + (p[1] - a[1]) * ny, d: dist(p, q) };
}

/** 折れ線を距離 d だけ平行にずらす。side は +1 (進行方向に対して画面の右側/下寄り) か -1。角はマイターで結ぶ */
export function offsetPolyline(pts, d, side, closed) {
  const n = pts.length;
  if (n < 2 || !(d > 0)) return null;
  const segs = closed ? n : n - 1;
  const norm = [];
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const L = dist(a, b);
    if (L < 1e-9) return null;
    norm.push([(-(b[1] - a[1]) / L) * side, ((b[0] - a[0]) / L) * side]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const n1 = closed ? norm[(i - 1 + segs) % segs] : norm[Math.max(0, i - 1)];
    const n2 = closed ? norm[i % segs] : norm[Math.min(segs - 1, i)];
    if (!closed && (i === 0 || i === n - 1)) {
      const nn = i === 0 ? norm[0] : norm[segs - 1];
      out.push([pts[i][0] + nn[0] * d, pts[i][1] + nn[1] * d]);
      continue;
    }
    const dot = n1[0] * n2[0] + n1[1] * n2[1];
    const k = 1 + dot;
    if (k < 0.15) out.push([pts[i][0] + n1[0] * d, pts[i][1] + n1[1] * d]); // ほぼ折り返し: 角を作らない
    else out.push([pts[i][0] + ((n1[0] + n2[0]) / k) * d, pts[i][1] + ((n1[1] + n2[1]) / k) * d]);
  }
  return out;
}

/**
 * オフセット(平行複写)。図形 shape を、点 p のある側へ距離 d ずらした新しい図形。対応外・作れないときは null。
 * 閉じた図形(四角・丸・多角形・雲)は p が外なら外側へ、内なら内側へ。
 */
export function offsetShape(shape, d, p) {
  if (!(d > 0)) return null;
  const s = clone(shape);
  switch (shape.type) {
    case "line":
    case "arrow":
    case "polyline":
    case "polygon":
    case "cloud": {
      const closed = shape.type === "polygon" || shape.type === "cloud";
      const pts = shape.pts;
      let best = null;
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) {
        const r = sideOf(pts[i], pts[(i + 1) % pts.length], p);
        if (!best || r.d < best.d) best = r;
      }
      if (!best) return null;
      const out = offsetPolyline(pts, d, best.side >= 0 ? 1 : -1, closed);
      if (!out) return null;
      s.pts = out;
      return s;
    }
    case "rect":
    case "ellipse": {
      const [a, b] = shape.pts;
      const x0 = Math.min(a[0], b[0]);
      const x1 = Math.max(a[0], b[0]);
      const y0 = Math.min(a[1], b[1]);
      const y1 = Math.max(a[1], b[1]);
      let inside;
      if (shape.type === "rect") inside = p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1;
      else {
        const rx = (x1 - x0) / 2 || 1e-9;
        const ry = (y1 - y0) / 2 || 1e-9;
        inside = ((p[0] - (x0 + x1) / 2) / rx) ** 2 + ((p[1] - (y0 + y1) / 2) / ry) ** 2 < 1;
      }
      const e = inside ? -d : d;
      const nx0 = x0 - e;
      const nx1 = x1 + e;
      const ny0 = y0 - e;
      const ny1 = y1 + e;
      if (nx1 - nx0 < 1e-6 || ny1 - ny0 < 1e-6) return null;
      s.pts = [[nx0, ny0], [nx1, ny1]];
      return s;
    }
    case "arc": {
      const c = shape.pts[0];
      const r = dist(c, shape.pts[1]);
      const nr = dist(p, c) < r ? r - d : r + d;
      if (r < 1e-9 || nr < 1e-6) return null;
      const k = nr / r;
      s.pts = [c, [c[0] + (shape.pts[1][0] - c[0]) * k, c[1] + (shape.pts[1][1] - c[1]) * k]];
      return s;
    }
    default:
      return null;
  }
}

/* =========================================================
 * トリム・延長・フィレット・面取り・ストレッチ・切断・結合・分解
 * ======================================================= */
const EPS = 1e-6;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const unit = (v) => {
  const L = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / L, v[1] / L];
};

/** 線分 ab 上の位置 t(0〜1)で線分 cd と交わるなら t。なければ null */
function segHitT(a, b, c, d) {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const qp = sub(c, a);
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return t;
}

/** 折れ線の累積長さ */
function cumLen(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + dist(pts[i - 1], pts[i]));
  return out;
}
/** 折れ線の弧長 s の位置の点 */
function pointAtLen(pts, cum, s) {
  for (let i = 1; i < pts.length; i++) {
    if (s <= cum[i] + EPS) {
      const seg = cum[i] - cum[i - 1] || 1;
      const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / seg));
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
  }
  return pts[pts.length - 1];
}
/** 弧長 s0〜s1 の部分の折れ線 */
function subPolyline(pts, cum, s0, s1) {
  const out = [pointAtLen(pts, cum, s0)];
  for (let i = 1; i < pts.length - 1; i++) if (cum[i] > s0 + EPS && cum[i] < s1 - EPS) out.push(pts[i]);
  out.push(pointAtLen(pts, cum, s1));
  return out;
}
/** 点 p に最も近い折れ線上の位置 { s: 弧長, d: 距離, i: 区間, q: 点 } */
function project(pts, cum, p) {
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2));
    const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = dist(p, q);
    if (!best || d < best.d) best = { s: cum[i - 1] + (cum[i] - cum[i - 1]) * t, d, i, q };
  }
  return best;
}

/**
 * トリム: 他の図形の線分(cutters: [[a,b],...])との交点で区切って、pick に近い区間を消す。
 * 戻り値は残る折れ線の配列(0〜2個)。交点がなければ null
 */
export function trimPolyline(pts, cutters, pick) {
  if (pts.length < 2) return null;
  const cum = cumLen(pts);
  const total = cum[cum.length - 1];
  const cuts = [];
  for (let i = 1; i < pts.length; i++) {
    for (const [c, d] of cutters) {
      const t = segHitT(pts[i - 1], pts[i], c, d);
      if (t == null) continue;
      const s = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
      if (s > EPS && s < total - EPS) cuts.push(s);
    }
  }
  if (!cuts.length) return null;
  cuts.sort((a, b) => a - b);
  const bounds = [0, ...cuts.filter((s, i) => i === 0 || s - cuts[i - 1] > EPS), total];
  const sp = project(pts, cum, pick).s;
  let k = 0;
  while (k < bounds.length - 2 && sp > bounds[k + 1]) k++;
  const lo = bounds[k];
  const hi = bounds[k + 1];
  const out = [];
  if (lo > EPS) out.push(subPolyline(pts, cum, 0, lo));
  if (hi < total - EPS) out.push(subPolyline(pts, cum, hi, total));
  return out;
}

/** 延長: pick に近い側の端を、いまの向きのまま最初に当たる線分まで伸ばす。当たらなければ null */
export function extendPolyline(pts, cutters, pick) {
  if (pts.length < 2) return null;
  const atStart = dist(pick, pts[0]) < dist(pick, pts[pts.length - 1]);
  const E = atStart ? pts[0] : pts[pts.length - 1];
  const P = atStart ? pts[1] : pts[pts.length - 2];
  if (dist(E, P) < EPS) return null;
  const u = unit(sub(E, P));
  const far = [E[0] + u[0] * 1e5, E[1] + u[1] * 1e5];
  let best = null;
  for (const [c, d] of cutters) {
    const t = segHitT(E, far, c, d);
    if (t == null) continue;
    const s = t * 1e5;
    if (s > 1e-3 && (best == null || s < best)) best = s;
  }
  if (best == null) return null;
  const tip = [E[0] + u[0] * best, E[1] + u[1] * best];
  const out = pts.map((p) => [p[0], p[1]]);
  out[atStart ? 0 : out.length - 1] = tip;
  return out;
}

/**
 * フィレット/面取りの共通部分: 2本の線 l1, l2 ([a,b])の延長上の交点 X と、pick の側に残る端 F1, F2
 */
function corner(l1, l2, p1, p2) {
  const r = sub(l1[1], l1[0]);
  const s = sub(l2[1], l2[0]);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = sub(l2[0], l1[0]);
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const X = [l1[0][0] + r[0] * t, l1[0][1] + r[1] * t];
  // pick の側 = 交点から見て pick と同じ向きにある端
  const side = (l, p) => {
    const d0 = dot(sub(p, X), sub(l[0], X));
    const d1 = dot(sub(p, X), sub(l[1], X));
    return d0 > d1 ? l[0] : l[1];
  };
  const F1 = side(l1, p1);
  const F2 = side(l2, p2);
  if (dist(F1, X) < EPS || dist(F2, X) < EPS) return null;
  return { X, F1, F2, u1: unit(sub(F1, X)), u2: unit(sub(F2, X)) };
}

/**
 * フィレット: 2本の線 l1, l2 を半径 r の円弧でつなぐ(r=0 なら角をそろえる)。
 * { l1:[a,b], l2:[a,b], arc:{ pts:[中心,始点], sweep }|null }。作れなければ null
 */
export function filletLines(l1, l2, r, p1, p2) {
  const c = corner(l1, l2, p1, p2);
  if (!c) return null;
  if (!(r > 0)) return { l1: [c.X, c.F1], l2: [c.X, c.F2], arc: null };
  const cosT = Math.max(-1, Math.min(1, dot(c.u1, c.u2)));
  const th = Math.acos(cosT);
  if (th < 1e-3 || th > Math.PI - 1e-3) return null;
  const t = r / Math.tan(th / 2);
  if (t > dist(c.X, c.F1) + EPS || t > dist(c.X, c.F2) + EPS) return null;
  const T1 = [c.X[0] + c.u1[0] * t, c.X[1] + c.u1[1] * t];
  const T2 = [c.X[0] + c.u2[0] * t, c.X[1] + c.u2[1] * t];
  const bis = unit([c.u1[0] + c.u2[0], c.u1[1] + c.u2[1]]);
  const k = r / Math.sin(th / 2);
  const C = [c.X[0] + bis[0] * k, c.X[1] + bis[1] * k];
  const a = sub(T1, C);
  const b = sub(T2, C);
  const cross = a[0] * b[1] - a[1] * b[0];
  const sweep = 180 - (th * 180) / Math.PI;
  return { l1: [T1, c.F1], l2: [T2, c.F2], arc: { pts: [C, cross > 0 ? T1 : T2], sweep } };
}

/**
 * 四角・多角形・ポリラインの角を半径 r の円弧(折れ線で近似)で丸める。
 * only: 丸める頂点の番号(省略なら全部)。端(開いたポリラインの両端)は丸めない。
 * 半径は両隣の辺の長さに収まるよう自動で小さくなる(全部丸めるときは辺の半分まで)。変わらなければ null
 */
export function roundCorners(pts, closed, r, only = null) {
  if (!(r > 0) || pts.length < 3) return null;
  const n = pts.length;
  const all = only == null;
  const out = [];
  let changed = false;
  for (let i = 0; i < n; i++) {
    const V = pts[i];
    const edge = !closed && (i === 0 || i === n - 1);
    if (edge || (!all && !only.includes(i))) {
      out.push(V);
      continue;
    }
    const P = pts[(i + n - 1) % n];
    const Q = pts[(i + 1) % n];
    const l1 = dist(V, P);
    const l2 = dist(V, Q);
    const cosT = l1 && l2 ? dot(unit(sub(P, V)), unit(sub(Q, V))) : 1;
    const th = Math.acos(Math.max(-1, Math.min(1, cosT)));
    if (th < 1e-3 || th > Math.PI - 1e-3) {
      out.push(V);
      continue;
    }
    const share = all ? 0.5 : 1;
    let t = r / Math.tan(th / 2);
    t = Math.min(t, l1 * share, l2 * share);
    const rr = t * Math.tan(th / 2);
    const u1 = unit(sub(P, V));
    const u2 = unit(sub(Q, V));
    const T1 = [V[0] + u1[0] * t, V[1] + u1[1] * t];
    const T2 = [V[0] + u2[0] * t, V[1] + u2[1] * t];
    const bis = unit([u1[0] + u2[0], u1[1] + u2[1]]);
    const k = rr / Math.sin(th / 2);
    const C = [V[0] + bis[0] * k, V[1] + bis[1] * k];
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    let d = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const seg = Math.max(3, Math.ceil((Math.abs(d) * 180) / Math.PI / 12));
    for (let j = 0; j <= seg; j++) {
      const a = a1 + (d * j) / seg;
      out.push([+(C[0] + rr * Math.cos(a)).toFixed(3), +(C[1] + rr * Math.sin(a)).toFixed(3)]);
    }
    changed = true;
  }
  return changed ? out : null;
}

/** 面取り: 交点から d1, d2 の距離で2本の線を切り、斜めの線でつなぐ。{ l1, l2, line:[a,b] }。作れなければ null */
export function chamferLines(l1, l2, d1, d2, p1, p2) {
  const c = corner(l1, l2, p1, p2);
  if (!c || !(d1 >= 0) || !(d2 >= 0)) return null;
  if (d1 > dist(c.X, c.F1) + EPS || d2 > dist(c.X, c.F2) + EPS) return null;
  if (d1 < EPS && d2 < EPS) return { l1: [c.X, c.F1], l2: [c.X, c.F2], line: null };
  const T1 = [c.X[0] + c.u1[0] * d1, c.X[1] + c.u1[1] * d1];
  const T2 = [c.X[0] + c.u2[0] * d2, c.X[1] + c.u2[1] * d2];
  return { l1: [T1, c.F1], l2: [T2, c.F2], line: [T1, T2] };
}

const inWin = (p, w) => p[0] >= w.x - EPS && p[0] <= w.x + w.w + EPS && p[1] >= w.y - EPS && p[1] <= w.y + w.h + EPS;

/**
 * ストレッチ: 窓 w(交差窓 {x,y,w,h})に入る頂点だけを (dx,dy) 動かす。
 * bounds は図形の外接枠。完全に窓の中なら図形ごと動かす。動かせない(変化なし・対象外)なら null
 */
export function stretchShape(shape, w, dx, dy, bounds) {
  const inside = bounds && bounds.x >= w.x - EPS && bounds.y >= w.y - EPS && bounds.x + bounds.w <= w.x + w.w + EPS && bounds.y + bounds.h <= w.y + w.h + EPS;
  if (inside) return transformShape(shape, moveM(dx, dy));
  const s = clone(shape);
  const mv = (p) => [p[0] + dx, p[1] + dy];
  switch (shape.type) {
    case "line":
    case "arrow":
    case "polyline":
    case "polygon":
    case "cloud":
    case "measure":
    case "dim": {
      let any = false;
      s.pts = shape.pts.map((p) => {
        if (inWin(p, w)) {
          any = true;
          return mv(p);
        }
        return p;
      });
      return any ? s : null;
    }
    case "rect": {
      const [a, b] = shape.pts;
      let x0 = Math.min(a[0], b[0]);
      let x1 = Math.max(a[0], b[0]);
      let y0 = Math.min(a[1], b[1]);
      let y1 = Math.max(a[1], b[1]);
      const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map((p) => inWin(p, w));
      // 辺(隣り合う2頂点)が窓に入っているときだけ、その辺を動かす
      if (c[0] && c[1] && !c[2] && !c[3]) y0 += dy;
      else if (c[1] && c[2] && !c[0] && !c[3]) x1 += dx;
      else if (c[2] && c[3] && !c[0] && !c[1]) y1 += dy;
      else if (c[3] && c[0] && !c[1] && !c[2]) x0 += dx;
      else return null;
      if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) return null;
      s.pts = [[x0, y0], [x1, y1]];
      return s;
    }
    default:
      return null;
  }
}

/** 切断: 点 p に最も近い位置で折れ線を2つに分ける。端に近すぎるときは null */
export function splitPolyline(pts, p, tol = 0.5) {
  if (pts.length < 2) return null;
  const cum = cumLen(pts);
  const pr = project(pts, cum, p);
  if (pr.s < tol || cum[cum.length - 1] - pr.s < tol) return null;
  const A = pts.slice(0, pr.i).map((q) => [q[0], q[1]]);
  A.push(pr.q);
  const B = [pr.q, ...pts.slice(pr.i).map((q) => [q[0], q[1]])];
  return [A, B];
}

/**
 * 結合: 端点が tol 以内でつながる折れ線をひと続きにする。
 * items: [{ id, pts }]。戻り値: [{ ids, pts, closed }](つながらなかった単独のものも含む)
 */
export function joinChains(items, tol = 0.5) {
  const left = items.map((it) => ({ ids: [it.id], pts: it.pts.map((p) => [p[0], p[1]]) }));
  const out = [];
  while (left.length) {
    const cur = left.shift();
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < left.length; i++) {
        const o = left[i];
        const cs = cur.pts[0];
        const ce = cur.pts[cur.pts.length - 1];
        const os = o.pts[0];
        const oe = o.pts[o.pts.length - 1];
        let next = null;
        if (dist(ce, os) <= tol) next = [...cur.pts, ...o.pts.slice(1)];
        else if (dist(ce, oe) <= tol) next = [...cur.pts, ...o.pts.slice(0, -1).reverse()];
        else if (dist(cs, oe) <= tol) next = [...o.pts, ...cur.pts.slice(1)];
        else if (dist(cs, os) <= tol) next = [...o.pts.slice(1).reverse(), ...cur.pts];
        if (next) {
          cur.pts = next;
          cur.ids.push(...o.ids);
          left.splice(i, 1);
          grown = true;
          break;
        }
      }
    }
    const closed = cur.pts.length >= 4 && dist(cur.pts[0], cur.pts[cur.pts.length - 1]) <= tol;
    if (closed) cur.pts = cur.pts.slice(0, -1);
    out.push({ ids: cur.ids, pts: cur.pts, closed });
  }
  return out;
}

/** 分解: ポリライン・多角形・四角を1本ずつの線にする(id なしの線の一覧)。分解できなければ null */
export function explodeShape(shape) {
  let pts;
  let closed = false;
  if (shape.type === "polyline") pts = shape.pts;
  else if (shape.type === "polygon") {
    pts = shape.pts;
    closed = true;
  } else if (shape.type === "rect") {
    pts = rectPoints(shape.pts[0], shape.pts[1]);
    closed = true;
  } else return null;
  const n = closed ? pts.length : pts.length - 1;
  if (n < 2 && !(n === 1 && !closed)) return null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const l = clone(shape);
    delete l.pitch;
    delete l.sweep;
    l.type = "line";
    l.pts = [pts[i].slice(), pts[(i + 1) % pts.length].slice()];
    if (l.style) l.style = { ...l.style, fill: "none" };
    out.push(l);
  }
  return out;
}
