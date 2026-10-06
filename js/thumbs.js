// ページ一覧(サムネイル): 並べ替え(ドラッグ/↑↓)・削除・回転・複数選択削除・ページ追加
import { icon } from "./icons.js";
import { renderShapes } from "./render.js";
import { confirmDialog, toast } from "./ui.js";

const TW = 128; // サムネイル幅(px)

export class Thumbs {
  constructor({ el, editor, getPdfPage, onAdd }) {
    this.el = el;
    this.editor = editor;
    this.getPdfPage = getPdfPage;
    this.onAdd = onAdd;
    this.cache = new Map();
    this.checked = new Set();
    this.key = "";
    this.sigs = new Map();
    this.io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && this.renderCanvas(e.target)), { root: el, rootMargin: "300px" });
    editor.on("pages", () => this.refresh(true));
    editor.on("page", (id) => this.setCurrent(id));
    this.attach();
  }

  get model() {
    return this.editor.model;
  }

  attach() {
    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("dragstart", (e) => {
      const t = e.target.closest?.(".thumb");
      if (!t) return;
      e.dataTransfer.setData("text/plain", t.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });
    this.el.addEventListener("dragover", (e) => {
      const t = e.target.closest?.(".thumb");
      if (!t) return;
      e.preventDefault();
      this.el.querySelectorAll(".dragover").forEach((n) => n.classList.remove("dragover"));
      t.classList.add("dragover");
    });
    this.el.addEventListener("dragleave", (e) => e.target.closest?.(".thumb")?.classList.remove("dragover"));
    this.el.addEventListener("drop", (e) => {
      const t = e.target.closest?.(".thumb");
      this.el.querySelectorAll(".dragover").forEach((n) => n.classList.remove("dragover"));
      if (!t) return;
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      const to = this.model.indexOf(t.dataset.id);
      if (id && to >= 0) this.model.movePage(id, to);
    });
  }

  async onClick(e) {
    const bar = e.target.closest("[data-bar]");
    if (bar) {
      if (bar.dataset.bar === "add") return this.onAdd(bar);
      if (bar.dataset.bar === "del") return this.deleteChecked();
      if (bar.dataset.bar === "all") {
        if (this.checked.size === this.model.pages.length) this.checked.clear();
        else this.model.pages.forEach((p) => this.checked.add(p.id));
        return this.refresh(true);
      }
      return;
    }
    const t = e.target.closest(".thumb");
    if (!t) return;
    const id = t.dataset.id;
    const cb = e.target.closest("input[type=checkbox]");
    if (cb) {
      if (cb.checked) this.checked.add(id);
      else this.checked.delete(id);
      this.updateBar();
      return;
    }
    const act = e.target.closest("button[data-act]")?.dataset.act;
    const i = this.model.indexOf(id);
    if (act === "up") this.model.movePage(id, i - 1);
    else if (act === "down") this.model.movePage(id, i + 1);
    else if (act === "rot") this.model.rotatePage(id, 90);
    else if (act === "del") {
      if (this.model.pages.length <= 1) return toast("最後の1ページは削除できません", { error: true });
      if (await confirmDialog(`${i + 1} ページ目を削除しますか?`, { ok: "削除", danger: true })) this.model.deletePages([id]);
    } else if (!act) this.editor.scrollToPage(id);
  }

  async deleteChecked() {
    const ids = [...this.checked].filter((id) => this.model.page(id));
    if (!ids.length) return toast("削除するページにチェックを入れてください");
    if (ids.length >= this.model.pages.length) return toast("すべてのページは削除できません", { error: true });
    if (await confirmDialog(`${ids.length} ページを削除しますか?`, { ok: "削除", danger: true })) {
      this.checked.clear();
      this.model.deletePages(ids);
    }
  }

  updateBar() {
    const b = this.el.querySelector('[data-bar="del"]');
    if (b) b.textContent = this.checked.size ? `削除(${this.checked.size})` : "削除";
  }

  setCurrent(id) {
    this.el.querySelectorAll(".thumb").forEach((t) => t.classList.toggle("cur", t.dataset.id === id));
    this.el.querySelector(".thumb.cur")?.scrollIntoView({ block: "nearest" });
  }

  refresh(force = false) {
    if (this.el.hidden) return;
    const pages = this.model.pages;
    const key = pages.map((p) => `${p.id}:${p.rot}:${p.w}:${p.h}`).join("|");
    if (!force && key === this.key) {
      for (const p of pages) this.updateOverlay(p);
      return;
    }
    this.key = key;
    this.io.disconnect();
    for (const id of [...this.checked]) if (!this.model.page(id)) this.checked.delete(id);
    this.el.innerHTML = `<div class="thumb-bar">
      <button class="btn" data-bar="add">${icon("plus", 16)}追加</button>
      <button class="btn danger" data-bar="del">削除</button>
      <button class="btn" data-bar="all">全選択</button></div>`;
    pages.forEach((p, i) => {
      const th = TW * (p.h / p.w);
      const d = document.createElement("div");
      d.className = "thumb";
      d.dataset.id = p.id;
      d.draggable = true;
      d.innerHTML = `<div class="tv" style="width:${TW}px;height:${th}px"><canvas></canvas><svg viewBox="0 0 ${p.w} ${p.h}" preserveAspectRatio="none"></svg></div>
        <div class="tn"><label><input type="checkbox"${this.checked.has(p.id) ? " checked" : ""}> ${i + 1}</label></div>
        <div class="ta">
          <button data-act="up" title="前へ" aria-label="前へ">${icon("up", 16)}</button>
          <button data-act="down" title="後ろへ" aria-label="後ろへ">${icon("down", 16)}</button>
          <button data-act="rot" title="回転" aria-label="回転">${icon("rotate", 16)}</button>
          <button data-act="del" title="削除" aria-label="削除">${icon("trash", 16)}</button>
        </div>`;
      this.el.appendChild(d);
      this.io.observe(d);
      this.sigs.delete(p.id);
      this.updateOverlay(p);
    });
    this.updateBar();
    this.setCurrent(this.editor.curPageId);
  }

  updateOverlay(p) {
    const t = this.el.querySelector(`.thumb[data-id="${p.id}"]`);
    if (!t) return;
    const sig = JSON.stringify(p.shapes) + JSON.stringify(p.scale);
    if (this.sigs.get(p.id) === sig) return;
    this.sigs.set(p.id, sig);
    renderShapes(p.shapes, t.querySelector("svg"), { page: p, images: this.model.images });
    t.querySelectorAll("svg .hit").forEach((n) => n.remove());
  }

  async renderCanvas(div) {
    const id = div.dataset.id;
    const p = this.model.page(id);
    if (!p) return;
    const canvas = div.querySelector("canvas");
    const key = `${p.srcId}:${p.srcIndex}:${p.rot}`;
    let src = this.cache.get(key);
    if (!src) {
      const scale = (TW * Math.min(2, window.devicePixelRatio || 1)) / p.w;
      src = document.createElement("canvas");
      src.width = Math.max(1, Math.round(p.w * scale));
      src.height = Math.max(1, Math.round(p.h * scale));
      const g = src.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, src.width, src.height);
      try {
        const pdfPage = await this.getPdfPage(p);
        if (pdfPage) {
          const vp = pdfPage.getViewport({ scale, rotation: ((p.baseRot || 0) + p.rot) % 360 });
          await pdfPage.render({ canvasContext: g, canvas: src, viewport: vp }).promise;
        }
      } catch (e) {
        console.warn("thumb", e);
      }
      this.cache.set(key, src);
    }
    canvas.width = src.width;
    canvas.height = src.height;
    canvas.getContext("2d").drawImage(src, 0, 0);
  }

  /** 履歴用の小さなプレビュー(1ページ目)。無ければ null */
  firstThumbDataUrl() {
    const first = this.model.pages[0];
    if (!first) return null;
    const c = this.cache.get(`${first.srcId}:${first.srcIndex}:${first.rot}`);
    if (!c) return null;
    const k = 120 / c.width;
    const o = document.createElement("canvas");
    o.width = 120;
    o.height = Math.round(c.height * k);
    o.getContext("2d").drawImage(c, 0, 0, o.width, o.height);
    return o.toDataURL("image/jpeg", 0.6);
  }
}
