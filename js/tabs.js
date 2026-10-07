// 開いているファイルのタブ表示 / タブを外へドラッグして別ウィンドウで開く / ウィンドウ間の調整
import { esc } from "./ui.js";

const DRAG_START = 8;   // これ以上動いたらドラッグ開始(px)
const REORDER_BAND = 40; // タブバーの上下この範囲で離すと並べ替え(px)

/**
 * タブバー。ids と名前・表示中のファイルを受け取って描画し、操作はコールバックで返す。
 *  onSelect(id) / onClose(id) / onPopOut(id) / onReorder(ids)
 */
export class TabBar {
  constructor({ el, onSelect, onClose, onPopOut, onReorder }) {
    Object.assign(this, { el, onSelect, onClose, onPopOut, onReorder });
    this.ids = [];
    this.names = new Map();
    this.current = null;
    this.ghost = null;
    el.addEventListener("pointerdown", (e) => this.down(e));
    el.addEventListener("click", (e) => {
      if (this.suppressClick) return void (this.suppressClick = false);
      const x = e.target.closest("[data-close]");
      const t = e.target.closest(".tab");
      if (x) this.onClose(x.dataset.close);
      else if (t) this.onSelect(t.dataset.id);
    });
  }

  render({ ids, names, current }) {
    this.ids = ids.slice();
    if (names) this.names = names;
    this.current = current;
    this.el.innerHTML = this.ids
      .map((id) => {
        const name = this.names.get(id) || "無題.pdf";
        return `<div class="tab${id === current ? " on" : ""}" data-id="${id}" title="${esc(name)}\nタブを作業画面の外へドラッグすると別ウィンドウで開きます"><span class="tab-name">${esc(name)}</span><button type="button" class="tab-x" data-close="${id}" aria-label="閉じる" title="閉じる(履歴に残ります)">×</button></div>`;
      })
      .join("");
    this.el.hidden = this.ids.length < 2; // 1つだけなら画面を広く使う
    this.el.querySelector(".tab.on")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  down(e) {
    const tab = e.target.closest(".tab");
    if (!tab || e.target.closest("[data-close]") || e.button > 0) return;
    const id = tab.dataset.id;
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const move = (ev) => {
      if (!dragging) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
        dragging = true;
        tab.classList.add("dragging");
        this.startGhost(tab);
      }
      ev.preventDefault();
      const out = this.isOutside(ev);
      this.moveGhost(ev, out);
      if (!out && this.nearBar(ev)) this.markSlot(ev.clientX, id);
      else this.clearSlot();
    };
    const up = (ev) => {
      cleanup();
      if (!dragging) return;
      this.suppressClick = true;
      setTimeout(() => (this.suppressClick = false));
      tab.classList.remove("dragging");
      const out = this.isOutside(ev);
      const slot = this.slot;
      this.endGhost();
      this.clearSlot();
      if (ev.type === "pointercancel") return;
      if (out) this.onPopOut(id);
      else if (slot != null) {
        const ids = this.ids.filter((x) => x !== id);
        const at = Math.min(slot - (this.ids.indexOf(id) < slot ? 1 : 0), ids.length);
        ids.splice(at, 0, id);
        if (ids.join() !== this.ids.join()) this.onReorder(ids);
      }
    };
    const cleanup = () => {
      tab.removeEventListener("pointermove", move);
      tab.removeEventListener("pointerup", up);
      tab.removeEventListener("pointercancel", up);
    };
    // ポインタを捕まえておくと、ウィンドウの外までドラッグしても離した位置が分かる
    try { tab.setPointerCapture(e.pointerId); } catch { /* 古いブラウザ */ }
    tab.addEventListener("pointermove", move);
    tab.addEventListener("pointerup", up);
    tab.addEventListener("pointercancel", up);
  }

  /** 作業画面(このウィンドウ)の外で離したか */
  isOutside(ev) {
    return ev.clientX < 0 || ev.clientY < 0 || ev.clientX >= innerWidth || ev.clientY >= innerHeight;
  }
  /** タブバーの近く(並べ替えの対象範囲)か */
  nearBar(ev) {
    const r = this.el.getBoundingClientRect();
    return ev.clientY >= r.top - REORDER_BAND && ev.clientY <= r.bottom + REORDER_BAND;
  }

