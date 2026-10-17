// エディタ本体: ページ表示・ズーム・描画ツール・選択/移動/頂点編集・テキスト編集
import { KeyMatcher, resolveShortcuts } from "./shortcuts.js";
import { defaultAngleRadius, angleBetween, chainDims, circleDimPts, dimValueText, refreshedDimText } from "./dimx.js";
import {
  dist, mid, rectPoints, distToSegment, createPenFilter, measure as measureLen, bbox, dimensionGeometry, dimOpts, simplify,
  arcGeometry, arcAngleOf, arcBounds, clampSweep, ARC_MIN, ARC_MAX, eraseStroke,
  arcThrough, regularPolygonPts, ellipsePolygonPts, formatLength,
} from "./geometry.js";
import { renderShape, renderShapes, shapeBounds, shapeVertices, textMetrics, textCorners, fontCss, labelFor, arcLines } from "./render.js";
import { normRect, pickByRect, pickByLasso, shapePolyline } from "./select.js";
import { isLayerLocked, isLayerVisible, BL_KEYS, stampNewShape } from "./layers.js";
import { DrawAid, DYN_TOOLS } from "./drawaid.js";
import { LEADER_DEFAULT } from "./leader.js";
import { moveM, rotateM, scaleM, mirrorM, applyM, transformShape, rectArray, polarArray, offsetShape, trimPolyline, extendPolyline, filletLines, chamferLines, stretchShape, roundCorners, splitPolyline, joinChains, explodeShape } from "./modify.js";

const NS = "http://www.w3.org/2000/svg";
const DRAW_TOOLS = new Set(["pen", "line", "arrow", "rect", "ellipse", "arc", "cloud", "polygon", "text", "leader", "dim", "calib", "measure", "sign", "stamp"]);
const LINE_TOOLS = new Set(["line", "arrow", "arc", "dim", "calib", "measure"]);
const MAX_PIXELS = 16_000_000;
const MAX_ZOOM = 20; // 表示倍率の上限(2000%)。ページ全体を描ききれない倍率では、見えている範囲だけを描き直す

export const isDrawTool = (t) => DRAW_TOOLS.has(t);
/** 選択系のツール。marquee=範囲選択(窓・交差)、lasso=投げ縄。どれも選択した図形を動かせる */
const SELECT_TOOLS = new Set(["select", "marquee", "lasso"]);
const COMMAND_SHORTCUTS = new Set(["trim", "extend", "break", "stretch", "dimradius", "dimdiameter", "dimangle", "dimseries", "dimpara"]); // 図形を選ばずに始めるコマンド
const SNAP_HOVER_TOOLS = new Set(["line", "arrow", "rect", "ellipse", "arc", "polygon", "cloud", "leader", "dim", "calib", "measure"]);
export const isSelectTool = (t) => SELECT_TOOLS.has(t);

const sv = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);


/** 辺ごとの線分(辺ハンドル用)。対象外の図形・頂点が多すぎる図形は null */
function edgesOf(sh) {
  const pts = sh.pts || [];
  if (sh.type === "rect") {
    const [x0, y0, x1, y1] = [Math.min(pts[0][0], pts[1][0]), Math.min(pts[0][1], pts[1][1]), Math.max(pts[0][0], pts[1][0]), Math.max(pts[0][1], pts[1][1])];
    const c = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return c.map((p, i) => [p, c[(i + 1) % 4]]);
  }
  if ((sh.type === "polygon" || sh.type === "polyline") && pts.length >= 2 && pts.length <= 16) {
    const n = sh.type === "polygon" ? pts.length : pts.length - 1;
    return Array.from({ length: n }, (_, i) => [pts[i], pts[(i + 1) % pts.length]]);
  }
  return null;
}

const PICK_CMDS = new Set(["trim", "extend", "fillet", "chamfer", "break", "stretch", "dimradius", "dimdiameter"]);
/** 1キーで切り替えるツール・コマンド(パソコン) */

