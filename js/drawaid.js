// 作図の補助: オブジェクトスナップ・極トラッキング(Shift=90°固定)・数値入力(動的入力)
import { formatLength, dist } from "./geometry.js";
import { visibleShapes } from "./layers.js";
import { DEFAULT_SNAP, SNAP_LABELS, collectSnapPoints, nearestSnap, polarSnap, polarOf, pointAt } from "./snap.js";

const NS = "http://www.w3.org/2000/svg";
const sv = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/** クリック→数値入力で作れる図形 */
export const DYN_TOOLS = new Set(["line", "arrow", "rect", "ellipse"]);
const FIELDS = {
  line: [{ k: "len", label: "長さ" }, { k: "ang", label: "角度", unit: "°" }],
  arrow: [{ k: "len", label: "長さ" }, { k: "ang", label: "角度", unit: "°" }],
  rect: [{ k: "w", label: "幅" }, { k: "h", label: "高さ" }],
  ellipse: [{ k: "r", label: "半径" }],
};

export class DrawAid {
  constructor(ed) {
    this.ed = ed;
    this.cfg = { ...DEFAULT_SNAP, kinds: [...DEFAULT_SNAP.kinds] };
    this.pend = null;
    this.box = null;
  }

  setConfig(patch) {
    this.cfg = { ...this.cfg, ...patch };
    if (!this.cfg.dyn) this.cancelPending();
    this.ed.emit("snap-config", this.cfg);
  }

  /* ---------- スナップ ---------- */
  /** ページ内のスナップ候補点(ジェスチャーの開始時に1回だけ作る) */
  pointsFor(pageId, exclude) {
    if (!this.cfg.osnap || !this.cfg.kinds.length) return [];
    const page = this.ed.model.page(pageId);
    if (!page) return [];
    return collectSnapPoints(visibleShapes(page.shapes, this.ed.model.layers), { kinds: this.cfg.kinds, exclude });
  }

  /**
   * 点 raw をスナップした結果 { p, mark } を返す。
   * pts: pointsFor() の結果 / p0: 基準点(あれば極トラッキング) / ev: Shift で 90° 固定・Alt で極トラッキング
   */
  /** いまスナップを効かせるか(F3のON/OFF・モード・Ctrl/指) */
  snapOn(ev) {
    if (!this.cfg.osnap || !this.cfg.kinds.length) return false;
    if (this.cfg.mode === "always") return true;
    return ev?.pointerType === "touch" || !!(ev?.ctrlKey || ev?.metaKey);
  }

  /** 極トラッキングを効かせるか(F10のON/OFF・モード・Alt/指) */
  polarOn(ev) {
    if (!this.cfg.polar) return false;
    if (this.cfg.polarMode === "always") return true;
    return ev?.pointerType === "touch" || !!ev?.altKey;
  }

  resolve(raw, { pts = null, p0 = null, ev = null, polar = true } = {}) {
    let p = raw;
    let mark = null;
    if (pts && pts.length && this.snapOn(ev)) {
      const r = (ev?.pointerType === "touch" ? 18 : 10) / this.ed.zoom;
      const q = nearestSnap(pts, raw, r);
      if (q) {
        p = q.p;
        mark = q;
      }
    }
    if (!mark && p0 && polar) {
      const lock = !!ev?.shiftKey;
      if (lock || this.polarOn(ev)) {
        const r = polarSnap(p0, raw, { step: this.cfg.step, tol: 3, lock90: lock });
        if (r.snapped) {
          p = r.p;
          mark = { p, kind: "polar", from: p0, ang: r.ang };
        }
      }
    }
    return { p, mark };
  }

  /* ---------- 表示 ---------- */
  /** スナップの印と極トラッキングの補助線を draft レイヤーに描く */
  drawMark(layer, mark) {
    if (!mark) return;
    const z = this.ed.zoom;
    const s = 5 / z;
    const col = "#16a34a";
    const sw = 1.6 / z;
    if (mark.kind === "polar") {
      layer.appendChild(sv("line", { x1: mark.from[0], y1: mark.from[1], x2: mark.p[0], y2: mark.p[1], stroke: col, "stroke-width": 1 / z, "stroke-dasharray": `${4 / z} ${3 / z}`, "pointer-events": "none" }));
      return;
    }
    const [x, y] = mark.p;
    const at = { fill: "none", stroke: col, "stroke-width": sw, "pointer-events": "none" };
    let m;
    switch (mark.kind) {
      case "mid":
        m = sv("path", { ...at, d: `M${x - s} ${y + s} L${x + s} ${y + s} L${x} ${y - s} Z` });
        break;
      case "center":
        m = sv("circle", { ...at, cx: x, cy: y, r: s });
        break;
      case "quad":
        m = sv("path", { ...at, d: `M${x} ${y - s * 1.2} L${x + s * 1.2} ${y} L${x} ${y + s * 1.2} L${x - s * 1.2} ${y} Z` });
        break;
      case "int":
        m = sv("path", { ...at, d: `M${x - s} ${y - s} L${x + s} ${y + s} M${x - s} ${y + s} L${x + s} ${y - s}` });
        break;
      default:
        m = sv("rect", { ...at, x: x - s, y: y - s, width: s * 2, height: s * 2 });
    }
    layer.appendChild(m);
    const name = SNAP_LABELS[mark.kind];
    if (name) {
      // AutoCAD と同じく、記号の横に種類の名前を出す
      layer.appendChild(sv("text", { x: x + s * 1.8, y: y - s * 1.8, "font-size": 11 / z, fill: col, stroke: "#fff", "stroke-width": 3 / z, "paint-order": "stroke", "font-family": "sans-serif", "pointer-events": "none" })).textContent = name;
    }
  }