  startGhost(tab) {
    const g = document.createElement("div");
    g.className = "tab-ghost";
    g.innerHTML = `<span class="tab-name">${esc(tab.querySelector(".tab-name").textContent)}</span><span class="tab-ghost-hint">作業画面の外で離すと別ウィンドウで開きます</span>`;
    document.body.append(g);
    this.ghost = g;
  }
  moveGhost(ev, out) {
    const g = this.ghost;
    if (!g) return;
    g.style.left = `${ev.clientX + 12}px`;
    g.style.top = `${ev.clientY + 12}px`;
    g.classList.toggle("out", out);
  }
  endGhost() {
    this.ghost?.remove();
    this.ghost = null;
  }

  /** 並べ替え: 指の位置に挿入位置の印を出す */
  markSlot(clientX) {
    const tabs = [...this.el.querySelectorAll(".tab")];
    let slot = tabs.length;
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i].getBoundingClientRect();
      if (clientX < r.left + r.width / 2) { slot = i; break; }
    }
    this.slot = slot;
    tabs.forEach((t, i) => {
      t.classList.toggle("slot-before", i === slot);
      t.classList.toggle("slot-after", slot === tabs.length && i === tabs.length - 1);
    });
  }
  clearSlot() {
    this.slot = null;
    this.el.querySelectorAll(".slot-before, .slot-after").forEach((t) => t.classList.remove("slot-before", "slot-after"));
  }
}

/**
 * ウィンドウ間の調整(同じ端末・同じアカウントで開いている別ウィンドウ)。
 * 同じファイルを2つのウィンドウで同時に編集すると自動保存が上書きし合うため、
 * 「どのウィンドウがどのファイルを開いているか」を BroadcastChannel で共有する。
 */
export function createWindowSync({ user, winId, getIds, onRemoteChange, onFocusRequest }) {
  const remote = new Map(); // winId → Set(ids)
  const ch = typeof BroadcastChannel === "function" ? new BroadcastChannel(`apdf-win-${(user || "guest").toLowerCase()}`) : null;
  const post = (msg) => ch?.postMessage({ ...msg, win: winId });
  const announce = () => post({ t: "held", ids: getIds() });
  if (ch) {
    ch.onmessage = ({ data: m }) => {
      if (!m || m.win === winId) return;
      if (m.t === "hello") { announce(); return; }
      if (m.t === "held") { remote.set(m.win, new Set(m.ids)); onRemoteChange({ type: "held", win: m.win, ids: m.ids }); return; }
      if (m.t === "bye") { const ids = [...(remote.get(m.win) || [])]; remote.delete(m.win); onRemoteChange({ type: "bye", win: m.win, ids }); return; }
      if (m.t === "focus" && getIds().includes(m.id)) onFocusRequest(m.id);
    };
    window.addEventListener("pagehide", () => post({ t: "bye" }));
  }
  post({ t: "hello" });
  return {
    supported: !!ch,
    /** 他のウィンドウの返事を少し待つ(起動直後に、別ウィンドウで開いているファイルを開かないため) */
    ready: new Promise((r) => setTimeout(r, ch ? 200 : 0)),
    announce,
    heldElsewhere: (id) => [...remote.values()].some((s) => s.has(id)),
    requestFocus: (id) => post({ t: "focus", id }),
  };
}

/** 別ウィンドウの位置: 画面の右半分(元のウィンドウと左右に並べやすい) */
export function sideBySideFeatures() {
  const sw = screen.availWidth || innerWidth;
  const sh = screen.availHeight || innerHeight;
  const sl = screen.availLeft ?? 0;
  const st = screen.availTop ?? 0;
  const w = Math.max(480, Math.floor(sw / 2));
  return `popup=yes,width=${w},height=${sh},left=${sl + sw - w},top=${st}`;
}
