/* 元PDFの「線」を取り出す(DXF書き出し用)。pdf.js の operator list を読み、
 * 線として描かれた経路を、画面と同じ向き・単位(pt)の折れ線にして返す。文字・画像・塗りだけの図形は対象外。 */

const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };
const STROKE_OPS = ["stroke", "closeStroke", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"];
const CLOSE_OPS = ["closeStroke", "closeFillStroke", "closeEOFillStroke"];

const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function colorHex(a) {
  if (typeof a === "string") return /^#[0-9a-f]{6}$/i.test(a) ? a.toLowerCase() : null;
  if (a && a.length >= 3) {
    const h = (v) => Math.max(0, Math.min(255, Math.round(v <= 1 ? v * 255 : v))).toString(16).padStart(2, "0");
    return "#" + h(a[0]) + h(a[1]) + h(a[2]);
  }
  return null;
}

/**
 * @param {{fnArray:number[], argsArray:any[]}} ol  pdf.js の getOperatorList() の結果
 * @param {object} OPS  pdfjs.OPS
 * @param {number[]} vt  viewport.transform(PDF座標 → 表示座標)
 * @param {{maxPaths?:number, curveSteps?:number}} opts
 * @returns {{paths:{pts:number[][],closed:boolean,color:string,width:number}[], truncated:boolean}}
 */
export function extractVectorPaths(ol, OPS, vt, opts = {}) {
  const maxPaths = opts.maxPaths ?? 50000;
  const steps = opts.curveSteps ?? 8;
  const strokeSet = new Set(STROKE_OPS.map((n) => OPS[n]).filter((v) => v != null));
  const closeSet = new Set(CLOSE_OPS.map((n) => OPS[n]).filter((v) => v != null));
  const paths = [];
  let truncated = false;
  let ctm = vt.slice();
  let color = "#000000";
  let lw = 1;
  const stack = [];
  const form = [];

  const emit = (subs, closeAll) => {
    for (const s of subs) {
      if (s.pts.length < 2) continue;
      if (paths.length >= maxPaths) { truncated = true; return; }
      const k = Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
      paths.push({ pts: s.pts, closed: s.closed || closeAll, color, width: lw * k });
    }
  };

  const walk = (data) => {
    const subs = [];
    let cur = null, last = null, i = 0;
    const pt = (x, y) => apply(ctm, x, y);
    while (i < data.length) {
      const op = data[i++];
      if (op === DRAW.moveTo) {
        last = pt(data[i], data[i + 1]); i += 2;
        cur = { pts: [last], closed: false };
        subs.push(cur);
      } else if (op === DRAW.lineTo) {
        if (!cur) { cur = { pts: [], closed: false }; subs.push(cur); }
        last = pt(data[i], data[i + 1]); i += 2;
        cur.pts.push(last);
      } else if (op === DRAW.curveTo) {
        const p1 = pt(data[i], data[i + 1]), p2 = pt(data[i + 2], data[i + 3]), p3 = pt(data[i + 4], data[i + 5]); i += 6;
        if (!cur) { cur = { pts: [p1], closed: false }; subs.push(cur); last = p1; }
        const p0 = last;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, u = 1 - t;
          cur.pts.push([
            u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
            u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
          ]);
        }
        last = p3;
      } else if (op === DRAW.quadraticCurveTo) {
        const p1 = pt(data[i], data[i + 1]), p2 = pt(data[i + 2], data[i + 3]); i += 4;
        if (!cur) { cur = { pts: [p1], closed: false }; subs.push(cur); last = p1; }
        const p0 = last;
        for (let s = 1; s <= steps; s++) {
          const t = s / steps, u = 1 - t;
          cur.pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
        }
        last = p2;
      } else if (op === DRAW.closePath) {
        if (cur) { cur.closed = true; last = cur.pts[0]; }
      } else break; // 未知の命令は読み飛ばせないので打ち切る
    }
    return subs;
  };

  const { fnArray, argsArray } = ol;
  for (let n = 0; n < fnArray.length && !truncated; n++) {
    const f = fnArray[n], a = argsArray[n];
    if (f === OPS.save) stack.push({ ctm: ctm.slice(), color, lw });
    else if (f === OPS.restore) {
      const s = stack.pop();
      if (s) ({ ctm, color, lw } = { ctm: s.ctm, color: s.color, lw: s.lw });
    } else if (f === OPS.transform) ctm = mul(ctm, a);
    else if (f === OPS.paintFormXObjectBegin) {
      form.push({ ctm: ctm.slice(), color, lw });
      if (a && a[0]) ctm = mul(ctm, a[0]);
    } else if (f === OPS.paintFormXObjectEnd) {
      const s = form.pop();
      if (s) ({ ctm, color, lw } = { ctm: s.ctm, color: s.color, lw: s.lw });
    } else if (f === OPS.setLineWidth) lw = +a[0] || 0;
    else if (f === OPS.setStrokeRGBColor) color = colorHex(a.length === 1 ? a[0] : a) || color;
    else if (f === OPS.constructPath) {
      // a = [塗り/線の命令, [経路データ], 範囲]。線を描く命令のものだけ取り出す
      if (strokeSet.has(a[0])) emit(walk(Array.isArray(a[1]) ? a[1][0] : a[1]), closeSet.has(a[0]));
    }
  }
  return { paths, truncated };
}
