// ツールバー: 「基本パレット」(よく使う機能)と、機能をまとめたグループ。
// グループのボタンを押すと展開され、そこから基本パレットへドラッグして入れる/基本パレットから外へドラッグして外せる。

/** グループ(案B): 作図 / 寸法・計測 / 修正 / 挿入。修正は従来どおりメニューが開く */
export const GROUPS = [
  { id: "draw", label: "作図", icon: "polygon", tools: ["pen", "eraser", "line", "arrow", "rect", "ellipse", "arc", "polygon", "cloud"] },
  {
    id: "dim", label: "寸法・計測", icon: "dim", tools: ["leader", "dim", "calib", "measure"],
    // 図形を選ばずに点を指して入れる寸法(ツールではなくコマンド。基本パレットには入れられない)
    commands: [
      { id: "dimradius", label: "半径寸法", icon: "ellipse", title: "半径寸法(円・円弧)" },
      { id: "dimdiameter", label: "直径寸法", icon: "ellipse", title: "直径寸法(円・円弧)" },
      { id: "dimangle", label: "角度寸法", icon: "arc", title: "角度寸法(頂点と2本の線上の点)" },
      { id: "dimseries", label: "直列寸法", icon: "dim", title: "直列寸法(測点を順に並べる)" },
      { id: "dimpara", label: "並列寸法", icon: "dim", title: "並列寸法(基準点から各点まで)" },
    ],
  },
  { id: "modify", label: "修正", icon: "modify", direct: "modify" },
  { id: "insert", label: "挿入", icon: "stamp", tools: ["text", "sign", "stamp", "camera"] },
];
export const DEFAULT_PALETTE = ["pen", "eraser", "line", "arrow", "rect", "ellipse", "text"];

