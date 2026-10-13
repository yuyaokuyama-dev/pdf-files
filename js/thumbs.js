// ページ一覧(サムネイル): 並べ替え(ドラッグ/↑↓)・削除・回転・複数選択削除・ページ追加・
// ページの書き出し(画面外へドラッグ/チェックしたページ)。別PDFのドロップ挿入は app.js の wireDrop が受け持つ。
// Ctrl(Mac は ⌘)+クリックでチェックの付け外し、Shift+クリックで範囲をチェック。チェックしたページをドラッグすると、
// チェックしたページをまとめて動かす・書き出す。
// Chrome/Edge(PC)では、ドラッグしたページのPDFを先に作っておき(ページにマウスを乗せた時点で作り始める)、
// デスクトップやフォルダにドロップするとその場所に保存される(DownloadURL)。間に合わなかったとき・他のブラウザでは、
// 画面の外で離すと保存先を選んで保存する
import { icon } from "./icons.js";
import { renderShapes } from "./render.js";
import { confirmDialog, toast } from "./ui.js";

const TW = 128; // サムネイル幅(px)
const PAGE_MIME = "application/x-pdffiles-page"; // ページ一覧内のドラッグを他のドラッグ(ファイル等)と見分ける

export class Thumbs {
  constructor({ el, editor, getPdfPage, onAdd, onExport, makePdf, pdfKey }) {
    this.el = el;
    this.editor = editor;
    this.getPdfPage = getPdfPage;
    this.onAdd = onAdd;
    this.onExport = onExport; // (pageIds) そのページだけのPDFを作る
    this.makePdf = makePdf; // (pageIds) → {bytes, name} ドロップした場所に保存するPDF(画面表示なしで作る)
    this.pdfKey = pdfKey; // (pageIds) → 中身が変わると変わる文字列
    this.anchor = null; // Shift+クリックの範囲の起点
    this.ready = null; // 作り終えたPDF {key, name, url}
    this.making = null; // 作成中の key
    this.queued = null; // 作成中に頼まれた次のページ
    // ドロップした場所へ直接保存できるのは Chromium(Chrome/Edge)のPC版だけ
    this.canDropSave = !!(makePdf && navigator.userAgentData?.brands?.some((b) => /Chromium/.test(b.brand)) && !matchMedia("(pointer: coarse)").matches);
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
    let line = null; // 挿入線(初めてドラッグしたときに作る)
    let dragIds = null; // ページ一覧の中からドラッグ中のページ(チェックしたページをドラッグしたときは全部)
    let dropSave = null; // ドロップした場所へ保存するPDFの名前(DownloadURL を付けたとき)
    let lastOver = 0; // 最後に画面内で dragover を受けた時刻(画面外へのドロップ判定に使う)
    const hide = () => line && (line.hidden = true);
    document.addEventListener("dragover", () => (lastOver = Date.now()));

    // マウスを乗せたページ(またはチェックしたページ一式)のPDFを先に作っておく
    let hoverTimer = 0;
    this.el.addEventListener("pointerover", (e) => {
      const t = e.pointerType !== "touch" && e.target.closest?.(".thumb");
      clearTimeout(hoverTimer);
      if (t) hoverTimer = setTimeout(() => this.prepare(this.dragSet(t.dataset.id)), 200);
    });
    this.el.addEventListener("pointerdown", (e) => {
      const t = e.pointerType !== "touch" && e.button === 0 && e.target.closest?.(".thumb");
      if (t) this.prepare(this.dragSet(t.dataset.id));
    });

    this.el.addEventListener("dragstart", (e) => {
      const t = e.target.closest?.(".thumb");
      if (!t) return;
      dragIds = this.dragSet(t.dataset.id);
      dropSave = null;
      e.dataTransfer.setData(PAGE_MIME, dragIds.join(","));
      e.dataTransfer.effectAllowed = "copyMove";
      const r = this.ready;
      if (this.canDropSave && r && r.key === this.pdfKey(dragIds)) {
        e.dataTransfer.setData("DownloadURL", `application/pdf:${r.name}:${r.url}`);
        dropSave = r.name;
      }
      dragIds.forEach((id) => this.el.querySelector(`.thumb[data-id="${id}"]`)?.classList.add("dragging"));
    });
    this.el.addEventListener("dragend", (e) => {
      const ids = dragIds;
      const saved = dropSave;
      dragIds = dropSave = null;
      hide();
      this.el.querySelectorAll(".dragging").forEach((n) => n.classList.remove("dragging"));
      if (!ids) return;
      const effect = e.dataTransfer?.dropEffect;
      // デスクトップ・フォルダに落とした → ブラウザがその場所に保存した
      if (saved && effect === "copy") return toast(`「${saved}」をドロップした場所に保存しました`);
      if (effect !== "none") return;
      // ブラウザの画面の外で離した(その場所には保存できなかった) → 保存先を選んで保存
      // (画面内で離した・Escで取り消したときは何もしない)
      const { clientX: x, clientY: y } = e;
      const outside = x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight || (x === 0 && y === 0 && Date.now() - lastOver > 150);
      const live = ids.filter((id) => this.model.page(id));
      if (outside && live.length) this.onExport?.(live);
    });
    ["dragenter", "dragover"].forEach((type) => this.el.addEventListener(type, (e) => {
      if (!dragIds) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const slot = this.slot(e.clientY);
      if (!slot) return hide();
      if (!line) {
        line = document.createElement("div");
        line.className = "drop-line";
        document.body.appendChild(line);
      }
      Object.assign(line.style, { top: `${slot.y - 2}px`, left: `${slot.left}px`, width: `${slot.width}px` });
      line.hidden = false;
    }));
    this.el.addEventListener("dragleave", (e) => {
      if (!this.el.contains(e.relatedTarget)) hide();
    });
    this.el.addEventListener("drop", (e) => {
      hide();
      const ids = dragIds;
      if (!ids) return;
      e.preventDefault();
      dragIds = dropSave = null; // 並べ替えで一覧を作り直すと、元の要素に dragend が届かないことがある
      const slot = this.slot(e.clientY);
      // 挿入位置(ページの間)へ移動。複数ページは文書の順のまま、まとめてそこへ
      this.model.movePages(ids, slot ? slot.index : this.model.pages.length);
    });
  }

