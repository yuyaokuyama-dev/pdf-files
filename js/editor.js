// エディタ本体: ページ表示・ズーム・描画ツール・選択/移動/頂点編集・テキスト編集
import {
  dist, mid, rectPoints, distToSegment, createPenFilter, measure as measureLen, bbox, dimensionGeometry, simplify,
} from "./geometry.js";
import { renderShape, renderShapes, shapeBounds, shapeVertices, textMetrics, fontCss, labelFor } from "./render.js";

const NS = "http://www.w3.org/2000/svg";
const DRAW_TOOLS = new Set(["pen", "line", "arrow", "rect", "ellipse", "cloud", "polygon", "text", "dim", "calib", "measure", "sign", "stamp"]);
const LINE_TOOLS = new Set(["line", "arrow", "dim", "calib", "measure"]);
const MAX_PIXELS = 16_000_000;

export const isDrawTool = (t) => DRAW_TOOLS.has(t);

const sv = (name, attrs = {}) => {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

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
    this.loadDefaults();
    this.pendingStamp = null;
    this.sel = null;
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

    viewer.addEventListener("scroll", () => this.updateCurrentPage(), { passive: true });
    viewer.addEventListener("pointerdown", (e) => this.onViewerPointerDown(e), true);
    viewer.addEventListener("pointermove", (e) => this.onViewerPointerMove(e), true);
    viewer.addEventListener("pointerup", (e) => this.onViewerPointerEnd(e), true);
    viewer.addEventListener("pointercancel", (e) => this.onViewerPointerEnd(e), true);
    viewer.addEventListener("wheel", (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      this.zoomAt(this.zoom * Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    }, { passive: false });
    document.addEventListener("keydown", (e) => this.onKey(e));
    new ResizeObserver(() => this.updateCurrentPage()).observe(viewer);
    this.unsub = model.onChange((k) => this.sync(k));
  }

  /** 別のドキュメントに切り替える */
  setModel(model) {
    this.cancelGesture();
    this.cancelPolygon();
    if (this.editing) this.finishTextEdit(true);
    this.unsub?.();
    this.model = model;
    this.unsub = model.onChange((k) => this.sync(k));
    this.sel = null;
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
      if (this.sel && !this.model.findShape(this.sel.shapeId)) this.sel = null;
      this.rebuildPages();
      return;
    }
    for (const p of this.model.pages) this.refreshLayer(p);
    if (this.sel && !this.model.findShape(this.sel.shapeId)) this.setSelection(null);
    else this.renderSelection();
    if (kind === "restore") this.emit("selection", this.sel);
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
    const sig = JSON.stringify(page.shapes) + JSON.stringify(page.scale);
    if (!force && this.sigs.get(page.id) === sig) return;
    this.sigs.set(page.id, sig);
    renderShapes(page.shapes, el.layer, { page, images: this.model.images, exclude: this.editingId });
  }

  async renderCanvas(id) {
    const page = this.model.page(id);
    const el = this.els.get(id);
    if (!page || !el) return;
    const want = this.zoom * this.dpr;
    if (el.renderedScale && Math.abs(el.renderedScale - want) < 0.001) return;
    const token = ++el.token;
    el.task?.cancel?.();
    let pdfPage = null;
    try {
      pdfPage = await this.getPdfPage(page);
    } catch (e) {
      console.warn(e);
    }
    if (token !== el.token) return;
    let scale = want;
    if (page.w * page.h * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (page.w * page.h));
    const w = Math.max(1, Math.round(page.w * scale));
    const h = Math.max(1, Math.round(page.h * scale));
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const g = tmp.getContext("2d");
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
    if (pdfPage) {
      const vp = pdfPage.getViewport({ scale: w / page.w, rotation: ((page.baseRot || 0) + page.rot) % 360 });
      const task = pdfPage.render({ canvasContext: g, canvas: tmp, viewport: vp });
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
    delete el.wrap.dataset.rendered;
  }

  /* ---------- ズーム ---------- */
  setZoom(z, { render = true } = {}) {
    z = Math.max(0.2, Math.min(6, z));
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
    const r = this.viewer.getBoundingClientRect();
    const px = cx - r.left;
    const py = cy - r.top;
    const k = Math.max(0.2, Math.min(6, z)) / this.zoom;
    const ax = this.viewer.scrollLeft + px;
    const ay = this.viewer.scrollTop + py;
    this.setZoom(z);
    this.viewer.scrollLeft = ax * k - px;
    this.viewer.scrollTop = ay * k - py;
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
    this.cancelGesture();
    this.tool = t;
    for (const el of this.els.values()) this.applyToolClass(el);
    if (t !== "select") this.setSelection(null);
    this.emit("tool", t);
  }
  applyToolClass(el) {
    const t = this.tool;
    const cls = t === "select" ? "t-select" : t === "hand" ? "t-hand" : this.palm ? "t-palm" : "t-draw";
    el.svg.setAttribute("class", `overlay ${cls}`);
  }
  setPalm(on) {
    this.palm = !!on;
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
  onViewerPointerDown(e) {
    if (e.pointerType !== "touch") return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      this.cancelGesture();
      const [a, b] = [...this.touches.values()];
      this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: this.zoom, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ax: 0, ay: 0 };
      const r = this.viewer.getBoundingClientRect();
      this.pinch.ax = (this.viewer.scrollLeft + this.pinch.m0.x - r.left) / this.zoom;
      this.pinch.ay = (this.viewer.scrollTop + this.pinch.m0.y - r.top) / this.zoom;
    }
  }
  onViewerPointerMove(e) {
    if (e.pointerType !== "touch" || !this.touches.has(e.pointerId)) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = Math.max(0.2, Math.min(6, this.pinch.z0 * (d / this.pinch.d0)));
      const r = this.viewer.getBoundingClientRect();
      this.setZoom(z);
      this.viewer.scrollLeft = this.pinch.ax * z - (m.x - r.left);
      this.viewer.scrollTop = this.pinch.ay * z - (m.y - r.top);
      e.preventDefault();
    }
  }
  onViewerPointerEnd(e) {
    if (e.pointerType !== "touch") return;
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
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
    if (this.palm && e.pointerType === "touch" && tool !== "select") return;
    const el = this.els.get(pageId);
    const p = this.pt(e, pageId);

    if (tool === "select") return this.selectDown(e, pageId, p);
    e.preventDefault();

    if (tool === "polygon") return this.polygonDown(e, pageId, p);
    if (tool === "text") return this.beginText(pageId, p);
    if (tool === "stamp") return this.placeStamp(pageId, p);

    // ドラッグ系の作成ツール
    const start = this.clampToPage(p, pageId);
    this.g = { kind: "create", tool, pageId, p0: start, pts: [start], id: e.pointerId, filter: createPenFilter() };
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

  cancelGesture() {
    const g = this.g;
    if (!g) return;
    g.cleanup?.();
    if (g.kind === "move" || g.kind === "handle") {
      // 途中までの変更を元に戻す
      if (g.before) {
        const pages = JSON.parse(g.before);
        this.model.pages = pages;
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
  snapPoint(p0, p, ev) {
    let [x, y] = p;
    const dx = x - p0[0];
    const dy = y - p0[1];
    const L = Math.hypot(dx, dy);
    if (L < 4) return p;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    const step = ev?.shiftKey ? 45 : 45;
    const nearest = Math.round(ang / step) * step;
    const tol = ev?.shiftKey ? 180 : 3; // Shift: 強制スナップ / 通常: 3度以内で吸着
    if (Math.abs(ang - nearest) <= tol) {
      const r = (nearest * Math.PI) / 180;
      return [p0[0] + Math.cos(r) * L, p0[1] + Math.sin(r) * L];
    }
    return p;
  }

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
      if (LINE_TOOLS.has(g.tool)) p = this.snapPoint(g.p0, p, ev);
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
      case "line":
      case "arrow":
      case "rect":
      case "ellipse":
        return g.p1 ? { ...base, type: g.tool, pts: [g.p0, g.p1] } : null;
      case "cloud":
        return g.p1 ? { ...base, type: "cloud", pts: rectPoints(g.p0, g.p1), pitch: this.cloudPitch } : null;
      case "dim":
        return g.p1 ? { ...base, type: "dim", pts: [g.p0, g.p1], off: 24, size: this.dimSize, text: "" } : null;
      case "calib":
        return g.p1 ? { ...base, type: "dim", style: { ...style, color: "#2563eb", dash: true }, pts: [g.p0, g.p1], off: 24, size: this.dimSize, text: "?" } : null;
      case "measure":
        return g.p1 ? { ...base, type: "measure", pts: [g.p0, g.p1], size: this.dimSize } : null;
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
    if (small && tool !== "calib") return;
    if (small) return;
    switch (tool) {
      case "line":
      case "arrow":
        this.addAndSelect(pageId, { type: tool, pts: [g.p0, p1], style: { ...this.style } });
        break;
      case "rect":
      case "ellipse":
        this.addAndSelect(pageId, { type: tool, pts: [g.p0, p1], style: { ...this.style } });
        break;
      case "cloud":
        this.addAndSelect(pageId, { type: "cloud", pts: rectPoints(g.p0, p1), pitch: this.cloudPitch, style: { ...this.style } });
        break;
      case "dim":
        this.emit("dim-request", {
          pageId,
          create: (text) => this.addAndSelect(pageId, { type: "dim", pts: [g.p0, p1], off: 24, size: this.dimSize, text, style: { ...this.style, width: Math.min(this.style.width, 2) } }),
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
        this.addAndSelect(pageId, { type: "measure", pts: [g.p0, p1], size: this.dimSize, style: { ...this.style, color: "#059669", width: 2 } }, false);
        break;
      default:
        break;
    }
  }

  addAndSelect(pageId, shape, select = true) {
    const s = this.model.addShape(pageId, shape);
    if (select && s) {
      this.tool = "select";
      for (const el of this.els.values()) this.applyToolClass(el);
      this.emit("tool", "select");
      this.setSelection({ pageId, shapeId: s.id });
    }
    return s;
  }

  /* ---------- 多角形 ---------- */
  polygonDown(e, pageId, p) {
    p = this.clampToPage(p, pageId);
    const dbl = this.isDoubleTap(e, "polygon");
    if (!this.poly || this.poly.pageId !== pageId) {
      this.cancelPolygon();
      this.poly = { pageId, pts: [], hover: null };
      this.polyMoveFn = (ev) => {
        if (!this.poly) return;
        this.poly.hover = this.clampToPage(this.pt(ev, this.poly.pageId), this.poly.pageId);
        this.drawPolygonDraft();
      };
      this.els.get(pageId).svg.addEventListener("pointermove", this.polyMoveFn);
    }
    const pts = this.poly.pts;
    const first = pts[0];
    const closeR = 12 / this.zoom;
    if (pts.length >= 3 && (dbl || dist(p, first) < closeR)) return this.finishPolygon();
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
    if (pts.length > 1) {
      renderShape({ id: "draft", type: "polygon", pts, style: { ...this.style, fill: "none" } }, el.draft, {});
      el.draft.querySelectorAll(".hit").forEach((n) => n.remove());
      // 最後の辺(戻る線)は点線で表現するため、開いた線として上書き
      const open = renderShape({ id: "draft2", type: "line", pts, style: { ...this.style } }, el.draft, {});
      open.querySelectorAll(".hit").forEach((n) => n.remove());
    }
    const r = 5 / this.zoom;
    poly.pts.forEach((q, i) => el.draft.appendChild(sv("circle", { cx: q[0], cy: q[1], r: i === 0 ? r * 1.5 : r, fill: i === 0 ? "#2563eb" : "#fff", stroke: "#2563eb", "stroke-width": 1.5 / this.zoom })));
  }
  finishPolygon() {
    const poly = this.poly;
    if (!poly) return;
    if (poly.pts.length < 3) return this.cancelPolygon();
    const { pageId } = poly;
    const pts = poly.pts.slice();
    this.lastTap = { t: 0, x: 0, y: 0, key: null };
    this.cancelPolygon();
    this.addAndSelect(pageId, { type: "polygon", pts, style: { ...this.style } });
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
        this.tool = "select";
        for (const el of this.els.values()) this.applyToolClass(el);
        this.emit("tool", "select");
        this.setSelection({ pageId: ed.pageId, shapeId: ed.shape.id });
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
    const w = 64;
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
    const el = this.els.get(pageId);
    const t = e.target;
    const handle = t.closest?.(".handle");
    const shEl = t.closest?.(".shape");
    const dbl = this.isDoubleTap(e, handle ? `h:${this.sel?.shapeId}:${handle.dataset.kind}:${handle.dataset.idx}` : shEl ? `s:${shEl.dataset.id}` : "empty");
    if (handle && this.sel) {
      e.preventDefault();
      if (dbl && handle.dataset.kind === "v") return this.removeVertex(+handle.dataset.idx);
      if (dbl && handle.dataset.kind === "off") {
        const f = this.model.findShape(this.sel.shapeId);
        if (f) return this.emit("dim-edit", { pageId: f.page.id, shape: f.shape });
      }
      return this.beginHandleDrag(e, pageId, handle);
    }
    if (!shEl) {
      if (this.sel) this.setSelection(null);
      return;
    }
    e.preventDefault();
    const id = shEl.dataset.id;
    const page = this.model.page(pageId);
    const shape = page.shapes.find((s) => s.id === id);
    if (!shape) return;
    if (dbl) {
      if (shape.type === "text") return this.editText(pageId, shape, false);
      if (shape.type === "dim") return this.emit("dim-edit", { pageId, shape });
      if (shape.type === "polygon" || shape.type === "cloud") return this.insertVertex(pageId, shape, p);
    }
    if (!this.sel || this.sel.shapeId !== id) this.setSelection({ pageId, shapeId: id });
    this.beginMove(e, pageId, shape, p);
  }

  beginMove(e, pageId, shape, p0) {
    const el = this.els.get(pageId);
    const origin = clone(shape.pts);
    this.g = { kind: "move", pageId, id: e.pointerId, before: this.model.snapshot(), moved: false };
    el.svg.setPointerCapture?.(e.pointerId);
    const page = this.model.page(pageId);
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      const q = this.pt(ev, pageId);
      let dx = q[0] - p0[0];
      let dy = q[1] - p0[1];
      if (!this.g.moved && Math.hypot(dx, dy) * this.zoom < 3) return;
      this.g.moved = true;
      // ページ外へ出過ぎないようにする
      const b = shapeBoundsOf(origin, shape);
      dx = Math.max(-b.x - b.w + 8, Math.min(page.w - b.x - 8, dx));
      dy = Math.max(-b.y - b.h + 8, Math.min(page.h - b.y - 8, dy));
      shape.pts = origin.map(([x, y]) => [x + dx, y + dy]);
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
    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      this.g.moved = true;
      let q = this.clampToPage(this.pt(ev, pageId), pageId);
      if (kind === "off") {
        const [a, b] = shape.pts;
        const L = dist(a, b) || 1;
        const nx = -(b[1] - a[1]) / L;
        const ny = (b[0] - a[0]) / L;
        const m = mid(a, b);
        shape.off = (q[0] - m[0]) * nx + (q[1] - m[1]) * ny;
      } else if (corners) {
        const opp = startCorners[(idx + 2) % 4];
        if (shape.type === "image" && shape.aspect) {
          const w = Math.max(6, Math.abs(q[0] - opp[0]));
          const sx = Math.sign(q[0] - opp[0]) || 1;
          const sy = Math.sign(q[1] - opp[1]) || 1;
          q = [opp[0] + sx * w, opp[1] + (sy * w) / shape.aspect];
        } else if (ev.shiftKey && shape.type !== "image") {
          const s = Math.max(Math.abs(q[0] - opp[0]), Math.abs(q[1] - opp[1]));
          q = [opp[0] + Math.sign(q[0] - opp[0] || 1) * s, opp[1] + Math.sign(q[1] - opp[1] || 1) * s];
        }
        shape.pts = [opp, q];
      } else {
        const others = shape.pts.filter((_, i) => i !== idx);
        if ((shape.type === "line" || shape.type === "arrow" || shape.type === "dim" || shape.type === "measure") && others.length === 1) q = this.snapPoint(others[0], q, ev);
        shape.pts[idx] = q;
      }
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

  insertVertex(pageId, shape, p) {
    const pts = shape.pts;
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < pts.length; i++) {
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
    if ((s.type === "polygon" || s.type === "cloud") && s.pts.length > 3) {
      this.model.mutate(() => s.pts.splice(idx, 1));
    }
  }

  setSelection(sel) {
    const same = (!sel && !this.sel) || (sel && this.sel && sel.shapeId === this.sel.shapeId);
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
      if (d.cloudPitch) this.cloudPitch = d.cloudPitch;
    } catch {
      /* 破損していたら既定のまま */
    }
  }
  saveDefaults() {
    try {
      localStorage.setItem("apdf_defaults_v1", JSON.stringify({ style: this.style, textStyle: this.textStyle, dimSize: this.dimSize, cloudPitch: this.cloudPitch }));
    } catch {
      /* 保存できなくてもこのセッションでは有効 */
    }
  }
  /** 選択中の図形の線・色・文字の設定を、新規作成時の初期設定にする */
  setDefaultsFrom(sh) {
    const st = sh.style || {};
    if (sh.type !== "text") for (const k of ["color", "width", "fill", "fillOpacity", "dash", "opacity"]) if (st[k] !== undefined) this.style[k] = st[k];
    if (sh.type === "text") Object.assign(this.textStyle, { size: sh.size, font: sh.font || "gothic", bold: !!sh.bold, color: sh.color || st.color });
    if (sh.type === "dim" || sh.type === "measure") this.dimSize = sh.size;
    if (sh.type === "cloud" && sh.pitch) this.cloudPitch = sh.pitch;
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
    if (!this.sel || this.tool !== "select") return;
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
    const verts = shapeVertices(sh);
    verts.forEach((v, i) => {
      const c = sv("circle", { class: "handle", cx: v[0], cy: v[1], r: R, "stroke-width": 1.6 / z, "data-kind": "v", "data-idx": i });
      el.ui.appendChild(c);
    });
    if (sh.type === "dim") {
      const g = dimensionGeometry(sh.pts[0], sh.pts[1], sh.off ?? 24, sh.size || 12);
      const m = mid(g.line[0], g.line[1]);
      el.ui.appendChild(sv("rect", { class: "handle mid", x: m[0] - R, y: m[1] - R, width: R * 2, height: R * 2, rx: R / 3, "stroke-width": 1.6 / z, "data-kind": "off", "data-idx": 0 }));
    }
  }

  /* =========================================================
   * 編集操作(プロパティ・削除など)
   * ======================================================= */
  /** 選択中の図形を変更。live=true の間は履歴に積まず、commitLive() でまとめて確定 */
  updateSelected(fn, { live = false } = {}) {
    const f = this.sel && this.model.findShape(this.sel.shapeId);
    if (!f) return;
    if (live) {
      if (!this.liveBefore) this.liveBefore = this.model.snapshot();
      fn(f.shape, f.page);
      this.refreshLayer(f.page);
      this.renderSelection();
    } else {
      this.model.mutate(() => fn(f.shape, f.page));
    }
  }
  commitLive() {
    if (!this.liveBefore) return;
    const b = this.liveBefore;
    this.liveBefore = null;
    this.model.commit(b);
  }
  deleteSelected() {
    if (!this.sel) return;
    const { pageId, shapeId } = this.sel;
    this.sel = null;
    this.model.removeShape(pageId, shapeId);
    this.renderSelection();
    this.emit("selection", null);
  }
  duplicateSelected() {
    const f = this.sel && this.model.findShape(this.sel.shapeId);
    if (!f) return;
    const c = clone(f.shape);
    c.id = "h" + uid();
    c.pts = c.pts.map(([x, y]) => [x + 14, y + 14]);
    this.model.addShape(f.page.id, c);
    this.setSelection({ pageId: f.page.id, shapeId: c.id });
  }
  reorderSelected(toFront) {
    const f = this.sel && this.model.findShape(this.sel.shapeId);
    if (!f) return;
    this.model.mutate(() => {
      const arr = f.page.shapes;
      const i = arr.indexOf(f.shape);
      arr.splice(i, 1);
      if (toFront) arr.push(f.shape);
      else arr.unshift(f.shape);
    });
  }
  editSelectedText() {
    const f = this.sel && this.model.findShape(this.sel.shapeId);
    if (f?.shape.type === "text") this.editText(f.page.id, f.shape, false);
  }

  onKey(e) {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable) return;
    if (document.querySelector("dialog[open]")) return;
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
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (this.sel) {
        e.preventDefault();
        this.deleteSelected();
      }
    } else if (e.key === "Escape") {
      if (this.poly) this.cancelPolygon();
      else if (this.g) this.cancelGesture();
      else if (this.sel) this.setSelection(null);
      else if (this.tool !== "select") this.setTool("select");
    } else if (e.key === "Enter") {
      if (this.poly) {
        e.preventDefault();
        this.finishPolygon();
      } else if (this.sel) this.editSelectedText();
    } else if (this.sel && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
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
  return bbox(pts);
}
