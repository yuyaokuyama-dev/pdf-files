// 「コピーしたもの」の小さな一覧。最後にコピーしたものを表示し、チェックを入れたものは候補として残る。
// 候補をクリックで選んでから、ページの貼りたい位置をクリックすると、スタンプのように何度でも貼れる。
import { renderShapes } from "./render.js";
import { icon } from "./icons.js";

const NS = "http://www.w3.org/2000/svg";
const MAX_KEEP = 40;

export class ClipTray {
  /**
   * @param {object} o
   * @param {HTMLElement} o.el
   * @param {import('./editor.js').Editor} o.editor
   * @param {()=>Promise<any[]>} o.load 残した候補を読む
   * @param {(clips:any[])=>Promise<void>} o.save 残した候補を書く
   */
  constructor({ el, editor, load, save }) {
    Object.assign(this, { el, editor, load, save });
    this.kept = [];
    this.latest = null;
    this.closed = true;
    editor.on("copied", (clip) => {
      this.latest = clip;
      this.closed = false;
      this.render();
    });
    editor.on("tool", () => this.render());
    el.addEventListener("change", (e) => this.onChange(e));
    el.addEventListener("click", (e) => this.onClick(e));
  }

  async init() {
    try {
      this.kept = (await this.load()) || [];
    } catch {
      this.kept = [];
    }
    this.closed = !this.kept.length;
    this.render();
  }

  /** 表示する一覧: 最後にコピーしたもの(まだ残していなければ)+残した候補(新しい順) */
  items() {
    const l = this.latest && !this.kept.some((k) => k.id === this.latest.id) ? [this.latest] : [];
    return [...l, ...this.kept];
  }
  find(id) {
    return this.items().find((c) => c.id === id);
  }

  async persist() {
    try {
      await this.save(this.kept);
    } catch (e) {
      console.warn("clips save", e);
    }
  }

  onChange(e) {
    const cb = e.target.closest("[data-keep]");
    if (!cb) return;
    const id = cb.dataset.keep;
    if (cb.checked) {
      const c = this.find(id);
      if (c && !this.kept.some((k) => k.id === id)) this.kept = [c, ...this.kept].slice(0, MAX_KEEP);
    } else {
      this.kept = this.kept.filter((k) => k.id !== id);
      // 候補から外したものでスタンプ中なら終える
      if (this.editor.tool === "clip" && this.editor.pendingClip?.id === id && this.latest?.id !== id) this.editor.setTool("select");
    }
    this.persist();
    this.render();
  }

  onClick(e) {
    if (e.target.closest("[data-keep], label")) return;
    if (e.target.closest("[data-act=close]")) {
      this.closed = true;
      if (this.editor.tool === "clip") this.editor.setTool("select");
      return this.render();
    }
    const it = e.target.closest(".clip-item");
    if (!it) return;
    const ed = this.editor;
    if (ed.tool === "clip" && ed.pendingClip?.id === it.dataset.id) return ed.setTool("select"); // もう一度押すと終了
    const c = this.find(it.dataset.id);
    if (!c) return;
    ed.setTool("clip");
    ed.pendingClip = c;
    this.render();
  }

  thumb(clip) {
    const pad = Math.max(clip.box.w, clip.box.h) * 0.06 + 2;
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `${clip.box.x - pad} ${clip.box.y - pad} ${clip.box.w + pad * 2} ${clip.box.h + pad * 2}`);
    const g = document.createElementNS(NS, "g");
    svg.appendChild(g);
    renderShapes(clip.shapes, g, { page: { w: 1e5, h: 1e5, scale: clip.scale }, images: new Map(Object.entries(clip.images || {})) });
    svg.querySelectorAll(".hit").forEach((n) => n.remove());
    return svg;
  }

  render() {
    const list = this.items();
    this.el.hidden = this.closed || !list.length;
    if (this.el.hidden) return void this.el.replaceChildren();
    const ed = this.editor;
    const cur = ed.tool === "clip" ? ed.pendingClip?.id : null;
    this.el.innerHTML = `<div class="clips-head"><b>コピーしたもの</b><span class="hint">チェックで候補に残す・選んでから貼りたい所をクリック</span><button class="btn icon" data-act="close" aria-label="閉じる">${icon("x", 14)}</button></div><div class="clips-list"></div>`;
    const box = this.el.querySelector(".clips-list");
    for (const c of list) {
      const kept = this.kept.some((k) => k.id === c.id);
      const it = document.createElement("div");
      it.className = `clip-item${c.id === cur ? " on" : ""}`;
      it.dataset.id = c.id;
      it.title = `${c.shapes.length}個。クリックで選んでから、貼りたい位置をクリック`;
      const th = document.createElement("div");
      th.className = "clip-thumb";
      th.appendChild(this.thumb(c));
      const lb = document.createElement("label");
      lb.className = "clip-keep";
      lb.innerHTML = `<input type="checkbox" data-keep="${c.id}"${kept ? " checked" : ""}> 候補`;
      it.append(th, lb);
      box.appendChild(it);
    }
  }
}