  /** ドラッグで運ぶページ: チェックしたページをドラッグしたらチェックしたページ全部(文書の順)、それ以外はそのページだけ */
  dragSet(id) {
    if (this.checked.has(id) && this.checked.size > 1) return this.model.pages.filter((p) => this.checked.has(p.id)).map((p) => p.id);
    return [id];
  }

  /** ドロップした場所へ保存するPDFを裏で作る。作成中に別のページを頼まれたら、終わってから最後の1件だけ作る */
  prepare(ids) {
    if (!this.canDropSave || !ids.length || ids.some((id) => !this.model.page(id))) return;
    const key = this.pdfKey(ids);
    if (this.ready?.key === key || this.making === key) return;
    if (this.making) return void (this.queued = ids);
    this.making = key;
    this.makePdf(ids)
      .then(({ bytes, name }) => {
        const old = this.ready?.url;
        if (old) setTimeout(() => URL.revokeObjectURL(old), 60_000); // ドロップ直後の保存が読み終わるまで残す
        this.ready = { key, name, url: URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })) };
      })
      .catch((e) => console.warn("prepare", e))
      .finally(() => {
        this.making = null;
        const q = this.queued;
        this.queued = null;
        if (q) this.prepare(q);
      });
  }

  /** ドロップ位置(サムネイルの間)。index: 挿入位置(0=先頭)、y: 線を出す画面Y */
  slot(clientY) {
    const els = [...this.el.querySelectorAll(".thumb")];
    if (!els.length) return null;
    let index = els.length;
    for (let i = 0; i < els.length; i++) {
      const r = els[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) {
        index = i;
        break;
      }
    }
    const a = index > 0 ? els[index - 1].getBoundingClientRect() : null;
    const b = index < els.length ? els[index].getBoundingClientRect() : null;
    const y = a && b ? (a.bottom + b.top) / 2 : b ? b.top - 5 : a.bottom + 5;
    const ref = b || a;
    return { index, y, left: ref.left, width: ref.width };
  }

  async onClick(e) {
    const bar = e.target.closest("[data-bar]");
    if (bar) {
      if (bar.dataset.bar === "add") return this.onAdd(bar);
      if (bar.dataset.bar === "del") return this.deleteChecked();
      if (bar.dataset.bar === "exp") {
        const ids = this.model.pages.filter((p) => this.checked.has(p.id)).map((p) => p.id);
        return ids.length ? this.onExport?.(ids) : toast("書き出すページにチェックを入れてください");
      }
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
      if (e.shiftKey && this.anchor) this.checkRange(this.anchor, id, cb.checked);
      else if (cb.checked) this.checked.add(id);
      else this.checked.delete(id);
      this.anchor = id;
      this.syncChecks();
      return;
    }
    if (e.target.closest(".tn label")) return; // 番号の文字 → チェックボックスのクリックとして届く
    const act = e.target.closest("button[data-act]")?.dataset.act;
    // Ctrl(⌘)+クリック: チェックの付け外し / Shift+クリック: 前にクリックしたページからここまでをチェック
    if (!act && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      if (e.shiftKey && this.anchor) this.checkRange(this.anchor, id, true);
      else if (this.checked.has(id)) this.checked.delete(id);
      else this.checked.add(id);
      this.anchor = id;
      this.syncChecks();
      return;
    }
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

  checkRange(fromId, toId, on) {
    let a = this.model.indexOf(fromId);
    let b = this.model.indexOf(toId);
    if (a < 0) a = b;
    if (a > b) [a, b] = [b, a];
    for (const p of this.model.pages.slice(a, b + 1)) {
      if (on) this.checked.add(p.id);
      else this.checked.delete(p.id);
    }
  }

  /** チェックの状態を画面(チェックボックス・枠の色)に反映 */
  syncChecks() {
    this.el.querySelectorAll(".thumb").forEach((t) => {
      const on = this.checked.has(t.dataset.id);
      t.classList.toggle("checked", on);
      const cb = t.querySelector("input[type=checkbox]");
      if (cb) cb.checked = on;
    });
    this.updateBar();
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
      <button class="btn" data-bar="all">全選択</button>
      <button class="btn" data-bar="exp" title="チェックしたページだけのPDFを作って保存先を選ぶ(Ctrl+クリックで複数選択・ページをデスクトップなどへドラッグしても保存できます)">${icon("download", 16)}書き出し</button></div>`;
    pages.forEach((p, i) => {
      const th = TW * (p.h / p.w);
      const d = document.createElement("div");
      d.className = this.checked.has(p.id) ? "thumb checked" : "thumb";
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
    const sig = JSON.stringify(p.shapes) + JSON.stringify(p.scale) + JSON.stringify(this.model.layers);
    if (this.sigs.get(p.id) === sig) return;
    this.sigs.set(p.id, sig);
    renderShapes(p.shapes, t.querySelector("svg"), { page: p, images: this.model.images, layers: this.model.layers });
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
          await pdfPage.render({ canvasContext: g, canvas: src, viewport: vp, optionalContentConfigPromise: pdfPage.pfOc }).promise;
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