  /** ボタンを押す前(マウスを動かしているだけ)でも、Ctrl中は近くのスナップ点に記号を出す */
  hover(pageId, raw, ev) {
    const el = this.ed.els.get(pageId);
    if (!el) return;
    el.draft.replaceChildren();
    if (!this.snapOn(ev)) return;
    if (!this._hp || this._hp.pageId !== pageId) this._hp = { pageId, pts: this.pointsFor(pageId) };
    const r = this.resolve(raw, { pts: this._hp.pts, polar: false, ev });
    if (r.mark) this.drawMark(el.draft, r.mark);
  }

  fmtLen(pt, page) {
    const sc = page?.scale;
    return sc ? formatLength(pt / sc.ptsPerUnit, sc.unit) : `${pt.toFixed(1)} pt`;
  }

  /** 作図中に点の横へ出す寸法表示(長さ・角度、幅×高さ、半径) */
  readout(layer, tool, p0, p1, page, mark, extra = "") {
    if (!this.cfg.dyn || !p1) return;
    let text = "";
    if (tool === "line" || tool === "arrow" || tool === "dim" || tool === "measure" || tool === "calib") {
      const { len, ang } = polarOf(p0, p1);
      text = `${this.fmtLen(len, page)}  ∠${(((ang % 360) + 360) % 360).toFixed(1).replace(/\.0$/, "")}°`;
    } else if (tool === "rect" || tool === "cloud") {
      text = `${this.fmtLen(Math.abs(p1[0] - p0[0]), page)} × ${this.fmtLen(Math.abs(p1[1] - p0[1]), page)}`;
    } else if (tool === "ellipse") {
      text = this.pend ? `半径 ${this.fmtLen(dist(p0, p1), page)}` : `${this.fmtLen(Math.abs(p1[0] - p0[0]), page)} × ${this.fmtLen(Math.abs(p1[1] - p0[1]), page)}`;
    } else if (tool === "arc" || tool === "circle") {
      text = `半径 ${this.fmtLen(dist(p0, p1), page)}`;
    } else return;
    if (mark && mark.kind !== "polar") text += `  [${SNAP_LABELS[mark.kind] || ""}]`;
    text += extra;
    const z = this.ed.zoom;
    const fs = 12 / z;
    const x = p1[0] + 12 / z;
    const y = p1[1] - 10 / z;
    const w = text.length * fs * 0.62 + 8 / z;
    layer.appendChild(sv("rect", { x: x - 4 / z, y: y - fs, width: w, height: fs + 6 / z, rx: 3 / z, fill: "#111827", "fill-opacity": 0.82, "pointer-events": "none" }));
    const t = sv("text", { x, y: y - 1 / z, fill: "#fff", "font-size": fs, "pointer-events": "none", "font-family": "system-ui, sans-serif" });
    t.textContent = text;
    layer.appendChild(t);
  }

  /* ---------- 数値入力(クリック→値を打って Enter) ---------- */
  get pending() {
    return !!this.pend;
  }

  startPending(tool, pageId, p0, pts) {
    this.cancelPending();
    const page = this.ed.model.page(pageId);
    this.pend = { tool, pageId, p0, hover: [p0[0] + 60, p0[1]], mark: null, pts, typed: {}, unit: page?.scale?.unit || "pt" };
    const el = this.ed.els.get(pageId);
    this.moveFn = (ev) => {
      if (!this.pend) return;
      const raw = this.ed.clampToPage(this.ed.pt(ev, pageId), pageId);
      const r = this.resolve(raw, { pts: this.pend.pts, p0, ev, polar: tool === "line" || tool === "arrow" });
      this.pend.hover = r.p;
      this.pend.mark = r.mark;
      this.draw();
    };
    el.svg.addEventListener("pointermove", this.moveFn);
    this.buildBox();
    this.draw();
  }

