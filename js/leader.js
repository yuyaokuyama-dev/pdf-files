// 文字つき引出線の幾何(DOM非依存・node でテスト可能)
// pts[0] = 先端(矢印・黒丸を置く側)、pts[1] = 文字側の端(アンダーラインの端、または囲みの縁の中央)
// 文字の大きさ m = { w, h } は呼び出し側が測って渡す(文字なしなら null)
import { arrowHead, arrowShaft, bbox } from "./geometry.js";

export const LEADER_BOXES = [
  { id: "underline", label: "アンダーライン" },
  { id: "circle", label: "丸で囲う" },
  { id: "none", label: "囲みなし" },
];
export const LEADER_TIPS = [
  { id: "arrow", label: "矢印" },
  { id: "dot", label: "黒丸" },
  { id: "none", label: "なし" },
];
export const LEADER_DEFAULT = { size: 14, box: "underline", tip: "arrow", tipSize: 8 };

const f = (n) => +n.toFixed(2);

/** 丸・長丸(両端が半円の長方形)のパス */
export function stadiumPath({ x, y, w, h }) {
  const r = h / 2;
  return `M${f(x + r)} ${f(y)} H${f(x + w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w - r)} ${f(y + h)} H${f(x + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} Z`;
}

/**
 * 引出線の形。返り値:
 *  line: 引出線(先端側は矢じりの根元まで) / tipShape: { type:"arrow", poly } | { type:"dot", c, r } | null
 *  box: { type:"underline", pts:[p,q] } | { type:"stadium", x, y, w, h } | null
 *  textTL: 文字ボックスの左上 / dir: 文字が anchor から伸びる向き(+1 右 / -1 左) / bounds: 全体の外接枠
 */
export function leaderGeometry(shape, m) {
  const [tip, anchor] = shape.pts;
  const size = shape.size || LEADER_DEFAULT.size;
  const tipSize = shape.tipSize ?? LEADER_DEFAULT.tipSize;
  const mode = shape.tip ?? LEADER_DEFAULT.tip;
  const boxMode = shape.box ?? LEADER_DEFAULT.box;
  const dir = anchor[0] >= tip[0] ? 1 : -1;
  const pad = size * 0.35;

  let line = [anchor, tip];
  let tipShape = null;
  if (mode === "arrow") {
    line = arrowShaft(anchor, tip, tipSize);
    tipShape = { type: "arrow", poly: arrowHead(anchor, tip, tipSize) };
  } else if (mode === "dot") {
    tipShape = { type: "dot", c: tip, r: tipSize / 2 };
  }

  const pts = [tip, anchor];
  let box = null;
  let textTL = null;
  if (m) {
    if (boxMode === "circle") {
      const H = m.h + 2 * pad;
      const W = Math.max(H, m.w + H * 0.45);
      const x = dir > 0 ? anchor[0] : anchor[0] - W;
      const y = anchor[1] - H / 2;
      box = { type: "stadium", x, y, w: W, h: H };
      textTL = [x + (W - m.w) / 2, y + (H - m.h) / 2];
      pts.push([x, y], [x + W, y + H]);
    } else if (boxMode === "underline") {
      const W = m.w + 2 * pad;
      const end = [anchor[0] + dir * W, anchor[1]];
      box = { type: "underline", pts: [anchor, end] };
      textTL = [dir > 0 ? anchor[0] + pad : anchor[0] - W + pad, anchor[1] - m.h - pad * 0.4];
      pts.push(end, textTL, [textTL[0] + m.w, textTL[1] + m.h]);
    } else {
      textTL = [dir > 0 ? anchor[0] + pad : anchor[0] - pad - m.w, anchor[1] - m.h / 2];
      pts.push(textTL, [textTL[0] + m.w, textTL[1] + m.h]);
    }
  }
  const b = bbox(pts);
  const e = tipShape?.type === "dot" ? tipSize / 2 : 0;
  return { line, tipShape, box, textTL, dir, bounds: { x: b.x - e, y: b.y - e, w: b.w + 2 * e, h: b.h + 2 * e } };
}