/** 保存された並びを整える(知らない機能・重複を除く)。未設定なら初期の並び */
export function normalizePalette(saved, known) {
  if (!Array.isArray(saved)) return DEFAULT_PALETTE.filter((id) => known.has(id));
  const seen = new Set();
  return saved.filter((id) => known.has(id) && !seen.has(id) && seen.add(id));
}
/** id を入れる。idx は「id を除いた並び」での位置(すでにあれば移動になる) */
export function insertTool(list, id, idx) {
  const out = list.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(out.length, idx)), 0, id);
  return out;
}
export const removeTool = (list, id) => list.filter((x) => x !== id);
export const groupOf = (toolId) => GROUPS.find((g) => g.tools?.includes(toolId))?.id || null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export class Toolbar {
  /**
   * nav: #tools / tools: TOOLS(id・icon・label) / icon(name,size) / getPalette()・setPalette(list)
   * onPick(id, button): 機能を選んだ / onRender(): 作り直したあと(選択中の強調を付け直す)
   */
  constructor({ nav, tools, icon, getPalette, setPalette, getShortcut, onPick, onCommand, onRender }) {
    this.nav = nav;
    this.tools = new Map(tools.filter((t) => !t.sep).map((t) => [t.id, t]));
    this.icon = icon;
    this.getPalette = getPalette;
    this.setPalette = setPalette;
    this.onPick = onPick;
    this.getShortcut = getShortcut;
    this.onCommand = onCommand;
    this.onRender = onRender;
    this.pop = null;
    this.openId = null;
    this.render();
    nav.addEventListener("click", (e) => this.onNavClick(e));
    nav.addEventListener("pointerdown", (e) => this.onDown(e, "palette"));
    document.addEventListener("pointerdown", (e) => {
      if (this.pop && !this.pop.contains(e.target) && !e.target.closest("[data-group]")) this.closePopup();
    }, true);
    document.addEventListener("keydown", (e) => e.key === "Escape" && this.closePopup());
  }

  list() {
    return normalizePalette(this.getPalette(), new Set(this.tools.keys()));
  }

  btn(t, extra = "") {
    const sc = this.getShortcut?.(t.id);
    return `<button class="tool${extra}" data-tool="${t.id}" title="${esc(t.label)}${sc ? `(${esc(sc.toUpperCase())})` : ""}">${this.icon(t.icon, 24)}<span>${esc(t.label)}</span></button>`;
  }

  render() {
    const fixed = ["select", "marquee", "lasso", "hand"].map((id) => this.tools.get(id)).filter(Boolean);
    const pal = this.list().map((id) => this.tools.get(id));
    const groups = GROUPS.map((g) => `<button class="tool group" data-group="${g.id}" title="${esc(g.label)}${g.direct ? "" : "(押すと展開)"}">${this.icon(g.icon, 24)}<span>${esc(g.label)}${g.direct ? "" : " ▾"}</span></button>`).join("");
    this.nav.innerHTML =
      `<button class="tool" id="btnPages" title="ページ一覧を開く・閉じる">${this.icon("pages", 24)}<span>ページ</span></button><button class="tool" id="btnLayers" title="レイヤーパネルを開く・閉じる">${this.icon("layers", 24)}<span>レイヤー</span></button><span class="tool-sep"></span>` +
      fixed.map((t) => this.btn(t)).join("") +
      '<span class="tool-sep"></span>' +
      pal.map((t) => this.btn(t, " pal")).join("") +
      '<span class="tool-sep"></span>' +
      groups;
    this.onRender?.();
  }

  /** いまのツールに合わせて強調する(基本パレットにない機能のときは、そのグループを光らせる) */
  highlight(lit) {
    const inPal = this.list().includes(lit);
    const g = inPal ? null : GROUPS.find((x) => x.tools?.includes(lit))?.id;
    document.querySelectorAll(".tool").forEach((b) => {
      if (b.dataset.group) b.classList.toggle("on", !!g && b.dataset.group === g);
      else if (b.dataset.tool) b.classList.toggle("on", b.dataset.tool === lit);
    });
  }

  onNavClick(e) {
    if (this.swallow) return;
    const g = e.target.closest("[data-group]");
    if (g) {
      const def = GROUPS.find((x) => x.id === g.dataset.group);
      if (def.direct) {
        this.closePopup();
        return this.onPick(def.direct, g);
      }
      return this.openId === def.id ? this.closePopup() : this.openPopup(def, g);
    }
    const b = e.target.closest(".tool[data-tool]");
    if (b) this.onPick(b.dataset.tool, b);
  }

  /* ---------- グループの展開 ---------- */
  openPopup(def, anchor) {
    this.closePopup();
    const pal = new Set(this.list());
    const pop = document.createElement("div");
    pop.className = "toolgroup";
    pop.innerHTML = `<div class="tg-title">${esc(def.label)}</div><div class="tg-grid">${def.tools.map((id) => this.tools.get(id)).filter(Boolean).map((t) => this.btn(t, pal.has(t.id) ? " inpal" : "")).join("")}${(def.commands || []).map((c) => `<button class="tool cmd" data-cmd="${c.id}" title="${esc(c.title || c.label)}${this.getShortcut?.(c.id) ? `(${esc(this.getShortcut(c.id).toUpperCase())})` : ""}">${this.icon(c.icon, 24)}<span>${esc(c.label)}</span></button>`).join("")}</div>
      <div class="tg-note">よく使うものは、基本パレット(左のボタン列)へドラッグして入れられます。基本パレットから外へドラッグすると外せます。</div>
      <button class="btn tg-reset" type="button">基本パレットを初期に戻す</button>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
    const below = r.top < innerHeight / 2;
    pop.style.top = `${below ? r.bottom + 6 : Math.max(8, r.top - h - 6)}px`;
    pop.addEventListener("click", (e) => {
      if (this.swallow) return;
      if (e.target.closest(".tg-reset")) {
        this.save(null);
        return this.openPopup(def, anchor);
      }
      const c = e.target.closest(".tool[data-cmd]");
      if (c) {
        this.closePopup();
        return this.onCommand?.(c.dataset.cmd);
      }
      const b = e.target.closest(".tool[data-tool]");
      if (b) {
        this.closePopup();
        this.onPick(b.dataset.tool, b);
      }
    });
    pop.addEventListener("pointerdown", (e) => this.onDown(e, "group"));
    this.pop = pop;
    this.openId = def.id;
    anchor.classList.add("open");
  }
  closePopup() {
    this.pop?.remove();
    this.pop = null;
    this.openId = null;
    this.nav.querySelectorAll(".group.open").forEach((b) => b.classList.remove("open"));
  }

  save(list) {
    this.setPalette(list);
    this.render();
  }

  /* ---------- ドラッグ(基本パレットへ入れる/並べ替え/外す) ---------- */
  onDown(e, from) {
    const b = e.target.closest(".tool[data-tool]");
    if (!b || (from === "palette" && !b.classList.contains("pal"))) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const id = b.dataset.tool;
    const st = { id, from, b, x: e.clientX, y: e.clientY, started: false, touch: e.pointerType === "touch", pid: e.pointerId };
    const start = () => {
      if (st.started) return;
      st.started = true;
      this.beginDrag(st);
    };
    if (st.touch) st.timer = setTimeout(start, 320); // 指は長押しでドラッグ(普通のスワイプはスクロール)
    const move = (ev) => {
      if (ev.pointerId !== st.pid) return;
      if (!st.started) {
        if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < (st.touch ? 10 : 6)) return;
        if (st.touch) return cleanup(); // 長押し前に動いた=スクロール
        start();
      }
      this.moveDrag(st, ev);
    };
    const up = (ev) => {
      if (ev.pointerId !== st.pid) return;
      const dragged = st.started;
      cleanup();
      if (dragged) this.endDrag(st, ev);
    };
    const block = (ev) => st.started && ev.cancelable && ev.preventDefault();
    const cleanup = () => {
      clearTimeout(st.timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchmove", block);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchmove", block, { passive: false });
  }

  beginDrag(st) {
    const g = st.b.cloneNode(true);
    g.className = "tool drag-ghost";
    document.body.appendChild(g);
    st.ghost = g;
    st.bar = document.createElement("span");
    st.bar.className = "tool-drop";
    st.bar.hidden = true;
    document.body.appendChild(st.bar);
    st.b.classList.add("dragging");
  }
  hitNav(ev) {
    const r = this.nav.getBoundingClientRect();
    return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top - 6 && ev.clientY <= r.bottom + 6;
  }
  /** ポインタの位置が、基本パレットの何番目になるか(ドラッグ中のものは数えない) */
  indexAt(st, ev) {
    const items = [...this.nav.querySelectorAll(".tool.pal")];
    let idx = 0;
    for (const el of items) {
      if (el === st.b) continue;
      const r = el.getBoundingClientRect();
      if (ev.clientX > r.left + r.width / 2) idx++;
    }
    return idx;
  }
  moveDrag(st, ev) {
    st.ghost.style.left = `${ev.clientX - 26}px`;
    st.ghost.style.top = `${ev.clientY - 26}px`;
    const inside = this.hitNav(ev);
    st.ghost.classList.toggle("del", !inside && st.from === "palette");
    st.bar.hidden = !inside;
    if (inside) {
      const items = [...this.nav.querySelectorAll(".tool.pal")].filter((el) => el !== st.b);
      const idx = this.indexAt(st, ev);
      const nr = this.nav.getBoundingClientRect();
      let x;
      if (!items.length) {
        const sep = [...this.nav.querySelectorAll(".tool-sep")].pop();
        x = (sep ? sep.getBoundingClientRect().left : nr.right) - 4;
      } else if (idx >= items.length) x = items[items.length - 1].getBoundingClientRect().right + 2;
      else x = items[idx].getBoundingClientRect().left - 2;
      st.bar.style.left = `${x}px`;
      st.bar.style.top = `${nr.top + 4}px`;
      st.bar.style.height = `${nr.height - 8}px`;
    }
  }
  endDrag(st, ev) {
    st.ghost.remove();
    st.bar.remove();
    st.b.classList.remove("dragging");
    this.swallow = true; // このあとに来る「クリック」は無視する
    setTimeout(() => (this.swallow = false), 60);
    const list = this.list();
    if (this.hitNav(ev)) {
      this.save(insertTool(list, st.id, this.indexAt(st, ev)));
      if (this.pop && st.from === "group") {
        const def = GROUPS.find((x) => x.id === this.openId);
        const anchor = this.nav.querySelector(`[data-group="${this.openId}"]`);
        if (def && anchor) this.openPopup(def, anchor);
      }
    } else if (st.from === "palette") {
      this.save(removeTool(list, st.id));
    }
  }
}