export class Editor {
  /**
   * @param {object} o
   * @param {import('./model.js').DocModel} o.model
   * @param {HTMLElement} o.viewer スクロール領域
   * @param {HTMLElement} o.pagesEl ページを並べる要素
   * @param {(page)=>Promise<any>} o.getPdfPage pdf.js のページを返す
   */
  constructor({ model, viewer, pagesEl, getPdfPage }) {
    this.model = model;
    this.viewer = viewer;
    this.pagesEl = pagesEl;
    this.getPdfPage = getPdfPage;
    this.els = new Map();
    this.handlers = {};
    this.tool = "select";
    this.style = { color: "#e11d48", width: 1, fill: "none", fillOpacity: 0.25, dash: false, opacity: 1 };
    this.textStyle = { size: 18, font: "gothic", bold: false, color: "#111827" };
    this.cloudPitch = 18;
    this.dimSize = 12;
    this.measureWidth = 2; // 計測の線の太さ(他の線とは別に覚える)
    this.sticky = true; // 作成後に選択して調整 → 何もない所をタップで同じツールに戻り、続けて描ける
    this.returnTool = null; // 作成直後の調整中だけ、戻り先のツールを覚えておく
    this.arrowSize = 10; // 矢印の大きさ(線の太さとは別)
    this.leader = { ...LEADER_DEFAULT }; // 引出線つき文字の設定(文字の大きさ・囲み・先端)
    this.arc = { sweep: 180, r1: false, r2: false }; // 円弧の開き角(度)と半径の直線①②
    this.dimEnd = { style: "dot", size: 6 }; // 寸法線の端部(黒丸/矢印)とサイズ
    this.eraser = { mode: "stroke", size: 24 }; // 消しゴム: stroke=線ごと / partial=なぞった部分だけ(size=円の直径・画面px)
    this.modes = { ellipse: "ellipse", arc: "center", poly: "polygon", n: 6 }; // 丸=楕円/円、円弧=中心/3点、多角形=多角形/ポリライン/正多角形(辺の数n)
    this.loadDefaults();
    this.aid = new DrawAid(this); // オブジェクトスナップ・極トラッキング・数値入力
    this.pendingStamp = null;
    this.sel = null;
    this.multi = null; // 複数選択: { pageId, ids[] }。このとき sel は null
    this.zoom = 1;
    this.palm = false;
    this.curPageId = null;
    this.g = null;
    this.poly = null;
    this.touches = new Map();
    this.pinch = null;
    this.structKey = "";
    this.sigs = new Map();
    this.lastTap = { t: 0, x: 0, y: 0 };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.dataset.id;
        if (e.isIntersecting) this.renderCanvas(id);
        else this.releaseCanvas(id);
      }
    }, { root: viewer, rootMargin: "800px 0px" });

    viewer.addEventListener("scroll", () => {
      this.updateCurrentPage();
      clearTimeout(this._st);
      this._st = setTimeout(() => this.refreshRegions(), 120);
    }, { passive: true });
    viewer.addEventListener("pointerdown", (e) => this.onViewerPointerDown(e), true);
    viewer.addEventListener("pointermove", (e) => this.onViewerPointerMove(e), true);
    viewer.addEventListener("pointerup", (e) => this.onViewerPointerEnd(e), true);
    viewer.addEventListener("pointercancel", (e) => this.onViewerPointerEnd(e), true);
    const nonPassive = { passive: false, capture: true };
    viewer.addEventListener("touchstart", (e) => this.onViewerTouchStart(e), nonPassive);
    viewer.addEventListener("touchmove", (e) => this.onViewerTouchMove(e), nonPassive);
    viewer.addEventListener("touchend", (e) => this.onViewerTouchEnd(e), nonPassive);
    viewer.addEventListener("touchcancel", (e) => this.onViewerTouchEnd(e), nonPassive);
    viewer.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    }, { passive: false });
    this.keys = new KeyMatcher({ onFire: (id) => this.runShortcut(id), onChange: (buf) => this.emit("shortcut-buffer", buf) });
    this.keys.setMap(resolveShortcuts(null));
    document.addEventListener("keydown", (e) => this.onKey(e));
    const ctrlKey = (e) => (e.key === "Control" || e.key === "Meta") && this.refreshSnapHover(e);
    document.addEventListener("keydown", ctrlKey);
    document.addEventListener("keyup", ctrlKey);
    // Alt(極トラッキング)だけ押して離すと、ブラウザのメニューに移ってしまうのを防ぐ
    document.addEventListener("keyup", (e) => e.key === "Alt" && this.g && e.preventDefault());
    new ResizeObserver(() => this.updateCurrentPage()).observe(viewer);
    this.unsub = model.onChange((k) => this.sync(k));
  }

  /** 別のドキュメントに切り替える */
  setModel(model) {
    this.cancelGesture();
    this.cancelPolygon();
    this.cancelArc3();
    this.cancelCommand();
    this.aid.cancelPending();
    if (this.editing) this.finishTextEdit(true);
    this.unsub?.();
    this.model = model;
    this.unsub = model.onChange((k) => this.sync(k));
    this.sel = null;
    this.multi = null;
    this.curPageId = null;
    this.liveBefore = null;
    this.rebuildPages();
    this.emit("selection", null);
  }

  on(evt, fn) {
    (this.handlers[evt] ||= []).push(fn);
  }
  emit(evt, ...a) {
    for (const fn of this.handlers[evt] || []) fn(...a);
  }

  /* =========================================================
   * ページ表示
   * ======================================================= */
  load() {
    this.rebuildPages();
  }

  structureKey() {
    return this.model.pages.map((p) => `${p.id}:${p.rot}:${p.w}:${p.h}`).join("|");
  }

  sync(kind) {
    if (this.structureKey() !== this.structKey) {
      this.pruneSelection(true);
      this.rebuildPages();
      return;
    }
    this.aid._hp = null; // スナップ点の候補は作り直す
    for (const p of this.model.pages) this.refreshLayer(p);
    if (!this.pruneSelection()) this.renderSelection();
    if (kind === "restore") this.emit("selection", this.multi ? { pageId: this.multi.pageId, multi: true, count: this.multi.ids.length } : this.sel);
  }

  rebuildPages() {
    const keepTop = this.viewer.scrollTop;
    this.io.disconnect();
    for (const el of this.els.values()) el.task?.cancel?.();
    this.pagesEl.replaceChildren();
    this.els.clear();
    this.sigs.clear();
    this.structKey = this.structureKey();
    for (const page of this.model.pages) this.pagesEl.appendChild(this.createPageEl(page));
    this.applyZoomToEls();
    this.viewer.scrollTop = keepTop;
    if (!this.model.pages.find((p) => p.id === this.curPageId)) this.curPageId = this.model.pages[0]?.id || null;
    this.updateCurrentPage();
    this.emit("pages");
  }

  createPageEl(page) {
    const wrap = document.createElement("div");
    wrap.className = "page";
    wrap.dataset.id = page.id;
    const canvas = document.createElement("canvas");
    const svg = sv("svg", { class: "overlay", viewBox: `0 0 ${page.w} ${page.h}`, preserveAspectRatio: "none" });
    const layer = sv("g", { class: "layer" });
    const draft = sv("g", { class: "draft", "pointer-events": "none" });
    const ui = sv("g", { class: "ui" });
    svg.append(layer, draft, ui);
    const no = document.createElement("div");
    no.className = "pageno";
    wrap.append(canvas, svg, no);
    const el = { wrap, canvas, svg, layer, draft, ui, no, renderedScale: 0, task: null, token: 0 };
    this.els.set(page.id, el);
    svg.addEventListener("pointerdown", (e) => this.onPointerDown(e, page.id));
    svg.addEventListener("pointermove", (e) => { this.eraserHover(e, page.id); this.snapHover(e, page.id); });
    svg.addEventListener("pointerleave", () => this.g?.kind !== "erase" && el.draft.replaceChildren());
    this.refreshLayer(page, true);
    this.io.observe(wrap);
    this.applyToolClass(el);
    return wrap;
  }

  applyZoomToEls() {
    this.model.pages.forEach((p, i) => {
      const el = this.els.get(p.id);
      if (!el) return;
      el.wrap.style.width = `${p.w * this.zoom}px`;
      el.wrap.style.height = `${p.h * this.zoom}px`;
      el.no.textContent = `${i + 1} / ${this.model.pages.length}`;
    });
    this.renderSelection();
  }

  refreshLayer(page, force = false) {
    const el = this.els.get(page.id);
    if (!el) return;
    const sig = JSON.stringify(page.shapes) + JSON.stringify(page.scale) + JSON.stringify(this.model.layers);
    if (!force && this.sigs.get(page.id) === sig) return;
    this.sigs.set(page.id, sig);
    renderShapes(page.shapes, el.layer, { page, images: this.model.images, exclude: this.editingId, layers: this.model.layers });
  }

  /** いま見えている範囲(ページ座標pt)を、少し余裕をつけて返す。ページ全体を一度に描けないほど拡大したときだけ使う */
  visibleRegion(id, margin = 0.25) {
    const page = this.model.page(id);
    const el = this.els.get(id);
    const vr = this.viewer.getBoundingClientRect();
    const wr = el.wrap.getBoundingClientRect();
    const z = this.zoom;
    const x0 = Math.max(0, (vr.left - wr.left) / z), x1 = Math.min(page.w, (vr.right - wr.left) / z);
    const y0 = Math.max(0, (vr.top - wr.top) / z), y1 = Math.min(page.h, (vr.bottom - wr.top) / z);
    if (x1 <= x0 || y1 <= y0) return null;
    const mx = (x1 - x0) * margin, my = (y1 - y0) * margin;
    return { x: Math.max(0, x0 - mx), y: Math.max(0, y0 - my), x1: Math.min(page.w, x1 + mx), y1: Math.min(page.h, y1 + my), vx0: x0, vy0: y0, vx1: x1, vy1: y1 };
  }

  /** 部分描画中のページで、見えている範囲が描いた範囲からはみ出したら描き直す */
  refreshRegions() {
    for (const [id, el] of this.els) {
      if (!el.region || !el.renderedScale) continue;
      const v = this.visibleRegion(id, 0);
      const r = el.region;
      if (v && (v.vx0 < r.x - 0.5 || v.vy0 < r.y - 0.5 || v.vx1 > r.x1 + 0.5 || v.vy1 > r.y1 + 0.5)) this.renderCanvas(id, true);
    }
  }

  async renderCanvas(id, force = false) {
    const page = this.model.page(id);
    const el = this.els.get(id);
    if (!page || !el) return;
    const want = this.zoom * this.dpr;
    const partial = page.w * page.h * want * want > MAX_PIXELS;
    if (!force && el.renderedScale && Math.abs(el.renderedScale - want) < 0.001 && !!el.region === partial) return;
    const token = ++el.token;
    el.task?.cancel?.();
    let pdfPage = null;
    try {
      pdfPage = await this.getPdfPage(page);
    } catch (e) {
      console.warn(e);
    }
    if (token !== el.token) return;
    let region = { x: 0, y: 0, x1: page.w, y1: page.h };
    if (partial) region = this.visibleRegion(id) || region;
    const rw = region.x1 - region.x, rh = region.y1 - region.y;
    let scale = want;
    if (rw * rh * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (rw * rh));
    const w = Math.max(1, Math.round(rw * scale));
    const h = Math.max(1, Math.round(rh * scale));
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const g = tmp.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    if (pdfPage) {
      const vp = pdfPage.getViewport({ scale: w / rw, rotation: ((page.baseRot || 0) + page.rot) % 360, offsetX: -region.x * (w / rw), offsetY: -region.y * (h / rh) });
      const task = pdfPage.render({ canvasContext: g, canvas: tmp, viewport: vp, optionalContentConfigPromise: pdfPage.pfOc });
      el.task = task;
      try {
        await task.promise;
      } catch (e) {
        if (e?.name === "RenderingCancelledException") return;
        console.warn("render error", e);
      }
      if (token !== el.token) return;
    }
    el.canvas.width = w;
    el.canvas.height = h;
    el.canvas.getContext("2d").drawImage(tmp, 0, 0);
    // 部分描画のときは、描いた範囲の位置・大きさに合わせる(%指定なので倍率が変わっても追従する)
    const st = el.canvas.style;
    if (partial) {
      el.region = region;
      st.inset = "auto";
      st.left = `${(region.x / page.w) * 100}%`;
      st.top = `${(region.y / page.h) * 100}%`;
      st.width = `${(rw / page.w) * 100}%`;
      st.height = `${(rh / page.h) * 100}%`;
    } else {
      el.region = null;
      st.inset = st.left = st.top = st.width = st.height = "";
    }
    el.renderedScale = want;
    el.wrap.dataset.rendered = "1";
  }

  releaseCanvas(id) {
    const el = this.els.get(id);
    if (!el || !el.renderedScale) return;
    el.token++;
    el.task?.cancel?.();
    el.canvas.width = 1;
    el.canvas.height = 1;
    el.renderedScale = 0;
    el.region = null;
    delete el.wrap.dataset.rendered;
  }

  /* ---------- ズーム ---------- */
  setZoom(z, { render = true } = {}) {
    z = Math.max(0.2, Math.min(MAX_ZOOM, z));
    this.zoom = z;
    this.applyZoomToEls();
    this.emit("zoom", z);
    if (render) {
      clearTimeout(this._zt);
      this._zt = setTimeout(() => {
        for (const [id, el] of this.els) if (el.renderedScale) this.renderCanvas(id);
      }, 140);
    }
  }
  zoomAt(z, cx, cy) {
    // カーソル(指)の下にあるページ上の点が、拡大縮小のあとも同じ位置に見えるようにする
    // (ページは中央寄せなので、スクロール量だけでなくページの位置から求める)
    let best = null;
    let bd = Infinity;
    for (const el of this.els.values()) {
      const r = el.wrap.getBoundingClientRect();
      const d = cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
      if (d < bd) { bd = d; best = { el, r }; }
    }
    const oldZ = this.zoom;
    const z2 = Math.max(0.2, Math.min(MAX_ZOOM, z));
    if (!best || z2 === oldZ) return this.setZoom(z);
    const px = (cx - best.r.left) / oldZ;
    const py = (cy - best.r.top) / oldZ;
    this.setZoom(z);
    const r2 = best.el.wrap.getBoundingClientRect();
    this.viewer.scrollLeft += r2.left + px * this.zoom - cx;
    this.viewer.scrollTop += r2.top + py * this.zoom - cy;
  }
  zoomBy(f) {
    const r = this.viewer.getBoundingClientRect();
    this.zoomAt(this.zoom * f, r.left + r.width / 2, r.top + r.height / 2);
  }
  fitWidth() {
    const w = Math.max(...this.model.pages.map((p) => p.w), 1);
    const avail = this.viewer.clientWidth - 32;
    this.setZoom(Math.max(0.25, Math.min(1.6, avail / w)));
  }

  updateCurrentPage() {
    const r = this.viewer.getBoundingClientRect();
    const cy = r.top + r.height * 0.4;
    let best = null;
    let bd = Infinity;
    for (const p of this.model.pages) {
      const el = this.els.get(p.id);
      if (!el) continue;
      const b = el.wrap.getBoundingClientRect();
      const d = cy >= b.top && cy <= b.bottom ? 0 : Math.min(Math.abs(cy - b.top), Math.abs(cy - b.bottom));
      if (d < bd) {
        bd = d;
        best = p.id;
      }
    }
    if (best && best !== this.curPageId) {
      this.curPageId = best;
      this.emit("page", best);
    }
  }
  scrollToPage(id) {
    const el = this.els.get(id);
    if (!el) return;
    const r = this.viewer.getBoundingClientRect();
    const b = el.wrap.getBoundingClientRect();
    this.viewer.scrollTop += b.top - r.top - 12;
    this.curPageId = id;
    this.emit("page", id);
  }

  /* =========================================================
   * ツール
   * ======================================================= */
  setTool(t) {
    if (this.poly && t !== "polygon") this.cancelPolygon();
    if (t !== "arc") this.cancelArc3();
    this.aid.cancelPending();
    this.cancelCommand();
    this.cancelGesture();
    this.returnTool = null;
    this.tool = t;
    this.clearDraft();
    for (const el of this.els.values()) this.applyToolClass(el);
    if (!isSelectTool(t)) this.setSelection(null);
    this.emit("tool", t);
  }
  applyToolClass(el) {
    const t = this.tool;
    const cls = t === "select" ? "t-select" : t === "hand" ? "t-hand" : isSelectTool(t) ? "t-draw t-marq" : this.palm ? "t-palm" : t === "eraser" ? "t-erase" : "t-draw";
    el.svg.setAttribute("class", `overlay ${cls}`);
  }
  setPalm(on) {
    // iPhoneにはApple Pencilが無いので、指で描けなくなるペン入力モードは適用しない
    this.palm = !!on && !/iPhone|iPod/.test(navigator.userAgent);
    for (const el of this.els.values()) this.applyToolClass(el);
  }

  /* =========================================================
   * 座標・ポインタ
   * ======================================================= */
  pt(e, pageId) {
    const svg = this.els.get(pageId).svg;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  clampToPage(p, pageId) {
    const pg = this.model.page(pageId);
    return [Math.max(0, Math.min(pg.w, p[0])), Math.max(0, Math.min(pg.h, p[1]))];
  }

  // 2本指: ピンチでズーム、移動でスクロール(描画中の操作は取り消す)
  // pointerは「指の本数」の把握用、実際のピンチは touch イベント(iOSで確実にpreventDefaultできる)で行う。
  // ピンチ中は #pages に CSS transform をかけるだけ(再レイアウトなし)にして、指を離したときに1回だけズームを確定する。
  onViewerPointerDown(e) {
    if (e.pointerType !== "touch") return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size >= 2) this.cancelGesture();
  }
  onViewerPointerMove(e) {
    if (e.pointerType !== "touch" || !this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  onViewerPointerEnd(e) {
    if (e.pointerType !== "touch") return;
    this.touches.delete(e.pointerId);
  }
  twoTouch(e) {
    const [a, b] = [e.touches[0], e.touches[1]];
    return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
  }
  onViewerTouchStart(e) {
    if (e.touches.length !== 2) return;
    this.cancelGesture();
    const t = this.twoTouch(e);
    const pages = this.viewer.querySelector("#pages") || this.viewer.firstElementChild;
    const r = this.viewer.getBoundingClientRect();
    const ox = this.viewer.scrollLeft + t.x - r.left - (pages?.offsetLeft || 0);
    const oy = this.viewer.scrollTop + t.y - r.top - (pages?.offsetTop || 0);
    this.pinch = { d0: t.d, z0: this.zoom, m0: t, ax: (this.viewer.scrollLeft + t.x - r.left) / this.zoom, ay: (this.viewer.scrollTop + t.y - r.top) / this.zoom, z: this.zoom, m: t, pages };
    if (pages) { pages.style.transformOrigin = `${ox}px ${oy}px`; pages.style.willChange = "transform"; }
    e.preventDefault();
  }
  onViewerTouchMove(e) {
    if (this.pinch && e.touches.length >= 2) {
      const t = this.twoTouch(e);
      const z = Math.max(0.2, Math.min(MAX_ZOOM, this.pinch.z0 * (t.d / this.pinch.d0)));
      this.pinch.z = z;
      this.pinch.m = t;
      const s = z / this.pinch.z0;
      if (this.pinch.pages) this.pinch.pages.style.transform = `translate(${t.x - this.pinch.m0.x}px, ${t.y - this.pinch.m0.y}px) scale(${s})`;
      e.preventDefault();
      return;
    }
    // 描画中は指の動きでスクロールさせない
    if (this.g?.kind === "create") e.preventDefault();
  }
  onViewerTouchEnd(e) {
    if (e.touches.length === 0) this.touches.clear();
    if (!this.pinch || e.touches.length >= 2) return;
    const { z, m, ax, ay, pages } = this.pinch;
    this.pinch = null;
    if (pages) { pages.style.transform = ""; pages.style.transformOrigin = ""; pages.style.willChange = ""; }
    const r = this.viewer.getBoundingClientRect();
    this.setZoom(z);
    this.viewer.scrollLeft = ax * z - (m.x - r.left);
    this.viewer.scrollTop = ay * z - (m.y - r.top);
  }

  /** 同じ対象(key)を短時間に2回タップしたか。別の操作を挟むと成立しない */
  isDoubleTap(e, key) {
    const now = performance.now();
    const t = this.lastTap;
    const dbl = t.key === key && now - t.t < 380 && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 24;
    this.lastTap = dbl ? { t: 0, x: 0, y: 0, key: null } : { t: now, x: e.clientX, y: e.clientY, key };
    return dbl;
  }

  onPointerDown(e, pageId) {
    if (this.pinch || this.touches.size > 1) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (this.editingId) this.finishTextEdit();
    this.curPageId = pageId;
    const tool = this.tool;
    if (tool === "hand") return;
    if (tool === "eraser") {
      if (this.palm && e.pointerType === "touch") return;
      e.preventDefault();
      return this.eraseDown(e, pageId);
    }
    if (this.palm && e.pointerType === "touch" && !isSelectTool(tool)) return;
    const el = this.els.get(pageId);
    const p = this.pt(e, pageId);

    if (this.cmd && isSelectTool(tool)) return this.cmdDown(e, pageId, p);
    if (isSelectTool(tool)) return this.selectDown(e, pageId, p);
    e.preventDefault();

    if (this.aid.pending) {
      const pd = this.aid.pend;
      if (pd.pageId === pageId && tool === pd.tool) {
        const r = this.aid.resolve(this.clampToPage(p, pageId), { pts: pd.pts, p0: pd.p0, ev: e, polar: tool === "line" || tool === "arrow" });
        pd.hover = r.p;
        this.aid.commit();
        return;
      }
      this.aid.cancelPending();
    }
    if (tool === "polygon" && this.modes.poly !== "regular") return this.polygonDown(e, pageId, p);
    if (tool === "arc" && this.modes.arc === "three") return this.arc3Down(e, pageId, p);
    if (tool === "text") return this.beginText(pageId, p);
    if (tool === "stamp") return this.placeStamp(pageId, p);

    // ドラッグ系の作成ツール
    let start = this.clampToPage(p, pageId);
    const snapPts = tool === "pen" || tool === "sign" ? null : this.aid.pointsFor(pageId);
    let mark = null;
    if (snapPts) {
      const r = this.aid.resolve(start, { pts: snapPts, ev: e });
      start = this.clampToPage(r.p, pageId);
      mark = r.mark;
    }
    this.g = { kind: "create", tool, pageId, p0: start, pts: [start], id: e.pointerId, filter: createPenFilter(), snapPts, mark };
    if (tool === "pen") this.g.filter.add(start);
    el.svg.setPointerCapture?.(e.pointerId);
    const move = (ev) => this.createMove(ev);
    const up = (ev) => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", cancel);
      this.createEnd(ev);
    };
    const cancel = () => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", cancel);
      this.cancelGesture();
    };
    this.g.cleanup = () => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", cancel);
    };
    el.svg.addEventListener("pointermove", move);
    el.svg.addEventListener("pointerup", up);
    el.svg.addEventListener("pointercancel", cancel);
    this.drawDraft();
  }

  /* ---------- 消しゴム ----------
   * 線ごと(stroke): ペンで書いた線を、なぞった1本単位で消す
   * 部分(partial): ペンで書いた線の、円でなぞった部分だけを消す(線は分割される) */
  setEraser(o) {
    Object.assign(this.eraser, o);
    this.eraser.size = Math.max(4, Math.min(120, Number(this.eraser.size) || 24));
    if (this.eraser.mode !== "partial") this.clearDraft();
    this.saveDefaults();
  }
  /** 部分消しゴムの円(画面上の直径 size px)をページ座標で描く */
  drawEraserCursor(pageId, p) {
    const el = this.els.get(pageId);
    if (!el) return;
    el.draft.replaceChildren(sv("circle", {
      cx: p[0], cy: p[1], r: this.eraser.size / 2 / this.zoom,
      fill: "rgba(37,99,235,0.08)", stroke: "#2563eb", "stroke-width": 1 / this.zoom, class: "eraser-cursor",
    }));
  }
  /** 図形を描くツールで、ボタンを押す前にもスナップ点の記号を出す(Ctrl中) */
  snapHover(e, pageId, last = true) {
    if (last) this.hoverLast = { pageId, raw: this.pt(e, pageId), pointerType: e.pointerType };
    if (e.pointerType === "touch" || e.buttons || this.g || this.poly || this.arc3 || this.cmd || this.editing) return;
    if (!SNAP_HOVER_TOOLS.has(this.tool)) return;
    this.aid.hover(pageId, this.hoverLast.raw, e);
  }
  /** Ctrl を押した/離したとき、マウスを動かさなくても記号を出し入れする */
  refreshSnapHover(e) {
    const h = this.hoverLast;
    if (!h || h.pointerType === "touch" || this.g || this.poly || this.arc3 || this.cmd || !SNAP_HOVER_TOOLS.has(this.tool)) return;
    if (!this.els.has(h.pageId)) return;
    this.aid.hover(h.pageId, h.raw, { pointerType: h.pointerType, ctrlKey: e.type === "keydown" ? true : false, metaKey: false });
  }
  eraserHover(e, pageId) {
    if (this.tool !== "eraser" || this.eraser.mode !== "partial" || this.g) return;
    if (e.pointerType === "touch") return; // 指は触れている間だけ表示
    this.drawEraserCursor(pageId, this.pt(e, pageId));
  }
  eraseDown(e, pageId) {
    const el = this.els.get(pageId);
    const page = this.model.page(pageId);
    if (!el || !page) return;
    const before = this.model.snapshot();
    const partial = this.eraser.mode === "partial";
    let last = this.pt(e, pageId);
    const hitStroke = (a, b) => {
      const r = 12 / this.zoom; // 画面上で約12pxの太さ
      const keep = [];
      let removed = false;
      for (const s of page.shapes) {
        if (s.type !== "pen" || s.locked) { keep.push(s); continue; }
        const rr = r + (s.style?.width || 1) / 2;
        const pts = s.pts;
        let touched = pts.length === 1 && Math.hypot(pts[0][0] - b[0], pts[0][1] - b[1]) <= rr;
        for (let i = 0; !touched && i < pts.length; i++) {
          if (distToSegment(pts[i], a, b) <= rr) touched = true;
          else if (i && distToSegment(a, pts[i - 1], pts[i]) <= rr) touched = true;
        }
        if (touched) removed = true; else keep.push(s);
      }
      if (removed) page.shapes = keep;
      return removed;
    };
    const hitPartial = (a, b) => {
      const r = this.eraser.size / 2 / this.zoom;
      const next = [];
      let changed = false;
      for (const s of page.shapes) {
        if (s.type !== "pen" || s.locked) { next.push(s); continue; }
        // 線の太さの半分だけ広げて、円に入った部分の線が見た目でも残らないようにする
        const parts = eraseStroke(s.pts, a, b, r + (s.style?.width || 1) / 2);
        if (!parts) { next.push(s); continue; }
        changed = true;
        parts.forEach((pts, i) => next.push({ ...clone(s), id: i ? uid() : s.id, pts }));
      }
      if (changed) page.shapes = next;
      return changed;
    };
    const hitOne = partial ? hitPartial : hitStroke;
    const hit = (segs) => {
      let changed = false;
      for (const [a, b] of segs) if (hitOne(a, b)) changed = true;
      if (changed) this.model.emit("change"); // 1回の移動につき再描画は1度だけ
    };
    this.g = { kind: "erase", pageId, id: e.pointerId };
    hit([[last, last]]);
    if (partial) this.drawEraserCursor(pageId, last);
    el.svg.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const events = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
      const segs = [];
      for (const ce of events.length ? events : [ev]) {
        const p = this.pt(ce, pageId);
        segs.push([last, p]);
        last = p;
      }
      hit(segs);
      if (partial) this.drawEraserCursor(pageId, last);
    };
    const stop = (commit) => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", cancel);
      this.g = null;
      if (partial && e.pointerType === "touch") el.draft.replaceChildren();
      if (commit) this.model.commit(before);
    };
    const up = () => stop(true);
    const cancel = () => stop(true); // 途中まで消した分は残す
    this.g.cleanup = () => stop(true);
    el.svg.addEventListener("pointermove", move);
    el.svg.addEventListener("pointerup", up);
    el.svg.addEventListener("pointercancel", cancel);
  }

  cancelGesture() {
    const g = this.g;
    if (!g) return;
    g.cleanup?.();
    if (g.kind === "move" || g.kind === "handle") {
      // 途中までの変更を元に戻す
      if (g.before) {
        this.model.applySnapshot(g.before);
        this.model.emit("restore");
      }
    }
    this.g = null;
    this.clearDraft();
  }

  clearDraft() {
    for (const el of this.els.values()) el.draft.replaceChildren();
  }

  /* ---------- 作成ドラッグ ---------- */
  createMove(ev) {
    const g = this.g;
    if (!g || ev.pointerId !== g.id) return;
    let p = this.clampToPage(this.pt(ev, g.pageId), g.pageId);
    if (g.tool === "pen") {
      const events = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of events.length ? events : [ev]) {
        const q = g.filter.add(this.clampToPage(this.pt(ce, g.pageId), g.pageId));
        if (q) g.pts.push(q);
      }
    } else {
      if (g.snapPts) {
        const r = this.aid.resolve(p, { pts: g.snapPts, p0: g.p0, ev, polar: LINE_TOOLS.has(g.tool) });
        p = this.clampToPage(r.p, g.pageId);
        g.mark = r.mark;
      }
      if (ev.shiftKey && (g.tool === "rect" || g.tool === "ellipse" || g.tool === "cloud")) {
        const s = Math.max(Math.abs(p[0] - g.p0[0]), Math.abs(p[1] - g.p0[1]));
        p = [g.p0[0] + Math.sign(p[0] - g.p0[0] || 1) * s, g.p0[1] + Math.sign(p[1] - g.p0[1] || 1) * s];
      }
      g.p1 = p;
    }
    if (!g.raf) {
      g.raf = requestAnimationFrame(() => {
        g.raf = 0;
        this.drawDraft();
      });
    }
  }

  draftShape() {
    const g = this.g;
    if (!g) return null;
    const style = { ...this.style };
    const base = { id: "draft", style };
    switch (g.tool) {
      case "pen":
        return { ...base, type: "pen", pts: g.pts.length ? g.pts : [g.p0] };
      case "ellipse":
        if (this.modes.ellipse === "circle") return g.p1 ? { ...base, type: "ellipse", pts: this.circlePts(g.p0, g.p1) } : null;
        return g.p1 ? { ...base, type: "ellipse", pts: [g.p0, g.p1] } : null;
      case "polygon":
        return g.p1 ? { ...base, type: "polygon", pts: regularPolygonPts(g.p0, g.p1, this.modes.n) } : null;
      case "line":
      case "arrow":
      case "rect":
        return g.p1 ? { ...base, type: g.tool, pts: [g.p0, g.p1], ...(g.tool === "arrow" ? { headSize: this.arrowSize } : {}) } : null;
      case "leader":
        return g.p1 ? { ...base, type: "leader", pts: [g.p0, g.p1], text: "", ...this.leader } : null;
      case "arc":
        return g.p1 ? { ...base, ...this.newArc(g.p0, g.p1) } : null;
      case "cloud":
        return g.p1 ? { ...base, type: "cloud", pts: rectPoints(g.p0, g.p1), pitch: this.cloudPitch } : null;
      case "dim":
        return g.p1 ? { ...base, type: "dim", pts: [g.p0, g.p1], off: 24, size: this.dimSize, endStyle: this.dimEnd.style, endSize: this.dimEnd.size, text: "" } : null;
      case "calib":
        return g.p1 ? { ...base, type: "dim", style: { ...style, color: "#2563eb", dash: true }, pts: [g.p0, g.p1], off: 24, size: this.dimSize, endStyle: this.dimEnd.style, endSize: this.dimEnd.size, text: "?" } : null;
      case "measure":
        return g.p1 ? { ...base, type: "measure", style: { ...style, color: "#059669", width: this.measureWidth }, pts: [g.p0, g.p1], size: this.dimSize, endStyle: this.dimEnd.style, endSize: this.dimEnd.size } : null;
      case "sign":
        return g.p1 ? { ...base, type: "rect", style: { color: "#2563eb", width: 1.5, dash: true, fill: "none" }, pts: [g.p0, g.p1] } : null;
      default:
        return null;
    }
  }

  drawDraft() {
    const g = this.g;
    if (!g) return;
    const el = this.els.get(g.pageId);
    el.draft.replaceChildren();
    const sh = this.draftShape();
    if (!sh) return;
    renderShape(sh, el.draft, { page: this.model.page(g.pageId), images: this.model.images });
    el.draft.querySelectorAll(".hit").forEach((n) => n.remove());
    this.aid.drawMark(el.draft, g.mark);
    const rt = (g.tool === "ellipse" && this.modes.ellipse === "circle") || g.tool === "polygon" ? "circle" : g.tool;
    if (g.p1) this.aid.readout(el.draft, rt, g.p0, g.p1, this.model.page(g.pageId), g.mark);
  }

  /** 円: 中心 c と、円周上の点 p から、外接の対角2点 */
  circlePts(c, p) {
    const r = dist(c, p);
    return [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]];
  }

  /** 下書き用に図形を描く(当たり判定は外す) */
  renderDraft(shape, layer) {
    renderShape(shape, layer, { page: null, images: this.model.images });
    layer.querySelectorAll(".hit").forEach((n) => n.remove());
  }

  /** 線・矢印・四角・円を点から作る(ドラッグでも数値入力でも共通) */
  createLinear(tool, pageId, pts) {
    const base = { type: tool, pts, style: { ...this.style } };
    if (tool === "arrow") base.headSize = this.arrowSize;
    return this.addAndSelect(pageId, base);
  }

  createEnd(ev) {
    const g = this.g;
    if (!g) return;
    g.cleanup?.();
    if (g.raf) cancelAnimationFrame(g.raf);
    this.g = null;
    const { tool, pageId } = g;
    const el = this.els.get(pageId);
    el.draft.replaceChildren();
    const page = this.model.page(pageId);
    const p1 = g.p1 || g.p0;
    const small = dist(g.p0, p1) < 4;

    if (tool === "pen") {
      let pts = g.pts;
      if (pts.length > 2) pts = simplify(pts, 0.25);
      if (pts.length === 1) pts = [pts[0], [pts[0][0] + 0.01, pts[0][1]]];
      this.model.addShape(pageId, { type: "pen", pts, style: { ...this.style } });
      return;
    }
    if (tool === "sign") {
      let a = g.p0;
      let b = p1;
      if (small) {
        a = [g.p0[0] - 90, g.p0[1] - 30];
        b = [g.p0[0] + 90, g.p0[1] + 30];
      }
      this.emit("sign-request", { pageId, rect: [a, b] });
      return;
    }
    if (small && this.aid.cfg.dyn && DYN_TOOLS.has(tool) && g.pts.length) {
      this.aid.startPending(tool, pageId, g.p0, g.snapPts || []);
      return;
    }
    if (small && tool !== "calib") return;
    if (small) return;
    switch (tool) {
      case "line":
      case "arrow":
        this.addAndSelect(pageId, { type: tool, pts: [g.p0, p1], style: { ...this.style }, ...(tool === "arrow" ? { headSize: this.arrowSize } : {}) });
        break;
      case "rect":
        this.addAndSelect(pageId, { type: tool, pts: [g.p0, p1], style: { ...this.style } });
        break;
      case "leader": {
        const s = this.addAndSelect(pageId, { type: "leader", pts: [g.p0, p1], text: "", style: { ...this.style }, ...this.leader });
        if (s) this.emit("leader-edit", { pageId, shapeId: s.id, isNew: true });
        break;
      }
      case "ellipse":
        this.addAndSelect(pageId, { type: "ellipse", pts: this.modes.ellipse === "circle" ? this.circlePts(g.p0, p1) : [g.p0, p1], style: { ...this.style } });
        break;
      case "polygon":
        this.addAndSelect(pageId, { type: "polygon", pts: regularPolygonPts(g.p0, p1, this.modes.n), style: { ...this.style } });
        break;
      case "arc":
        this.addAndSelect(pageId, { ...this.newArc(g.p0, p1), style: { ...this.style } });
        break;
      case "cloud":
        this.addAndSelect(pageId, { type: "cloud", pts: rectPoints(g.p0, p1), pitch: this.cloudPitch, style: { ...this.style } });
        break;
      case "dim":
        this.emit("dim-request", {
          pageId,
          create: (text) => this.addAndSelect(pageId, { type: "dim", pts: [g.p0, p1], off: 24, size: this.dimSize, endStyle: this.dimEnd.style, endSize: this.dimEnd.size, text, style: { ...this.style, width: Math.min(this.style.width, 2) } }),
          length: dist(g.p0, p1),
          scale: page.scale,
        });
        break;
      case "calib":
        this.emit("calib-request", { pageId, p0: g.p0, p1, length: dist(g.p0, p1) });
        break;
      case "measure":
        if (!page.scale) {
          this.emit("need-scale");
          break;
        }
        this.addAndSelect(pageId, { type: "measure", pts: [g.p0, p1], size: this.dimSize, endStyle: this.dimEnd.style, endSize: this.dimEnd.size, style: { ...this.style, color: "#059669", width: this.measureWidth } }, false);
        break;
      default:
        break;
    }
  }

  /** 円弧: 中心 c から外へドラッグした点 p が始点(半径と向き)。開き角・直線①②は現在の設定 */
  newArc(c, p) {
    const sh = { type: "arc", pts: [c, p], sweep: clampSweep(this.arc.sweep) };
    if (this.arc.r1) sh.r1 = true;
    if (this.arc.r2) sh.r2 = true;
    return sh;
  }

  addAndSelect(pageId, shape, select = true) {
    const s = this.model.addShape(pageId, shape);
    if (select && s) this.selectCreated(pageId, s.id);
    return s;
  }
  /**
   * 作った図形を選択してプロパティを調整できるようにする。
   * 連続作成(既定)のときは元のツールを覚えておき、何もない所をタップすると確定してそのツールに戻る
   */
  selectCreated(pageId, shapeId) {
    const back = this.sticky && this.tool !== "select" ? this.tool : null;
    this.tool = "select";
    this.returnTool = back;
    for (const el of this.els.values()) this.applyToolClass(el);
    this.emit("tool", "select");
    this.setSelection({ pageId, shapeId });
  }
  /** 作成直後の調整を確定して元のツールに戻る。戻り先が無ければ false */
  confirmCreated() {
    if (!this.returnTool) return false;
    this.setTool(this.returnTool);
    return true;
  }

  /* ---------- 多角形 ---------- */
  polygonDown(e, pageId, p) {
    p = this.clampToPage(p, pageId);
    const dbl = this.isDoubleTap(e, "polygon");
    if (!this.poly || this.poly.pageId !== pageId) {
      this.cancelPolygon();
      this.poly = { pageId, pts: [], hover: null, snapPts: this.aid.pointsFor(pageId), mark: null, open: this.modes.poly === "polyline" };
      this.polyMoveFn = (ev) => {
        if (!this.poly) return;
        const raw = this.clampToPage(this.pt(ev, this.poly.pageId), this.poly.pageId);
        const r = this.aid.resolve(raw, { pts: this.poly.snapPts, p0: this.poly.pts[this.poly.pts.length - 1] || null, ev });
        this.poly.hover = r.p;
        this.poly.mark = r.mark;
        this.drawPolygonDraft();
      };
      this.els.get(pageId).svg.addEventListener("pointermove", this.polyMoveFn);
    }
    const pts = this.poly.pts;
    const first = pts[0];
    const closeR = 12 / this.zoom;
    if (this.poly.open) {
      if (pts.length >= 2 && dbl) return this.finishPolygon();
    } else if (pts.length >= 3 && (dbl || dist(p, first) < closeR)) return this.finishPolygon();
    p = this.clampToPage(this.aid.resolve(p, { pts: this.poly.snapPts, p0: pts[pts.length - 1] || null, ev: e }).p, pageId);
    if (pts.length && dist(p, pts[pts.length - 1]) < 2) return;
    pts.push(p);
    this.poly.hover = p;
    this.drawPolygonDraft();
    this.emit("polygon-state", pts.length);
  }
  drawPolygonDraft() {
    const poly = this.poly;
    if (!poly) return;
    const el = this.els.get(poly.pageId);
    el.draft.replaceChildren();
    const pts = poly.hover && poly.pts.length ? [...poly.pts, poly.hover] : poly.pts;
    if (pts.length > 1 && poly.open) {
      const ln = renderShape({ id: "draft2", type: "polyline", pts, style: { ...this.style } }, el.draft, {});
      ln.querySelectorAll(".hit").forEach((n) => n.remove());
    } else if (pts.length > 1) {
      renderShape({ id: "draft", type: "polygon", pts, style: { ...this.style, fill: "none" } }, el.draft, {});
      el.draft.querySelectorAll(".hit").forEach((n) => n.remove());
      // 最後の辺(戻る線)は点線で表現するため、開いた線として上書き
      const open = renderShape({ id: "draft2", type: "line", pts, style: { ...this.style } }, el.draft, {});
      open.querySelectorAll(".hit").forEach((n) => n.remove());
    }
    this.aid.drawMark(el.draft, poly.mark);
    const r = 5 / this.zoom;
    poly.pts.forEach((q, i) => el.draft.appendChild(sv("circle", { cx: q[0], cy: q[1], r: i === 0 ? r * 1.5 : r, fill: i === 0 ? "#2563eb" : "#fff", stroke: "#2563eb", "stroke-width": 1.5 / this.zoom })));
  }
  finishPolygon() {
    const poly = this.poly;
    if (!poly) return;
    if (poly.pts.length < (poly.open ? 2 : 3)) return this.cancelPolygon();
    const { pageId } = poly;
    const pts = poly.pts.slice();
    this.lastTap = { t: 0, x: 0, y: 0, key: null };
    this.cancelPolygon();
    this.addAndSelect(pageId, { type: poly.open ? "polyline" : "polygon", pts, style: { ...this.style, ...(poly.open ? { fill: "none" } : {}) } });
  }
  /* ---------- 円弧(3点: 始点 → 終点 → 途中の点) ---------- */
  arc3Down(e, pageId, p) {
    p = this.clampToPage(p, pageId);
    if (!this.arc3 || this.arc3.pageId !== pageId) {
      this.cancelArc3();
      this.arc3 = { pageId, pts: [], hover: null, mark: null, snapPts: this.aid.pointsFor(pageId) };
      this.arc3MoveFn = (ev) => {
        const a = this.arc3;
        if (!a) return;
        const r = this.aid.resolve(this.clampToPage(this.pt(ev, a.pageId), a.pageId), { pts: a.snapPts, ev, polar: false });
        a.hover = r.p;
        a.mark = r.mark;
        this.drawArc3Draft();
      };
      this.els.get(pageId).svg.addEventListener("pointermove", this.arc3MoveFn);
    }
    const a = this.arc3;
    const r = this.aid.resolve(p, { pts: a.snapPts, ev: e, polar: false });
    const q = this.clampToPage(r.p, pageId);
    if (a.pts.length && dist(q, a.pts[a.pts.length - 1]) < 2) return;
    a.pts.push(q);
    a.hover = q;
    if (a.pts.length < 3) return this.drawArc3Draft();
    const arc = arcThrough(a.pts[0], a.pts[1], a.pts[2]);
    this.cancelArc3();
    if (!arc) return this.emit("toast", { text: "3点が一直線上にあるため、円弧にできません" });
    this.addAndSelect(pageId, { type: "arc", pts: arc.pts, sweep: arc.sweep, ...(this.arc.r1 ? { r1: true } : {}), ...(this.arc.r2 ? { r2: true } : {}), style: { ...this.style } });
  }
  drawArc3Draft() {
    const a = this.arc3;
    if (!a) return;
    const el = this.els.get(a.pageId);
    el.draft.replaceChildren();
    const z = this.zoom;
    if (a.pts.length === 1 && a.hover) {
      this.renderDraft({ id: "draft", type: "line", pts: [a.pts[0], a.hover], style: { ...this.style, dash: true } }, el.draft);
    } else if (a.pts.length === 2 && a.hover) {
      const arc = arcThrough(a.pts[0], a.pts[1], a.hover);
      if (arc) this.renderDraft({ id: "draft", type: "arc", pts: arc.pts, sweep: arc.sweep, style: { ...this.style } }, el.draft);
      else this.renderDraft({ id: "draft", type: "line", pts: [a.pts[0], a.pts[1]], style: { ...this.style, dash: true } }, el.draft);
    }
    this.aid.drawMark(el.draft, a.mark);
    a.pts.forEach((q, i) => el.draft.appendChild(sv("circle", { cx: q[0], cy: q[1], r: (i === 0 ? 5 : 4) / z, fill: "#fff", stroke: "#2563eb", "stroke-width": 1.5 / z, "pointer-events": "none" })));
  }
  cancelArc3() {
    if (!this.arc3) return;
    const el = this.els.get(this.arc3.pageId);
    if (el) {
      el.svg.removeEventListener("pointermove", this.arc3MoveFn);
      el.draft.replaceChildren();
    }
    this.arc3 = null;
  }

  cancelPolygon() {
    if (!this.poly) return;
    const el = this.els.get(this.poly.pageId);
    if (el) {
      el.svg.removeEventListener("pointermove", this.polyMoveFn);
      el.draft.replaceChildren();
    }
    this.poly = null;
    this.emit("polygon-state", 0);
  }

  /* ---------- テキスト ---------- */
  beginText(pageId, p) {
    const shape = { id: "h" + uid(), type: "text", pts: [this.clampToPage(p, pageId)], text: "", size: this.textStyle.size, font: this.textStyle.font, bold: this.textStyle.bold, color: this.textStyle.color, style: { color: this.textStyle.color, width: 1 } };
    this.editText(pageId, shape, true);
  }

  editText(pageId, shape, isNew = false) {
    this.finishTextEdit();
    const el = this.els.get(pageId);
    this.editingId = shape.id;
    this.editing = { pageId, shape, isNew, before: this.model.snapshot() };
    if (!isNew) this.refreshLayer(this.model.page(pageId), true);
    const ta = document.createElement("textarea");
    ta.className = "text-edit";
    ta.value = shape.text;
    ta.setAttribute("wrap", "off");
    ta.spellcheck = false;
    const place = () => {
      const m = textMetrics({ ...shape, text: ta.value || " " });
      ta.style.left = `${shape.pts[0][0] * this.zoom}px`;
      ta.style.top = `${shape.pts[0][1] * this.zoom}px`;
      ta.style.width = `${Math.max(m.w + shape.size, shape.size * 4) * this.zoom}px`;
      ta.style.height = `${m.h * this.zoom + 2}px`;
      ta.style.fontSize = `${shape.size * this.zoom}px`;
      ta.style.fontFamily = fontCss(shape.font);
      ta.style.fontWeight = shape.bold ? "bold" : "normal";
      ta.style.color = shape.color;
      ta.style.lineHeight = "1.25";
      ta.style.transformOrigin = "0 0";
      ta.style.transform = shape.angle ? `rotate(${shape.angle}deg)` : "";
    };
    place();
    ta.addEventListener("input", place);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.finishTextEdit(true);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.finishTextEdit();
      }
    });
    ta.addEventListener("blur", () => setTimeout(() => this.editing?.ta === ta && this.finishTextEdit(), 0));
    this.editing.ta = ta;
    el.wrap.appendChild(ta);
    ta.focus();
    ta.select?.();
    this.emit("text-editing", true);
  }

  finishTextEdit(cancel = false) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const id = this.editingId;
    this.editingId = null;
    const text = ed.ta.value.replace(/\s+$/g, "");
    ed.ta.remove();
    const page = this.model.page(ed.pageId);
    if (ed.isNew) {
      if (!cancel && text) {
        ed.shape.text = text;
        this.model.addShape(ed.pageId, ed.shape);
        this.selectCreated(ed.pageId, ed.shape.id);
      }
    } else if (!cancel) {
      const s = page?.shapes.find((x) => x.id === id);
      if (s) {
        if (text) s.text = text;
        else page.shapes = page.shapes.filter((x) => x.id !== id);
        this.model.commit(ed.before);
      }
    }
    if (page) this.refreshLayer(page, true);
    this.renderSelection();
    this.emit("text-editing", false);
  }

  /* ---------- スタンプ・画像 ---------- */
  setPendingStamp(stamp) {
    this.pendingStamp = stamp; // { imgId, aspect(w/h) }
  }
  placeStamp(pageId, p) {
    const st = this.pendingStamp;
    if (!st) return this.emit("need-stamp");
    const w = st.w || 64;
    const h = w / (st.aspect || 1);
    const c = this.clampToPage(p, pageId);
    this.addAndSelect(pageId, { type: "image", kind: "stamp", imgId: st.imgId, aspect: st.aspect, pts: [[c[0] - w / 2, c[1] - h / 2], [c[0] + w / 2, c[1] + h / 2]], style: {} });
  }
  /** 矩形に収まるように画像を配置(署名など) */
  placeImageInRect(pageId, imgId, aspect, rect, kind = "signature") {
    const [a, b] = rect;
    const rx = Math.min(a[0], b[0]);
    const ry = Math.min(a[1], b[1]);
    const rw = Math.abs(b[0] - a[0]);
    const rh = Math.abs(b[1] - a[1]);
    let w = rw;
    let h = w / aspect;
    if (h > rh) {
      h = rh;
      w = h * aspect;
    }
    const cx = rx + rw / 2;
    const cy = ry + rh / 2;
    return this.addAndSelect(pageId, { type: "image", kind, imgId, aspect, pts: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2]], style: {} });
  }
  /** ページ中央に画像を配置(写真・カメラ) */
  placeImageCentered(pageId, imgId, aspect, maxFrac = 0.8) {
    const pg = this.model.page(pageId);
    let w = pg.w * maxFrac;
    let h = w / aspect;
    if (h > pg.h * maxFrac) {
      h = pg.h * maxFrac;
      w = h * aspect;
    }
    const cx = pg.w / 2;
    const cy = pg.h / 2;
    return this.addAndSelect(pageId, { type: "image", kind: "photo", imgId, aspect, pts: [[cx - w / 2, cy - h / 2], [cx + w / 2, cy + h / 2]], style: {} });
  }

  /* =========================================================
   * 選択・移動・頂点編集
   * ======================================================= */
  selectDown(e, pageId, p) {
    const t = e.target;
    const handle = t.closest?.(".handle");
    const shEl = t.closest?.(".shape");
    const dbl = this.isDoubleTap(e, handle ? `h:${this.sel?.shapeId}:${handle.dataset.kind}:${handle.dataset.idx}` : shEl ? `s:${shEl.dataset.id}` : "empty");
    if (handle && this.sel) {
      e.preventDefault();
      if (dbl && handle.dataset.kind === "v") return this.removeVertex(+handle.dataset.idx);
      if (dbl && handle.dataset.kind === "edge") {
        const f = this.model.findShape(this.sel.shapeId);
        if (f && f.shape.type !== "rect") return this.insertVertex(f.page.id, f.shape, p);
      }
      if (dbl && handle.dataset.kind === "off") {
        const f = this.model.findShape(this.sel.shapeId);
        if (f) return this.emit("dim-edit", { pageId: f.page.id, shape: f.shape });
      }
      return this.beginHandleDrag(e, pageId, handle);
    }
    const page = this.model.page(pageId);
    // ロックしたレイヤーの図形は選べない(何もない所として扱う)
    let shape = shEl ? page.shapes.find((s) => s.id === shEl.dataset.id) : null;
    if (shape && isLayerLocked(shape, this.model.layers)) shape = null;
    const tool = this.tool;
    const modKey = e.shiftKey || e.ctrlKey || e.metaKey; // Shift・Ctrl: 選択に追加/解除
    if (!shape) {
      // 作成直後の調整中なら、何もない所のタップで確定して元のツールに戻る
      if (this.confirmCreated()) return;
      if (tool === "lasso") return this.beginLasso(e, pageId, p);
      // 範囲選択ツール、またはマウスのドラッグなら範囲選択。指(タッチ)の選択ツールではスクロールを妨げない
      if (tool === "marquee" || e.pointerType !== "touch") return this.beginMarquee(e, pageId, p, modKey);
      if (this.sel || this.multi) this.setSelection(null);
      return;
    }
    e.preventDefault();
    const id = shape.id;
    if (dbl && !this.multi) {
      if (shape.type === "text") return this.editText(pageId, shape, false);
      if (shape.type === "dim") return this.emit("dim-edit", { pageId, shape });
      if (shape.type === "leader") return this.emit("leader-edit", { pageId, shapeId: shape.id, isNew: false });
      if (shape.type === "polygon" || shape.type === "polyline" || shape.type === "cloud") return this.insertVertex(pageId, shape, p);
    }
    const inSel = this.selectionPageId() === pageId && this.selectedIds().includes(id);
    if (modKey || (tool !== "select" && !inSel)) {
      // 追加/解除。動かさない(範囲選択・投げ縄ツールでは、選択にない図形のタップで追加)
      const cur = this.selectionPageId() === pageId ? this.selectedIds() : [];
      this.setMultiSelection(pageId, inSel ? cur.filter((x) => x !== id) : [...cur, id]);
      return;
    }
    if (this.multi && inSel) {
      // 選択中のどれかをドラッグすると、まとめて動く
      return this.beginMove(e, pageId, this.selectedItems().map((f) => f.shape).filter((s) => !s.locked), p);
    }
    if (!this.sel || this.sel.shapeId !== id) this.setSelection({ pageId, shapeId: id });
    if (shape.locked) return; // ロック中は動かせない(選択だけできる)
    this.beginMove(e, pageId, [shape], p);
  }

  /** いま選択しているページ(複数選択も含む) */
  selectionPageId() {
    return this.multi ? this.multi.pageId : this.sel ? this.sel.pageId : null;
  }
  /** 選択中の図形id(0個・1個・複数) */
  selectedIds() {
    return this.multi ? [...this.multi.ids] : this.sel ? [this.sel.shapeId] : [];
  }
  /** 選択中の図形 [{ page, shape }] */
  selectedItems() {
    return this.selectedIds().map((id) => this.model.findShape(id)).filter(Boolean);
  }
  /** 複数選択にする(1個なら通常の選択、0個なら選択解除) */
  setMultiSelection(pageId, ids) {
    const page = this.model.page(pageId);
    if (!page) return this.setSelection(null);
    const alive = new Set(page.shapes.map((s) => s.id));
    ids = [...new Set(ids)].filter((id) => alive.has(id));
    if (ids.length === 0) return this.setSelection(null);
    if (ids.length === 1) return this.setSelection({ pageId, shapeId: ids[0] });
    this.sel = null;
    this.multi = { pageId, ids };
    this.renderSelection();
    this.emit("selection", { pageId, multi: true, count: ids.length });
  }
  /** 選択の図形のうち、いま存在しない・非表示・ロック中のレイヤーのものを外す。選択が変わったら true */
  pruneSelection(silent = false) {
    const ok = (f) => f && isLayerVisible(f.shape, this.model.layers) && !isLayerLocked(f.shape, this.model.layers);
    if (this.sel) {
      if (ok(this.model.findShape(this.sel.shapeId))) return false;
      if (silent) this.sel = null;
      else this.setSelection(null);
      return true;
    }
    if (this.multi) {
      const ids = this.multi.ids.filter((id) => ok(this.model.findShape(id)));
      if (ids.length === this.multi.ids.length) return false;
      if (silent) this.multi = null;
      else this.setMultiSelection(this.multi.pageId, ids);
      return true;
    }
    return false;
  }
  /** 範囲選択に使う図形の一覧(表示中で、ロックしていないレイヤーの図形) */
  pickItems(pageId) {
    const page = this.model.page(pageId);
    const L = this.model.layers;
    return page.shapes
      .filter((s) => isLayerVisible(s, L) && !isLayerLocked(s, L) && !s.locked)
      .map((s) => ({ id: s.id, bounds: shapeBounds(s, page), poly: shapePolyline(s) }));
  }
  applyPick(pageId, ids, additive) {
    const cur = additive && this.selectionPageId() === pageId ? this.selectedIds() : [];
    this.setMultiSelection(pageId, [...cur, ...ids]);
  }
  /** ページ内の図形をすべて選択(Ctrl+A) */
  selectAll(pageId = this.curPageId) {
    if (!pageId || !this.model.page(pageId)) return;
    this.applyPick(pageId, this.pickItems(pageId).map((it) => it.id), false);
  }
  /** あるレイヤーの図形をすべて選択(そのページ内) */
  selectLayer(layerId, pageId = this.curPageId) {
    const page = this.model.page(pageId);
    if (!page) return 0;
    const ids = this.pickItems(pageId).map((it) => it.id).filter((id) => (page.shapes.find((s) => s.id === id).layer || "0") === layerId);
    this.setMultiSelection(pageId, ids);
    return ids.length;
  }

  /** 範囲選択: 左から右へドラッグ=窓(完全に入る図形)、右から左へ=交差(触れる図形) */
  beginMarquee(e, pageId, p, additive) {
    const el = this.els.get(pageId);
    const start = this.clampToPage(p, pageId);
    this.g = { kind: "marquee", pageId, id: e.pointerId, p0: start, p1: start, moved: false };
    el.svg.setPointerCapture?.(e.pointerId);
    const z = this.zoom;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const q = this.clampToPage(this.pt(ev, pageId), pageId);
      const g = this.g;
      if (!g) return;
      g.p1 = q;
      if (!g.moved && dist(start, q) * z < 4) return;
      g.moved = true;
      const r = normRect(g.p0, q);
      const crossing = q[0] < g.p0[0];
      el.draft.replaceChildren(sv("rect", {
        x: r.x, y: r.y, width: r.w, height: r.h,
        fill: crossing ? "rgba(22,163,74,.14)" : "rgba(37,99,235,.14)", stroke: crossing ? "#16a34a" : "#2563eb",
        "stroke-width": 1.2 / z, ...(crossing ? { "stroke-dasharray": `${5 / z} ${4 / z}` } : {}),
      }));
    };
    const end = (ev, cancelled) => {
      if (ev.pointerId !== e.pointerId) return;
      this.g?.cleanup?.();
      const g = this.g;
      this.g = null;
      el.draft.replaceChildren();
      if (!g || cancelled) return;
      if (!g.moved) {
        if (!additive) this.setSelection(null);
        return;
      }
      const mode = g.p1[0] >= g.p0[0] ? "window" : "crossing";
      this.applyPick(pageId, pickByRect(this.pickItems(pageId), normRect(g.p0, g.p1), mode), additive);
    };
    const up = (ev) => end(ev, false);
    const cancel = (ev) => end(ev, true);
    this.g.cleanup = () => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", cancel);
    };
    el.svg.addEventListener("pointermove", move);
    el.svg.addEventListener("pointerup", up);
    el.svg.addEventListener("pointercancel", cancel);
  }

  /** 投げ縄: なぞって囲んだ中に完全に入る図形を選ぶ(Shift・Ctrlを押していれば追加) */
  beginLasso(e, pageId, p) {
    const el = this.els.get(pageId);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const start = this.clampToPage(p, pageId);
    this.g = { kind: "marquee", pageId, id: e.pointerId, pts: [start] };
    el.svg.setPointerCapture?.(e.pointerId);
    const z = this.zoom;
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId || !this.g) return;
      const pts = this.g.pts;
      const q = this.clampToPage(this.pt(ev, pageId), pageId);
      if (dist(pts[pts.length - 1], q) * z < 3) return;
      pts.push(q);
      el.draft.replaceChildren(sv("path", {
        d: `M${pts.map((v) => `${v[0].toFixed(1)} ${v[1].toFixed(1)}`).join("L")}Z`,
        fill: "rgba(37,99,235,.10)", stroke: "#2563eb", "stroke-width": 1.2 / z, "stroke-dasharray": `${5 / z} ${4 / z}`,
      }));
    };
    const end = (ev, cancelled) => {
      if (ev.pointerId !== e.pointerId) return;
      this.g?.cleanup?.();
      const g = this.g;
      this.g = null;
      el.draft.replaceChildren();
      if (!g || cancelled) return;
      if (g.pts.length < 3) {
        if (!additive) this.setSelection(null);
        return;
      }
      this.applyPick(pageId, pickByLasso(this.pickItems(pageId), g.pts), additive);
    };
    const up = (ev) => end(ev, false);
    const cancel = (ev) => end(ev, true);
    this.g.cleanup = () => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", cancel);
    };
    el.svg.addEventListener("pointermove", move);
    el.svg.addEventListener("pointerup", up);
    el.svg.addEventListener("pointercancel", cancel);
  }

  /** shapes(1つ以上)を、ドラッグした分だけまとめて動かす */
  beginMove(e, pageId, shapes, p0) {
    if (!shapes.length) return;
    const el = this.els.get(pageId);
    const origins = shapes.map((s) => clone(s.pts));
    this.g = { kind: "move", pageId, id: e.pointerId, before: this.model.snapshot(), moved: false };
    el.svg.setPointerCapture?.(e.pointerId);
    const page = this.model.page(pageId);
    // 動かす範囲の外接枠(ページ外へ出過ぎないようにする)
    const bs = shapes.map((s, i) => shapeBoundsOf(origins[i], s));
    const bx0 = Math.min(...bs.map((b) => b.x));
    const by0 = Math.min(...bs.map((b) => b.y));
    const bx1 = Math.max(...bs.map((b) => b.x + b.w));
    const by1 = Math.max(...bs.map((b) => b.y + b.h));
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const q = this.pt(ev, pageId);
      let dx = q[0] - p0[0];
      let dy = q[1] - p0[1];
      if (!this.g.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
      this.g.moved = true;
      dx = Math.max(-bx1 + 8, Math.min(page.w - bx0 - 8, dx));
      dy = Math.max(-by1 + 8, Math.min(page.h - by0 - 8, dy));
      shapes.forEach((s, i) => {
        s.pts = origins[i].map(([x, y]) => [x + dx, y + dy]);
      });
      this.refreshLayer(page);
      this.renderSelection();
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", up);
      const g = this.g;
      this.g = null;
      if (g?.moved) this.model.commit(g.before);
    };
    this.g.cleanup = () => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", up);
    };
    el.svg.addEventListener("pointermove", move);
    el.svg.addEventListener("pointerup", up);
    el.svg.addEventListener("pointercancel", up);
  }

  beginHandleDrag(e, pageId, handle) {
    const el = this.els.get(pageId);
    const page = this.model.page(pageId);
    const shape = page.shapes.find((s) => s.id === this.sel.shapeId);
    if (!shape) return;
    const kind = handle.dataset.kind;
    const idx = +handle.dataset.idx;
    const corners = shape.type === "rect" || shape.type === "ellipse" || shape.type === "image";
    const startCorners = corners ? rectPoints(shape.pts[0], shape.pts[1]) : null;
    this.g = { kind: "handle", pageId, id: e.pointerId, before: this.model.snapshot(), moved: false };
    el.svg.setPointerCapture?.(e.pointerId);
    const sp = shape.pts.map((pt) => [pt[0], pt[1]]);
    let rotM = null;
    let rotCenter = null;
    const arc = shape.type === "arc" ? { c: shape.pts[0], ...arcGeometry(shape.pts[0], shape.pts[1], shape.sweep) } : null;
    let arcPrev = arc?.sweep;
    const hPts = this.aid.pointsFor(pageId, new Set([shape.id]));
    let hMark = null;
    if (kind === "rot" && !arc) {
      rotM = textMetrics(shape);
      const cs = textCorners(shape, rotM);
      rotCenter = [(cs[0][0] + cs[2][0]) / 2, (cs[0][1] + cs[2][1]) / 2];
    }
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      this.g.moved = true;
      let q = this.clampToPage(this.pt(ev, pageId), pageId);
      if (arc) {
        this.arcHandle(shape, arc, kind, idx, q, ev, arcPrev);
        arcPrev = shape.sweep;
      } else if (kind === "rot") {
        // 文字の回転: 箱の中心を固定して、ハンドルの向きから角度を決める(Shiftで15°刻み)
        const c0 = rotCenter;
        let th = (Math.atan2(q[1] - c0[1], q[0] - c0[0]) * 180) / Math.PI + 90;
        th = ((th % 360) + 360) % 360;
        th = ev.shiftKey ? Math.round(th / 15) * 15 % 360 : Math.round(th);
        const r = (th * Math.PI) / 180;
        shape.angle = th || undefined;
        shape.pts[0] = [c0[0] - ((rotM.w / 2) * Math.cos(r) - (rotM.h / 2) * Math.sin(r)), c0[1] - ((rotM.w / 2) * Math.sin(r) + (rotM.h / 2) * Math.cos(r))];
      } else if (kind === "txt") {
        // 寸法値だけを動かす。元の位置の近くに戻したら引き出し線も消える
        const g0 = dimensionGeometry(shape.pts[0], shape.pts[1], shape.type === "dim" ? shape.off ?? 24 : 0, shape.size || 12, { ...dimOpts(shape), textOff: null });
        const sz = shape.size || 12;
        const bx = q[0] - g0.textUp[0] * sz * 0.6;
        const by = q[1] - g0.textUp[1] * sz * 0.6;
        const off = [bx - g0.textBase[0], by - g0.textBase[1]];
        if (Math.hypot(off[0], off[1]) < Math.max(3, sz * 0.4)) delete shape.textOff;
        else shape.textOff = [+off[0].toFixed(2), +off[1].toFixed(2)];
      } else if (kind === "off") {
        const [a, b] = shape.pts;
        const L = dist(a, b) || 1;
        const nx = -(b[1] - a[1]) / L;
        const ny = (b[0] - a[0]) / L;
        const m = mid(a, b);
        shape.off = (q[0] - m[0]) * nx + (q[1] - m[1]) * ny;
      } else if (kind === "edge") {
        const r = this.aid.resolve(q, { pts: hPts, ev });
        q = this.clampToPage(r.p, pageId);
        hMark = r.mark;
        if (shape.type === "rect") {
          let [x0, y0, x1, y1] = [Math.min(sp[0][0], sp[1][0]), Math.min(sp[0][1], sp[1][1]), Math.max(sp[0][0], sp[1][0]), Math.max(sp[0][1], sp[1][1])];
          if (idx === 0) y0 = q[1];
          else if (idx === 1) x1 = q[0];
          else if (idx === 2) y1 = q[1];
          else x0 = q[0];
          shape.pts = [[x0, y0], [x1, y1]];
        } else {
          const n = sp.length;
          const closed = shape.type === "polygon";
          const A = sp[idx];
          const B = sp[(idx + 1) % n];
          const L = dist(A, B) || 1;
          const nx = -(B[1] - A[1]) / L;
          const ny = (B[0] - A[0]) / L;
          const m0 = mid(A, B);
          const d = (q[0] - m0[0]) * nx + (q[1] - m0[1]) * ny;
          const next = sp.map((pt) => [pt[0], pt[1]]);
          next[idx] = [A[0] + nx * d, A[1] + ny * d];
          next[(idx + 1) % n] = [B[0] + nx * d, B[1] + ny * d];
          if (!closed && idx + 1 >= n) return;
          shape.pts = next;
        }
      } else if (corners) {
        const opp = startCorners[(idx + 2) % 4];
        if (shape.type === "image" && shape.aspect) {
          const w = Math.max(6, Math.abs(q[0] - opp[0]));
          const sx = Math.sign(q[0] - opp[0]) || 1;
          const sy = Math.sign(q[1] - opp[1]) || 1;
          q = [opp[0] + sx * w, opp[1] + (sy * w) / shape.aspect];
        } else {
          const r = this.aid.resolve(q, { pts: hPts, ev });
          q = this.clampToPage(r.p, pageId);
          hMark = r.mark;
          if (ev.shiftKey) {
            const s = Math.max(Math.abs(q[0] - opp[0]), Math.abs(q[1] - opp[1]));
            q = [opp[0] + Math.sign(q[0] - opp[0] || 1) * s, opp[1] + Math.sign(q[1] - opp[1] || 1) * s];
          }
        }
        shape.pts = [opp, q];
      } else {
        const others = shape.pts.filter((_, i) => i !== idx);
        const lineLike = (shape.type === "line" || shape.type === "arrow" || shape.type === "dim" || shape.type === "measure") && others.length === 1;
        const r = this.aid.resolve(q, { pts: hPts, p0: lineLike ? others[0] : null, ev });
        q = this.clampToPage(r.p, pageId);
        hMark = r.mark;
        shape.pts[idx] = q;
        if (shape.type === "dim") shape.text = refreshedDimText(shape.text, dist(shape.pts[0], shape.pts[1]), page.scale); // 端点を動かしたら数値も測り直す
      }
      el.draft.replaceChildren();
      this.aid.drawMark(el.draft, hMark);
      this.refreshLayer(page);
      this.renderSelection();
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", up);
      const g = this.g;
      this.g = null;
      el.draft.replaceChildren();
      if (g?.moved) this.model.commit(g.before);
    };
    this.g.cleanup = () => {
      el.svg.removeEventListener("pointermove", move);
      el.svg.removeEventListener("pointerup", up);
      el.svg.removeEventListener("pointercancel", up);
      el.draft.replaceChildren();
    };
    el.svg.addEventListener("pointermove", move);
    el.svg.addEventListener("pointerup", up);
    el.svg.addEventListener("pointercancel", up);
  }

  /**
   * 円弧のハンドル操作(中心と半径は1つなので常に正円のまま)
   *  v0/v1: 始点/終点を円周に沿って動かし開き角を変える(45°付近で吸着、Shiftで15°刻み)
   *  rad: 半径(大きさ)を変える / rot: 中心のまわりに回す(Shiftで15°刻み)
   */
  arcHandle(shape, arc, kind, idx, q, ev, prev) {
    const { c, r, a, t1 } = arc;
    const deg = (t) => (t * 180) / Math.PI;
    if (kind === "rad") {
      const r2 = Math.max(2, dist(c, q));
      shape.pts = [c, [c[0] + ((a[0] - c[0]) * r2) / (r || 1), c[1] + ((a[1] - c[1]) * r2) / (r || 1)]];
      return;
    }
    if (kind === "rot") {
      // ハンドルは弧の中央の外側にある。ポインタの向きに弧の中央を合わせる
      let th = deg(Math.atan2(q[1] - c[1], q[0] - c[0])) - arc.sweep / 2;
      if (ev.shiftKey) th = Math.round(th / 15) * 15;
      const t = (th * Math.PI) / 180;
      shape.pts = [c, [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]];
      return;
    }
    // 開き角: idx0 は終点を固定して始点を、idx1 は始点を固定して終点を動かす
    let s = idx === 0 ? (((deg(t1 - Math.atan2(q[1] - c[1], q[0] - c[0]))) % 360) + 360) % 360 : arcAngleOf(c, a, q);
    if (prev > 270 && s < 90) s = ARC_MAX; // 一周して反対側へ飛ばないように端で止める
    else if (prev < 90 && s > 270) s = ARC_MIN;
    if (ev.shiftKey) s = Math.round(s / 15) * 15;
    else if (Math.abs(s - Math.round(s / 45) * 45) <= 4) s = Math.round(s / 45) * 45;
    s = clampSweep(Math.round(s));
    shape.sweep = s;
    if (idx === 0) {
      const t0 = t1 - (s * Math.PI) / 180;
      shape.pts = [c, [c[0] + r * Math.cos(t0), c[1] + r * Math.sin(t0)]];
    }
  }

  insertVertex(pageId, shape, p) {
    const pts = shape.pts;
    let best = -1;
    let bd = Infinity;
    const nSeg = shape.type === "polyline" ? pts.length - 1 : pts.length;
    for (let i = 0; i < nSeg; i++) {
      const d = distToSegment(p, pts[i], pts[(i + 1) % pts.length]);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0 || bd > 14 / this.zoom) return;
    this.model.mutate(() => {
      pts.splice(best + 1, 0, [p[0], p[1]]);
    });
    this.setSelection({ pageId, shapeId: shape.id });
  }
  removeVertex(idx) {
    const f = this.model.findShape(this.sel.shapeId);
    if (!f) return;
    const s = f.shape;
    if (((s.type === "polygon" || s.type === "cloud") && s.pts.length > 3) || (s.type === "polyline" && s.pts.length > 2)) {
      this.model.mutate(() => s.pts.splice(idx, 1));
    }
  }

  setSelection(sel) {
    const hadMulti = !!this.multi;
    this.multi = null;
    const same = !hadMulti && ((!sel && !this.sel) || (sel && this.sel && sel.shapeId === this.sel.shapeId));
    this.sel = sel;
    this.renderSelection();
    if (!same) this.emit("selection", sel);
  }
  /* ---- 初期設定(新しく作る図形の既定値。端末に保存) ---- */
  loadDefaults() {
    try {
      const d = JSON.parse(localStorage.getItem("apdf_defaults_v1") || "null");
      if (!d) return;
      Object.assign(this.style, d.style || {});
      Object.assign(this.textStyle, d.textStyle || {});
      if (d.dimSize) this.dimSize = d.dimSize;
      if (d.measureWidth) this.measureWidth = d.measureWidth;
      if (d.dimEnd) Object.assign(this.dimEnd, d.dimEnd);
      if (d.cloudPitch) this.cloudPitch = d.cloudPitch;
      if (d.arrowSize) this.arrowSize = d.arrowSize;
      if (d.leader) Object.assign(this.leader, d.leader);
      if (d.arc) Object.assign(this.arc, d.arc);
      if (d.eraser) Object.assign(this.eraser, d.eraser);
      if (d.modes) Object.assign(this.modes, d.modes);
    } catch {
      /* 破損していたら既定のまま */
    }
  }
  saveDefaults() {
    try {
      localStorage.setItem("apdf_defaults_v1", JSON.stringify({ style: this.style, textStyle: this.textStyle, dimSize: this.dimSize, measureWidth: this.measureWidth, dimEnd: this.dimEnd, cloudPitch: this.cloudPitch, arrowSize: this.arrowSize, leader: this.leader, arc: this.arc, eraser: this.eraser, modes: this.modes }));
    } catch {
      /* 保存できなくてもこのセッションでは有効 */
    }
  }
  /** 描き方の切り替え(丸=楕円/円、円弧=中心/3点、多角形=多角形/ポリライン/正多角形、辺の数) */
  setMode(key, value) {
    if (!(key in this.modes)) return;
    this.cancelPolygon();
    this.cancelArc3();
    this.modes[key] = key === "n" ? Math.max(3, Math.min(64, Math.round(+value) || 6)) : value;
    this.saveDefaults();
    this.emit("mode", this.modes);
  }
  /** 選択中の図形を雲マークに変換する(四角・丸・多角形) */
  convertToCloud() {
    const f = this.sel && this.model.findShape(this.sel.shapeId);
    if (!f || f.shape.locked) return;
    const s = f.shape;
    let pts = null;
    if (s.type === "rect") pts = rectPoints(s.pts[0], s.pts[1]);
    else if (s.type === "ellipse") pts = ellipsePolygonPts(s.pts[0], s.pts[1], 20);
    else if (s.type === "polygon") pts = s.pts.map((q) => [q[0], q[1]]);
    if (!pts) return;
    this.model.mutate(() => {
      s.type = "cloud";
      s.pts = pts;
      s.pitch = this.cloudPitch;
    });
    this.refreshLayer(f.page);
    this.setSelection({ pageId: f.page.id, shapeId: s.id });
  }

  /** 選択中の図形の線・色・文字の設定を、新規作成時の初期設定にする */
  setDefaultsFrom(sh) {
    const st = sh.style || {};
    if (sh.type !== "text") for (const k of ["color", "width", "fill", "fillOpacity", "dash", "opacity"]) if (st[k] !== undefined) this.style[k] = st[k];
    if (sh.type === "text") Object.assign(this.textStyle, { size: sh.size, font: sh.font || "gothic", bold: !!sh.bold, color: sh.color || st.color });
    if (sh.type === "dim" || sh.type === "dimang" || sh.type === "measure") {
      this.dimSize = sh.size;
      this.dimEnd = { style: sh.endStyle ?? "arrow", size: sh.endSize ?? (sh.size || 12) / 2 };
    }
    if (sh.type === "arrow") this.arrowSize = sh.headSize ?? Math.max(10, (st.width ?? 1) * 4.5);
    if (sh.type === "leader") this.leader = { size: sh.size || LEADER_DEFAULT.size, box: sh.box ?? LEADER_DEFAULT.box, tip: sh.tip ?? LEADER_DEFAULT.tip, tipSize: sh.tipSize ?? LEADER_DEFAULT.tipSize, toff: sh.toff ?? 0 };
    if (sh.type === "cloud" && sh.pitch) this.cloudPitch = sh.pitch;
    if (sh.type === "arc") this.arc = { sweep: clampSweep(sh.sweep), r1: !!sh.r1, r2: !!sh.r2 };
    this.saveDefaults();
  }

  selectedShape() {
    if (!this.sel) return null;
    const f = this.model.findShape(this.sel.shapeId);
    return f ? f.shape : null;
  }
  selectedPage() {
    if (!this.sel) return null;
    const f = this.model.findShape(this.sel.shapeId);
    return f ? f.page : null;
  }

  renderSelection() {
    for (const el of this.els.values()) el.ui.replaceChildren();
    if (this.multi && isSelectTool(this.tool)) return this.renderMultiSelection();
    if (!this.sel || !isSelectTool(this.tool)) return;
    const f = this.model.findShape(this.sel.shapeId);
    if (!f) return;
    const el = this.els.get(f.page.id);
    if (!el) return;
    const sh = f.shape;
    const z = this.zoom;
    const b = shapeBounds(sh, f.page);
    const pad = 4 / z;
    el.ui.appendChild(sv("rect", { class: "sel-box", x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, "stroke-width": 1.2 / z, "stroke-dasharray": `${5 / z} ${4 / z}` }));
    const R = matchMedia("(pointer: coarse)").matches ? 10 / z : 6.5 / z;
    if (sh.locked) {
      // ロック中はハンドルを出さない(鍵マークだけ)
      const t = sv("text", { x: b.x + b.w + pad, y: b.y - pad, "font-size": 14 / z, "text-anchor": "start" });
      t.textContent = "🔒";
      el.ui.appendChild(t);
      return;
    }
    const verts = shapeVertices(sh);
    verts.forEach((v, i) => {
      const c = sv("circle", { class: "handle", cx: v[0], cy: v[1], r: R, "stroke-width": 1.6 / z, "data-kind": "v", "data-idx": i });
      el.ui.appendChild(c);
    });
    // 辺の中点ハンドル: 辺をドラッグすると、その辺だけが垂直方向に動く
    const edgeList = edgesOf(sh);
    if (edgeList) {
      edgeList.forEach(([p, q], i) => {
        const m = mid(p, q);
        el.ui.appendChild(sv("rect", { class: "handle mid", x: m[0] - R * 0.8, y: m[1] - R * 0.8, width: R * 1.6, height: R * 1.6, rx: R / 4, "stroke-width": 1.6 / z, "data-kind": "edge", "data-idx": i }));
      });
    }
    if (sh.type === "dim") {
      const g = dimensionGeometry(sh.pts[0], sh.pts[1], sh.off ?? 24, sh.size || 12, dimOpts(sh));
      const m = mid(g.line[0], g.line[1]);
      el.ui.appendChild(sv("rect", { class: "handle mid", x: m[0] - R, y: m[1] - R, width: R * 2, height: R * 2, rx: R / 3, "stroke-width": 1.6 / z, "data-kind": "off", "data-idx": 0 }));
    }
    if (sh.type === "dim" || sh.type === "measure") {
      // 寸法値だけを動かすハンドル(文字の右端の外側)
      const g = dimensionGeometry(sh.pts[0], sh.pts[1], sh.type === "dim" ? sh.off ?? 24 : 0, sh.size || 12, dimOpts(sh));
      const w = textMetrics({ text: labelFor(sh, f.page), size: sh.size || 12, font: sh.font }).w;
      const dir = [Math.cos((g.textAngle * Math.PI) / 180), Math.sin((g.textAngle * Math.PI) / 180)];
      const hx = g.textPos[0] + dir[0] * (w / 2 + R * 1.6);
      const hy = g.textPos[1] + dir[1] * (w / 2 + R * 1.6);
      el.ui.appendChild(sv("circle", { class: "handle mid", cx: hx, cy: hy, r: R * 0.8, "stroke-width": 1.6 / z, "data-kind": "txt", "data-idx": 0 }));
    }
    if (sh.type === "arc") {
      // 中心の目印(+)・大きさ(半径)ハンドル(弧の中央)・回転ハンドル(弧の中央の外側)
      const g = arcGeometry(sh.pts[0], sh.pts[1], sh.sweep);
      const c = sh.pts[0];
      const k = 5 / z;
      el.ui.appendChild(sv("path", { class: "sel-box", d: `M${c[0] - k} ${c[1]}H${c[0] + k}M${c[0]} ${c[1] - k}V${c[1] + k}`, "stroke-width": 1.2 / z }));
      const u = g.r > 0 ? [(g.mid[0] - c[0]) / g.r, (g.mid[1] - c[1]) / g.r] : [0, -1];
      const hp = [g.mid[0] + u[0] * 26 / z, g.mid[1] + u[1] * 26 / z];
      el.ui.appendChild(sv("line", { class: "sel-box", x1: g.mid[0], y1: g.mid[1], x2: hp[0], y2: hp[1], "stroke-width": 1.2 / z }));
      el.ui.appendChild(sv("rect", { class: "handle mid", x: g.mid[0] - R, y: g.mid[1] - R, width: R * 2, height: R * 2, rx: R / 3, "stroke-width": 1.6 / z, "data-kind": "rad", "data-idx": 0 }));
      el.ui.appendChild(sv("circle", { class: "handle rot", cx: hp[0], cy: hp[1], r: R * 0.9, "stroke-width": 1.6 / z, "data-kind": "rot", "data-idx": 0 }));
    }
    if (sh.type === "text") {
      // 回転ハンドル(箱の上辺中央から外側へ)
      const cs = textCorners(sh);
      const top = [(cs[0][0] + cs[1][0]) / 2, (cs[0][1] + cs[1][1]) / 2];
      const ctr = [(cs[0][0] + cs[2][0]) / 2, (cs[0][1] + cs[2][1]) / 2];
      const d = dist(top, ctr) || 1;
      const k = (d + 22 / z) / d;
      const hp = [ctr[0] + (top[0] - ctr[0]) * k, ctr[1] + (top[1] - ctr[1]) * k];
      el.ui.appendChild(sv("line", { class: "sel-box", x1: top[0], y1: top[1], x2: hp[0], y2: hp[1], "stroke-width": 1.2 / z }));
      el.ui.appendChild(sv("circle", { class: "handle rot", cx: hp[0], cy: hp[1], r: R * 0.9, "stroke-width": 1.6 / z, "data-kind": "rot", "data-idx": 0 }));
    }
  }

  /** 複数選択: 図形ごとの枠と、全体を囲む枠(ハンドルは出さない。ドラッグでまとめて移動) */
  renderMultiSelection() {
    const items = this.selectedItems();
    if (!items.length) return;
    const el = this.els.get(items[0].page.id);
    if (!el) return;
    const z = this.zoom;
    const pad = 3 / z;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const { shape, page } of items) {
      const b = shapeBounds(shape, page);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
      el.ui.appendChild(sv("rect", { class: "sel-box sel-one", x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, "stroke-width": 1 / z, "stroke-dasharray": `${4 / z} ${3 / z}` }));
    }
    const m = 8 / z;
    el.ui.appendChild(sv("rect", { class: "sel-box", x: x0 - m, y: y0 - m, width: x1 - x0 + 2 * m, height: y1 - y0 + 2 * m, "stroke-width": 1.4 / z, "stroke-dasharray": `${6 / z} ${4 / z}` }));
  }

  /* =========================================================
   * 編集操作(プロパティ・削除など)
   * ======================================================= */
  /** 選択中の図形を変更。live=true の間は履歴に積まず、commitLive() でまとめて確定 */
  setLocked(lock) {
    const f = this.sel && this.model.findShape(this.sel.shapeId);
    if (!f) return;
    this.model.mutate(() => {
      if (lock) f.shape.locked = true;
      else delete f.shape.locked;
    });
    this.refreshLayer(f.page);
    this.renderSelection();
  }
  /** 選択中の図形を変更(複数選択ならすべて)。ロック中の図形は除く */
  updateSelected(fn, { live = false } = {}) {
    const items = this.selectedItems().filter((f) => !f.shape.locked);
    if (!items.length) return;
    if (live) {
      if (!this.liveBefore) this.liveBefore = this.model.snapshot();
      for (const f of items) fn(f.shape, f.page);
      for (const pg of new Set(items.map((f) => f.page))) this.refreshLayer(pg);
      this.renderSelection();
    } else {
      this.model.mutate(() => items.forEach((f) => fn(f.shape, f.page)));
    }
  }
  commitLive() {
    if (!this.liveBefore) return;
    const b = this.liveBefore;
    this.liveBefore = null;
    this.model.commit(b);
  }
  deleteSelected() {
    const items = this.selectedItems().filter((f) => !f.shape.locked);
    if (!items.length) return;
    const pageId = items[0].page.id;
    this.setSelection(null);
    this.model.removeShapes(pageId, items.map((f) => f.shape.id));
  }
  /* =========================================================
   * 修正コマンド(基点つき移動/コピー・回転・尺度・鏡像・配列・オフセット)
   * ======================================================= */
  /** 変換した図形の一覧(対象外の数も返す)。copy なら新しい図形、そうでなければ元の図形と同じ id */
  transformItems(items, m, copy) {
    const out = [];
    let skipped = 0;
    for (const { shape } of items) {
      const t = transformShape(shape, m, { metrics: textMetrics });
      if (!t) {
        skipped++;
        continue;
      }
      if (copy) t.id = "h" + uid();
      out.push(t);
    }
    return { out, skipped };
  }
  /** 選択中の図形に変換(matrices)をかける。copy=true なら元を残して複製、false なら元を動かす(matrices は1つ) */
  applyMatrices(matrices, { copy = false, select = false } = {}) {
    const items = this.selectedItems().filter((f) => !f.shape.locked);
    if (!items.length || !matrices.length) return 0;
    const page = items[0].page;
    let skipped = 0;
    const added = [];
    this.model.mutate(() => {
      for (const m of matrices) {
        const mm = typeof m === "function" ? m(items) : m;
        const { out, skipped: sk } = this.transformItems(items, mm, copy);
        skipped += sk;
        if (copy) {
          page.shapes.push(...out);
          added.push(...out.map((o) => o.id));
        } else {
          for (const t of out) {
            const i = page.shapes.findIndex((x) => x.id === t.id);
            if (i >= 0) page.shapes[i] = t;
          }
        }
      }
    });
    if (select && added.length) this.setMultiSelection(page.id, [...items.map((f) => f.shape.id), ...added]);
    if (skipped) this.emit("toast", { text: `向きを変えられない図形(画像・スタンプなど)${skipped}個はそのままです` });
    return added.length || items.length;
  }
  /** 選択範囲の中心(図形の外接枠の中心) */
  selectionCenter() {
    const items = this.selectedItems();
    if (!items.length) return [0, 0];
    const bs = items.map((f) => shapeBounds(f.shape, f.page));
    const x0 = Math.min(...bs.map((b) => b.x));
    const y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w));
    const y1 = Math.max(...bs.map((b) => b.y + b.h));
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }
  /** 矩形状配列(行×列。間隔はpt。右・下が正) */
  arrayRect(rows, cols, dx, dy) {
    rows = Math.max(1, Math.min(100, Math.round(rows) || 1));
    cols = Math.max(1, Math.min(100, Math.round(cols) || 1));
    if (rows * cols > 500) return this.emit("toast", { text: "配列は500個までです", error: true });
    if (rows * cols <= 1) return;
    this.applyMatrices(rectArray(rows, cols, dx, dy), { copy: true, select: true });
  }
  /** 円形状配列(中心 c、元を含む count 個、angle は全体の角度) */
  arrayPolar(c, count, angle, rotateItems) {
    count = Math.max(2, Math.min(500, Math.round(count) || 2));
    const center = this.selectionCenter();
    const mats = polarArray(c, count, angle).map((m) => {
      if (rotateItems) return m;
      const q = applyM(m, center);
      return moveM(q[0] - center[0], q[1] - center[1]);
    });
    this.applyMatrices(mats, { copy: true, select: true });
  }

  /**
   * 点を順に指定するコマンドを始める。name: move | copy | rotate | scale | mirror | polar | offset
   * opts: rotate { angle, copy } / scale { k, copy } / mirror { keep } / polar { count, angle, rotateItems } / offset { dist }(pt)
   */
  startCommand(name, opts = {}) {
    this.cancelCommand();
    const PICK = new Set(["trim", "extend", "fillet", "chamfer", "break", "stretch", "dimradius", "dimdiameter", "dimangle", "dimseries", "dimpara"]); // 図形を選ばずに始めるコマンド
    if (!isSelectTool(this.tool)) this.setTool("select");
    const items = this.selectedItems().filter((f) => !f.shape.locked);
    if (!PICK.has(name) && !items.length) return this.emit("toast", { text: "先に図形を選んでください" });
    if (name === "offset" && items.length !== 1) return this.emit("toast", { text: "オフセットは図形を1つだけ選んでください" });
    const prompts = {
      trim: ["消したい部分をタップ(他の図形との交点までが消えます。続けて何度でも)"],
      extend: ["伸ばしたい線の端の近くをタップ(続けて何度でも)"],
      fillet: ["1本目の線の、残す側をタップ", "2本目の線の、残す側をタップ"],
      chamfer: ["1本目の線の、残す側をタップ", "2本目の線の、残す側をタップ"],
      break: ["線を切りたい位置をタップ(続けて何度でも)"],
      stretch: ["動かしたい部分を囲む窓の1つめの角をタップ", "窓の2つめの角をタップ", "基点をタップ", "移動先をタップ"],
      dimradius: ["半径を測る円・円弧をタップ", "寸法を入れる向きの点をタップ"],
      dimdiameter: ["直径を測る円・円弧をタップ", "寸法を入れる向きの点をタップ"],
      dimangle: ["角の頂点をタップ", "1本目の線上の点をタップ", "2本目の線上の点をタップ"],
      dimseries: ["最初の測点をタップ", "次の測点をタップ(続けて何度でも。終わるには「完了」か同じ点を2回タップ)"],
      dimpara: ["基準の測点をタップ", "次の測点をタップ(続けて何度でも。終わるには「完了」か同じ点を2回タップ)"],
      move: ["基点をタップ(または基点から移動先までドラッグ)", "移動先をタップ"],
      copy: ["基点をタップ(または基点からコピー先までドラッグ)", "コピー先をタップ(続けて何度でも。終わるには中止)"],
      rotate: ["回転の中心(基点)をタップ"],
      scale: ["尺度の基点をタップ"],
      mirror: ["鏡像の軸の1点目をタップ", "軸の2点目をタップ"],
      polar: ["配列の中心をタップ"],
      offset: ["ずらす側をタップ(続けて何度でも。終わるには中止)"],
    }[name];
    if (!prompts) return;
    this.cmd = { name, opts, pageId: null, prompts, pts: [], hover: null, mark: null, picks: [] };
    this.pagesEl.classList.toggle("cmd-drag", name === "move" || name === "copy"); // 指でドラッグしても画面が動かないようにする
    this.cmdMoveFn = (ev) => {
      if (!this.cmd) return;
      const r = this.aid.resolve(this.clampToPage(this.pt(ev, this.cmd.pageId), this.cmd.pageId), { pts: this.cmd.snapPts, p0: this.cmd.pts[this.cmd.pts.length - 1] || null, ev });
      this.cmd.hover = r.p;
      this.cmd.mark = r.mark;
      this.drawCmdDraft();
    };
    if (items.length) this.bindCmdPage(items[0].page.id);
    this.emit("cmd", { text: prompts[0], done: name === "dimseries" || name === "dimpara" ? true : undefined });
  }
  /** コマンドの対象ページを決めて、点の吸い付き候補と動きの追従を用意する */
  bindCmdPage(pageId) {
    const c = this.cmd;
    c.pageId = pageId;
    c.snapPts = this.aid.pointsFor(pageId, new Set());
    this.els.get(pageId)?.svg.addEventListener("pointermove", this.cmdMoveFn);
  }
  cancelCommand() {
    if (!this.cmd) return;
    const el = this.cmd.pageId && this.els.get(this.cmd.pageId);
    el?.svg.removeEventListener("pointermove", this.cmdMoveFn);
    this.pagesEl.classList.remove("cmd-drag");
    el?.draft.replaceChildren();
    this.cmd = null;
    this.emit("cmd", null);
  }
  drawCmdDraft() {
    const c = this.cmd;
    const el = c && this.els.get(c.pageId);
    if (!el) return;
    el.draft.replaceChildren();
    const z = this.zoom;
    const last = c.pts[c.pts.length - 1];
    if (last && c.hover && !(c.name === "stretch" && c.pts.length <= 2)) {
      el.draft.appendChild(sv("line", { x1: last[0], y1: last[1], x2: c.hover[0], y2: c.hover[1], stroke: "#2563eb", "stroke-width": 1.4 / z, "stroke-dasharray": `${5 / z} ${4 / z}`, "pointer-events": "none" }));
      el.draft.appendChild(sv("circle", { cx: last[0], cy: last[1], r: 3.5 / z, fill: "#2563eb", "pointer-events": "none" }));
    }
    if (c.name === "stretch" && c.pts.length >= 1 && c.pts.length <= 2) {
      const a = c.pts[0];
      const b = c.pts.length === 2 ? c.pts[1] : c.hover;
      if (b) el.draft.appendChild(sv("rect", { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(b[0] - a[0]), height: Math.abs(b[1] - a[1]), fill: "rgba(37,99,235,.08)", stroke: "#2563eb", "stroke-width": 1.2 / z, "stroke-dasharray": `${5 / z} ${4 / z}`, "pointer-events": "none" }));
    }
    this.aid.drawMark(el.draft, c.mark);
  }
  cmdDown(e, pageId, p) {
    const c = this.cmd;
    e.preventDefault();
    if (c.pageId == null) this.bindCmdPage(pageId);
    if (pageId !== c.pageId) return;
    if (PICK_CMDS.has(c.name) && c.name !== "stretch") return this.pickCommandDown(e, pageId, p);
    const r = this.aid.resolve(this.clampToPage(p, pageId), { pts: c.snapPts, p0: c.pts[c.pts.length - 1] || null, ev: e });
    const q = this.clampToPage(r.p, pageId);
    const o = c.opts;
    if (c.name === "offset") {
      const f = this.selectedItems()[0];
      const t = f && offsetShape(f.shape, o.dist, q);
      if (!t) return this.emit("toast", { text: "この図形・距離ではオフセットできません" });
      t.id = "h" + uid();
      this.model.mutate(() => f.page.shapes.push(t));
      return;
    }
    if (c.name === "dimseries" || c.name === "dimpara") {
      const last = c.pts[c.pts.length - 1];
      if (last && dist(last, q) < 3) return this.finishCommand();
      c.pts.push(q);
      this.emit("cmd", { text: c.prompts[Math.min(c.pts.length, c.prompts.length - 1)], done: true });
      return this.drawCmdDraft();
    }
    c.pts.push(q);
    if (c.name === "dimangle") {
      if (c.pts.length === 3) {
        const [v, a, b] = c.pts;
        const r = defaultAngleRadius(v, a, b);
        if (angleBetween(v, a, b) == null) {
          c.pts = [];
          this.emit("cmd", { text: c.prompts[0] });
          return this.emit("toast", { text: "角度が作れません。頂点と別の2点をタップしてください" });
        }
        const sh = this.addAndSelect(pageId, { type: "dimang", pts: [v, a, b], r, size: this.dimSize, endStyle: this.dimEnd.style, endSize: this.dimEnd.size, style: { ...this.style, width: Math.min(this.style.width, 2) } });
        this.cancelCommand();
        return sh;
      }
    } else if (c.name === "stretch") {
      if (c.pts.length === 4) {
        const [a, b, base, to] = c.pts;
        this.stretchWindow({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }, to[0] - base[0], to[1] - base[1]);
        return this.cancelCommand();
      }
    } else if (c.name === "move" || c.name === "copy") {
      if (c.pts.length === 2) {
        if (this.applyMoveCopy(c)) return;
      } else this.armDragDrop(e, c, pageId);
    } else if (c.name === "rotate") {
      this.applyMatrices([rotateM(q, o.angle)], { copy: !!o.copy });
      return this.cancelCommand();
    } else if (c.name === "scale") {
      if (!(o.k > 0)) return this.cancelCommand();
      this.applyMatrices([scaleM(q, o.k)], { copy: !!o.copy });
      return this.cancelCommand();
    } else if (c.name === "mirror") {
      if (c.pts.length === 2) {
        const m = mirrorM(c.pts[0], c.pts[1]);
        if (m) this.applyMatrices([m], { copy: !!o.keep });
        return this.cancelCommand();
      }
    } else if (c.name === "polar") {
      this.arrayPolar(q, o.count, o.angle, o.rotateItems);
      return this.cancelCommand();
    }
    this.emit("cmd", { text: c.prompts[Math.min(c.pts.length, c.prompts.length - 1)] });
    this.drawCmdDraft();
  }

  /** 移動・コピーの2点(基点・移動先)が揃ったとき実行する。続きがあれば false、移動で終われば true */
  applyMoveCopy(c) {
    const [a, b] = c.pts;
    this.applyMatrices([moveM(b[0] - a[0], b[1] - a[1])], { copy: c.name === "copy" });
    if (c.name === "copy") {
      c.pts = [a]; // 同じ基点から続けてコピー
      return false;
    }
    this.cancelCommand();
    return true;
  }
  /** 基点を押したまま移動先までドラッグして離すと、離した点(吸着あり)を移動先にする。ちょん押し(タップ)なら従来どおり次のタップを待つ */
  armDragDrop(e, c, pageId) {
    const x0 = e.clientX;
    const y0 = e.clientY;
    const done = () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", done);
    };
    const up = (ev) => {
      done();
      if (this.cmd !== c || c.pts.length !== 1) return;
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return; // タップ
      const r = this.aid.resolve(this.clampToPage(this.pt(ev, pageId), pageId), { pts: c.snapPts, p0: c.pts[0], ev });
      c.pts.push(this.clampToPage(r.p, pageId));
      if (this.applyMoveCopy(c)) return;
      this.emit("cmd", { text: c.prompts[1] });
      this.drawCmdDraft();
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", done);
  }

  /** 四角・多角形・ポリラインの、タップした位置に一番近い角を丸める(四角は多角形に変わる) */
  roundOneCorner(f, p, r) {
    const sh = f.shape;
    if (!(r > 0)) return this.emit("toast", { text: "半径を0より大きくしてください(0では丸められません)" });
    const pts = sh.type === "rect" ? rectPoints(sh.pts[0], sh.pts[1]) : sh.pts;
    let idx = 0;
    pts.forEach((v, i) => {
      if (dist(v, p) < dist(pts[idx], p)) idx = i;
    });
    const out = roundCorners(pts, sh.type !== "polyline", r, [idx]);
    if (!out) return this.emit("toast", { text: "この角は丸められません(端の点、またはほぼ一直線です)" });
    this.model.mutate(() => {
      if (sh.type === "rect") { sh.type = "polygon"; delete sh.hide; }
      sh.pts = out;
    });
  }
  /** 選んだ四角・多角形・ポリラインの角を全部丸める */
  roundSelectedCorners(r) {
    const items = this.selectedItems().filter((x) => !x.shape.locked && ["rect", "polygon", "polyline"].includes(x.shape.type));
    if (!items.length) return this.emit("toast", { text: "四角・多角形・ポリラインを選んでください" });
    if (!(r > 0)) return this.emit("toast", { text: "半径を0より大きくしてください" });
    let n = 0;
    this.model.mutate(() => {
      for (const { shape: sh } of items) {
        const out = roundCorners(sh.type === "rect" ? rectPoints(sh.pts[0], sh.pts[1]) : sh.pts, sh.type !== "polyline", r);
        if (!out) continue;
        if (sh.type === "rect") { sh.type = "polygon"; delete sh.hide; }
        sh.pts = out;
        n++;
      }
    });
    if (!n) this.emit("toast", { text: "丸められる角がありませんでした" });
  }

  /** 直列・並列寸法: 集めた測点から寸法をまとめて作る */
  finishCommand() {
    const c = this.cmd;
    if (!c) return;
    const { name, pageId, pts } = c;
    if (pts.length < 2) return this.emit("toast", { text: "測点を2つ以上タップしてください" });
    const page = this.model.page(pageId);
    const sc = page?.scale;
    const size = this.dimSize;
    const items = chainDims(pts, name === "dimpara" ? "parallel" : "series", 24, size);
    const base = { type: "dim", size, endStyle: this.dimEnd.style, endSize: this.dimEnd.size, style: { ...this.style, width: Math.min(this.style.width, 2) } };
    const ids = [];
    this.model.mutate(() => {
      for (const it of items) {
        const L = dist(it.pts[0], it.pts[1]);
        const text = dimValueText(L, sc);
        const sh = { ...base, id: "h" + uid(), pts: it.pts, off: it.off, text, style: { ...base.style } };
        stampNewShape(sh, this.model.curLayer);
        page.shapes.push(sh);
        ids.push(sh.id);
      }
    });
    this.cancelCommand();
    if (ids.length) this.selectCreated(pageId, ids[ids.length - 1]);
  }
  /** 半径・直径寸法: 円か円弧をタップ → 向きの点をタップ */
  circleDimDown(e, pageId, p) {
    const c = this.cmd;
    const kind = c.name === "dimdiameter" ? "diameter" : "radius";
    if (!c.picks.length) {
      // 重なった寸法などは飛ばして、下にある円・円弧を探す
      let sh = null;
      for (const n of document.elementsFromPoint(e.clientX, e.clientY)) {
        const id = n.closest?.(".shape")?.dataset.id;
        const f = id && this.model.findShape(id);
        if (f && !f.shape.locked && (f.shape.type === "arc" || f.shape.type === "ellipse")) {
          sh = f.shape;
          break;
        }
      }
      let circ = null;
      if (sh?.type === "arc") circ = { center: sh.pts[0], r: dist(sh.pts[0], sh.pts[1]) };
      else if (sh?.type === "ellipse") {
        const rx = Math.abs(sh.pts[1][0] - sh.pts[0][0]) / 2;
        const ry = Math.abs(sh.pts[1][1] - sh.pts[0][1]) / 2;
        if (Math.abs(rx - ry) < 0.5 && !sh.angle) circ = { center: [(sh.pts[0][0] + sh.pts[1][0]) / 2, (sh.pts[0][1] + sh.pts[1][1]) / 2], r: rx };
      }
      if (!circ || !(circ.r > 0)) return this.emit("toast", { text: "円・円弧をタップしてください(楕円は対象外です)" });
      c.picks.push(circ);
      c.snapPts = c.snapPts || [];
      return this.emit("cmd", { text: c.prompts[1] });
    }
    const { center, r } = c.picks[0];
    const q = this.aid.resolve(this.clampToPage(p, pageId), { pts: c.snapPts, ev: e }).p;
    if (dist(center, q) < 1) return this.emit("toast", { text: "中心から離れた点をタップしてください" });
    const pts = circleDimPts(center, r, q, kind);
    const page = this.model.page(pageId);
    this.cancelCommand();
    this.emit("dim-request", {
      pageId,
      create: (text) => this.addAndSelect(pageId, { type: "dim", pts, off: 0, size: this.dimSize, endStyle: this.dimEnd.style, endSize: this.dimEnd.size, one: kind === "radius", noExt: true, text: text ? (kind === "radius" ? "R" : "⌀") + text : text, style: { ...this.style, width: Math.min(this.style.width, 2) } }),
      length: dist(pts[0], pts[1]),
      scale: page.scale,
    });
  }

  /** ページ内で、他の図形の線分(トリム・延長の境界)。pen・文字・画像は除く */
  cutterSegments(page, excludeId) {
    const segs = [];
    for (const sh of page.shapes) {
      if (sh.id === excludeId || sh.type === "pen" || sh.type === "text" || sh.type === "image" || sh.type === "stamp") continue;
      if (!isLayerVisible(sh.layer || "0", this.model.layers)) continue;
      const poly = shapePolyline(sh);
      if (!poly) continue;
      const n = poly.closed ? poly.pts.length : poly.pts.length - 1;
      for (let i = 0; i < n; i++) segs.push([poly.pts[i], poly.pts[(i + 1) % poly.pts.length]]);
    }
    return segs;
  }
  /** タップした位置の図形(ロック・非表示は除く) */
  shapeUnder(e) {
    const id = e.target.closest?.(".shape")?.dataset.id;
    const f = id && this.model.findShape(id);
    return f && !f.shape.locked ? f : null;
  }
  /** トリム・延長・フィレット・面取り・切断: 図形をタップして実行する */
  pickCommandDown(e, pageId, p) {
    const c = this.cmd;
    if (c.name === "dimradius" || c.name === "dimdiameter") return this.circleDimDown(e, pageId, p);
    const f = this.shapeUnder(e);
    const name = c.name;
    const LINEISH = new Set(["line", "arrow", "polyline"]);
    const warn = (text) => this.emit("toast", { text });
    if (!f || f.page.id !== pageId) return warn("線をタップしてください");
    const sh = f.shape;
    if (name === "trim" || name === "extend" || name === "break") {
      if (!LINEISH.has(sh.type) || (name === "break" && sh.type === "arrow")) return warn(name === "break" ? "線・ポリラインをタップしてください" : "線・矢印・ポリラインをタップしてください");
      if (name === "break") {
        const q = this.aid.resolve(this.clampToPage(p, pageId), { pts: c.snapPts, ev: e }).p;
        const parts = splitPolyline(sh.pts, q);
        if (!parts) return warn("端では切れません");
        const second = clone(sh);
        second.id = "h" + uid();
        second.pts = parts[1];
        this.model.mutate(() => {
          sh.pts = parts[0];
          f.page.shapes.splice(f.page.shapes.indexOf(sh) + 1, 0, second);
        });
        return;
      }
      const cutters = this.cutterSegments(f.page, sh.id);
      if (name === "trim") {
        const out = trimPolyline(sh.pts, cutters, p);
        if (!out) return warn("交わる図形がないのでトリムできません");
        this.model.mutate(() => {
          const i = f.page.shapes.indexOf(sh);
          const extra = out.slice(1).map((pts) => Object.assign(clone(sh), { id: "h" + uid(), pts }));
          if (out.length) sh.pts = out[0];
          f.page.shapes.splice(i + 1, 0, ...extra);
        });
        return;
      }
      const ext = extendPolyline(sh.pts, cutters, p);
      if (!ext) return warn("延長先の図形が見つかりません");
      this.model.mutate(() => (sh.pts = ext));
      return;
    }
    if (name === "fillet" && !c.picks.length && (sh.type === "rect" || sh.type === "polygon" || sh.type === "polyline")) return this.roundOneCorner(f, p, c.opts.radius);
    // フィレット・面取り: 線を2本
    if (sh.type !== "line") return warn("線(直線)をタップしてください");
    c.picks.push({ shape: sh, page: f.page, p });
    if (c.picks.length < 2) return this.emit("cmd", { text: c.prompts[1] });
    const [a, b] = c.picks;
    c.picks = [];
    this.emit("cmd", { text: c.prompts[0] });
    if (a.shape.id === b.shape.id) return warn("別々の2本をタップしてください");
    const o = c.opts;
    if (name === "fillet") {
      const r = filletLines(a.shape.pts, b.shape.pts, o.radius || 0, a.p, b.p);
      if (!r) return warn("この2本・半径ではフィレットできません(平行、または半径が大きすぎます)");
      this.model.mutate(() => {
        a.shape.pts = r.l1;
        b.shape.pts = r.l2;
        if (r.arc) {
          const arc = { id: "h" + uid(), type: "arc", pts: r.arc.pts, sweep: r.arc.sweep, style: { ...(a.shape.style || {}), fill: "none" } };
          if (a.shape.layer) arc.layer = a.shape.layer;
          if (a.shape.bl) arc.bl = [...a.shape.bl];
          a.page.shapes.push(arc);
        }
      });
      return;
    }
    const r = chamferLines(a.shape.pts, b.shape.pts, o.d1 || 0, o.d2 ?? o.d1 ?? 0, a.p, b.p);
    if (!r) return warn("この2本・距離では面取りできません(平行、または距離が長すぎます)");
    this.model.mutate(() => {
      a.shape.pts = r.l1;
      b.shape.pts = r.l2;
      if (r.line) {
        const ln = Object.assign(clone(a.shape), { id: "h" + uid(), pts: r.line });
        a.page.shapes.push(ln);
      }
    });
  }
  /** ストレッチ: 窓に入る頂点を (dx,dy) 動かす */
  stretchWindow(win, dx, dy) {
    const page = this.model.page(this.cmd.pageId);
    if (!page || (!dx && !dy)) return;
    let n = 0;
    this.model.mutate(() => {
      page.shapes.forEach((sh, i) => {
        if (sh.locked || !isLayerVisible(sh.layer || "0", this.model.layers)) return;
        const t = stretchShape(sh, win, dx, dy, shapeBounds(sh, page));
        if (t) {
          if (t.type === "dim") t.text = refreshedDimText(t.text, dist(t.pts[0], t.pts[1]), page.scale);
          page.shapes[i] = t;
          n++;
        }
      });
    });
    if (!n) this.emit("toast", { text: "窓の中に動かせる頂点がありません" });
  }
  /** 選んだ線・ポリラインの端点がつながるものをひとつのポリラインにする */
  joinSelected() {
    const items = this.selectedItems().filter((f) => !f.shape.locked && (f.shape.type === "line" || f.shape.type === "polyline"));
    if (items.length < 2) return this.emit("toast", { text: "つなげたい線を2本以上選んでください" });
    const page = items[0].page;
    const chains = joinChains(items.map((f) => ({ id: f.shape.id, pts: f.shape.pts })), 0.5).filter((ch) => ch.ids.length > 1);
    if (!chains.length) return this.emit("toast", { text: "端点がつながっている線がありません" });
    const made = [];
    this.model.mutate(() => {
      for (const ch of chains) {
        const first = page.shapes.find((s) => s.id === ch.ids[0]);
        const joined = clone(first);
        joined.id = "h" + uid();
        joined.type = ch.closed ? "polygon" : "polyline";
        joined.pts = ch.pts;
        if (joined.style && ch.closed) joined.style = { ...joined.style, fill: "none" };
        const gone = new Set(ch.ids);
        const at = page.shapes.findIndex((s) => gone.has(s.id));
        page.shapes = page.shapes.filter((s) => !gone.has(s.id));
        page.shapes.splice(at, 0, joined);
        made.push(joined.id);
      }
    });
    this.setMultiSelection(page.id, made);
  }
  /** 選んだ四角・多角形・ポリラインを1本ずつの線にばらす */
  explodeSelected() {
    const items = this.selectedItems().filter((f) => !f.shape.locked);
    if (!items.length) return this.emit("toast", { text: "先に図形を選んでください" });
    const page = items[0].page;
    const made = [];
    let skipped = 0;
    this.model.mutate(() => {
      for (const { shape } of items) {
        const lines = explodeShape(shape);
        if (!lines) {
          skipped++;
          continue;
        }
        lines.forEach((l) => (l.id = "h" + uid()));
        const at = page.shapes.indexOf(shape);
        page.shapes.splice(at, 1, ...lines);
        made.push(...lines.map((l) => l.id));
      }
    });
    if (made.length) this.setMultiSelection(page.id, made);
    if (skipped) this.emit("toast", { text: made.length ? `分解できない図形${skipped}個はそのままです` : "分解できるのは四角・多角形・ポリラインです" });
  }

  duplicateSelected() {
    const items = this.selectedItems().filter((f) => !f.shape.locked);
    if (!items.length) return;
    const page = items[0].page;
    const copies = items.map(({ shape }) => {
      const c = clone(shape);
      c.id = "h" + uid();
      c.pts = c.pts.map(([x, y]) => [x + 14, y + 14]);
      return c;
    });
    this.model.mutate(() => page.shapes.push(...copies));
    this.setMultiSelection(page.id, copies.map((c) => c.id));
  }
  reorderSelected(toFront) {
    const items = this.selectedItems().filter((f) => !f.shape.locked);
    if (!items.length) return;
    const page = items[0].page;
    const ids = new Set(items.map((f) => f.shape.id));
    this.model.mutate(() => {
      const moving = page.shapes.filter((s) => ids.has(s.id));
      const rest = page.shapes.filter((s) => !ids.has(s.id));
      page.shapes = toFront ? [...rest, ...moving] : [...moving, ...rest];
    });
  }

  /* ---- レイヤー ---- */
  /** 次に描く図形が入るレイヤー */
  setCurrentLayer(id) {
    if (!this.model.layer(id)) return;
    this.model.curLayer = id;
    this.emit("layer-current", id);
  }
  /** 選択中の図形を別のレイヤーへ移す */
  moveSelectedToLayer(layerId) {
    if (!this.model.layer(layerId)) return;
    this.updateSelected((sh) => {
      sh.layer = layerId;
    });
  }
  /** 選択中の図形の 色/太さ/線種(keys)を、レイヤーに従わせる/個別指定にする */
  setByLayer(keys, on) {
    this.updateSelected((sh) => {
      const set = new Set(sh.bl || []);
      for (const k of keys) {
        if (!BL_KEYS.includes(k)) continue;
        if (on) set.add(k);
        else set.delete(k);
      }
      if (set.size) sh.bl = [...set];
      else delete sh.bl;
    });
  }
  editSelectedText() {
    const f = this.sel && this.model.findShape(this.sel.shapeId);
    if (f?.shape.type === "text") this.editText(f.page.id, f.shape, false);
  }

  /** ショートカットの設定(機能 → 文字)を差し替える */
  setShortcuts(map) {
    this.shortcuts = map;
    this.keys.setMap(map);
  }
  /** ショートカットで呼ばれた機能を実行する。cmd:〜 は選んだ図形に対するコマンド、それ以外はツールかコマンド */
  runShortcut(id) {
    if (id === "cmd:explode") this.explodeSelected();
    else if (id === "cmd:join") this.joinSelected();
    else if (id.startsWith("cmd:")) this.startCommand(id.slice(4));
    else if (COMMAND_SHORTCUTS.has(id)) this.startCommand(id);
    else this.setTool(id);
  }

  onKey(e) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return this.keys.reset();
    if (document.querySelector("dialog[open]")) return this.keys.reset();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.model.redo();
      else this.model.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.model.redo();
    } else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      this.duplicateSelected();
    } else if (mod && e.key.toLowerCase() === "a") {
      if (isSelectTool(this.tool)) {
        e.preventDefault();
        this.selectAll();
      }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (this.sel || this.multi) {
        e.preventDefault();
        this.deleteSelected();
      }
    } else if (e.key === "F3") {
      e.preventDefault();
      this.aid.setConfig({ osnap: !this.aid.cfg.osnap });
    } else if (e.key === "F10") {
      e.preventDefault();
      this.aid.setConfig({ polar: !this.aid.cfg.polar });
    } else if (!mod && !e.altKey && !this.editingId && this.keys.feed(e.key)) {
      e.preventDefault();
    } else if (e.key === "Escape") {
      this.keys.reset();
      if (this.cmd) this.cancelCommand();
      else if (this.aid.pending) this.aid.cancelPending();
      else if (this.arc3) this.cancelArc3();
      else if (this.poly) this.cancelPolygon();
      else if (this.g) this.cancelGesture();
      else if (this.confirmCreated()) return;
      else if (this.sel || this.multi) this.setSelection(null);
      else if (this.tool !== "select") this.setTool("select");
    } else if (e.key === "Enter") {
      if (this.cmd && (this.cmd.name === "dimseries" || this.cmd.name === "dimpara")) {
        e.preventDefault();
        this.finishCommand();
      } else if (this.poly) {
        e.preventDefault();
        this.finishPolygon();
      } else if (this.sel) this.editSelectedText();
    } else if ((this.sel || this.multi) && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      this.updateSelected((s) => {
        s.pts = s.pts.map(([x, y]) => [x + dx, y + dy]);
      });
    }
  }

  /** 測定用: 選択図形の表示ラベル */
  labelOf(shape, page) {
    return labelFor(shape, page);
  }
  measureBetween(page, a, b) {
    return measureLen(a, b, page.scale);
  }
}

function shapeBoundsOf(pts, shape) {
  if (shape.type === "text") {
    const m = textMetrics(shape);
    return { x: pts[0][0], y: pts[0][1], w: m.w, h: m.h };
  }
  if (shape.type === "arc") return arcBounds(pts[0], pts[1], shape.sweep, arcLines(shape));
  return bbox(pts);
}