  cancelPending() {
    const pd = this.pend;
    if (!pd) return;
    this.pend = null;
    const el = this.ed.els.get(pd.pageId);
    if (el) {
      el.svg.removeEventListener("pointermove", this.moveFn);
      el.draft.replaceChildren();
    }
    this.box?.remove();
    this.box = null;
  }

  buildBox() {
    const pd = this.pend;
    const box = document.createElement("div");
    box.className = "dynbox";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "数値入力");
    box.innerHTML =
      FIELDS[pd.tool]
        .map((f) => `<label>${f.label}<input type="text" inputmode="decimal" data-k="${f.k}" autocomplete="off" aria-label="${f.label}"><span>${f.unit ?? pd.unit}</span></label>`)
        .join("") + `<small>Enter で確定 / 空欄は画面の位置 / Esc で中止</small>`;
    box.addEventListener("input", (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const v = parseFloat(String(e.target.value).replace(/,/g, "").replace(/[０-９．]/g, (c) => (c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0))));
      if (Number.isFinite(v)) pd.typed[k] = v;
      else delete pd.typed[k];
      this.draw();
    });
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.cancelPending();
        this.ed.viewer.focus?.();
      } else if (e.key === "Enter") {
        e.preventDefault();
        const inputs = [...box.querySelectorAll("input")];
        const i = inputs.indexOf(e.target);
        if (i >= 0 && i < inputs.length - 1 && !inputs.slice(i + 1).some((n) => n.value)) {
          // 次の欄へ(幅→高さ、長さ→角度)。次の欄を打たずに確定したいときはもう一度 Enter
          inputs[i + 1].focus();
          inputs[i + 1].select();
        } else this.commit();
      }
    });
    document.body.appendChild(box);
    this.box = box;
    this.place();
    box.querySelector("input")?.focus({ preventScroll: true });
  }

  place() {
    if (!this.box) return;
    const r = this.ed.viewer.getBoundingClientRect();
    this.box.style.top = `${Math.max(8, r.top + 8)}px`;
    this.box.style.left = `${r.left + r.width / 2}px`;
  }

  /** 入力値と画面の位置から、できあがる図形の点を決める。{ tool, pts } */
  geometry() {
    const pd = this.pend;
    const page = this.ed.model.page(pd.pageId);
    const k = page?.scale?.ptsPerUnit || 1;
    const t = pd.typed;
    const p0 = pd.p0;
    const h = pd.hover;
    if (pd.tool === "line" || pd.tool === "arrow") {
      const cur = polarOf(p0, h);
      const len = t.len != null ? t.len * k : cur.len;
      const ang = t.ang != null ? t.ang : cur.ang;
      return { tool: pd.tool, pts: [p0, pointAt(p0, ang, len)], len };
    }
    if (pd.tool === "rect") {
      const sx = Math.sign(h[0] - p0[0]) || 1;
      const sy = Math.sign(h[1] - p0[1]) || 1;
      const w = t.w != null ? t.w * k : Math.abs(h[0] - p0[0]);
      const hh = t.h != null ? t.h * k : Math.abs(h[1] - p0[1]);
      return { tool: "rect", pts: [p0, [p0[0] + sx * w, p0[1] + sy * hh]], len: Math.min(w, hh) };
    }
    const r = t.r != null ? t.r * k : dist(p0, h);
    return { tool: "ellipse", pts: [[p0[0] - r, p0[1] - r], [p0[0] + r, p0[1] + r]], len: r };
  }

  draw() {
    const pd = this.pend;
    if (!pd) return;
    const el = this.ed.els.get(pd.pageId);
    const g = this.geometry();
    el.draft.replaceChildren();
    const sh = { id: "draft", type: g.tool, pts: g.pts, style: { ...this.ed.style }, ...(g.tool === "arrow" ? { headSize: this.ed.arrowSize } : {}) };
    this.ed.renderDraft(sh, el.draft);
    this.drawMark(el.draft, pd.mark);
    const page = this.ed.model.page(pd.pageId);
    const end = g.tool === "ellipse" ? pd.hover : g.pts[1];
    this.readout(el.draft, g.tool, pd.p0, g.tool === "ellipse" ? pd.hover : end, page, pd.mark);
    // 起点の印
    const z = this.ed.zoom;
    el.draft.appendChild(sv("circle", { cx: pd.p0[0], cy: pd.p0[1], r: 3.5 / z, fill: "#2563eb", "pointer-events": "none" }));
  }

  /** 画面のクリックで確定(入力した値はそのまま使う) */
  commit() {
    const pd = this.pend;
    if (!pd) return false;
    const g = this.geometry();
    const pageId = pd.pageId;
    this.cancelPending();
    if (!(g.len >= 0.01)) return false; // 実寸で入力すると縮尺しだいで1ptを下回る(例: 1/100 で H30mm)ので、実質ゼロだけ除く
    this.ed.createLinear(g.tool, pageId, g.pts);
    return true;
  }
}
