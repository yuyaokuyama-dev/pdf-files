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
      if (m.k !== 1) s.size = Math.max(4, (shape.size || 18) * m.k);
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
    case "pen":
    case "line":
    case "arrow":
    case "polygon":
    case "polyline":
    case "cloud":
    case "measure":
      s.pts = shape.pts.map(map);
      return s;
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
