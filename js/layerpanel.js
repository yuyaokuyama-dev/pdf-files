// レイヤーパネル: 一覧・表示/非表示・ロック・色/太さ/線種・名前・図形の選択・削除、描く先のレイヤー
import { icon } from "./icons.js";
import { esc } from "./ui.js";
import { DASH_TYPES, normDash } from "./geometry.js";
import { BASE_LAYER_ID } from "./layers.js";

export class LayerPanel {
  constructor({ el, editor, onToast, onConfirm, onClose }) {
    this.el = el;
    this.editor = editor;
    this.toast = onToast;
    this.confirm = onConfirm;
    this.onClose = onClose;
    el.addEventListener("click", (e) => this.onClick(e));
    el.addEventListener("change", (e) => this.onChange(e));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.tagName === "INPUT") e.target.blur();
    });
    editor.on("layer-current", () => this.refresh());
    editor.on("pages", () => this.refresh());
    this.bindModel();
  }

  get model() {
    return this.editor.model;
  }

  bindModel() {
    // モデル変更(取り消し等)で一覧を更新。入力中は壊さない
    this._off?.();
    this._off = this.model.onChange(() => {
      if (this.el.hidden) return;
      const a = document.activeElement;
      if (this.el.contains(a) && a.tagName === "INPUT" && a.type !== "color") return;
      this.refresh();
    });
    this.refresh();
  }

  get open() {
    return !this.el.hidden;
  }
  setOpen(on) {
    this.el.hidden = !on;
    if (on) this.refresh();
  }

  refresh() {
    if (this.el.hidden) return;
    const m = this.model;
    const rows = m.layers
      .map((l) => {
        const n = m.layerCount(l.id);
        const cur = m.curLayer === l.id;
        return `<div class="lp-row${cur ? " cur" : ""}${l.visible ? "" : " off"}" data-id="${esc(l.id)}">
          <div class="lp-main">
            <button class="lp-btn${cur ? " on" : ""}" data-act="cur" title="ここに描く" aria-label="${esc(l.name)}を描く先にする" aria-pressed="${cur}">${cur ? "●" : "○"}</button>
            <button class="lp-btn" data-act="vis" title="${l.visible ? "表示中(タップで非表示)" : "非表示(タップで表示)"}" aria-label="${esc(l.name)}の表示切り替え" aria-pressed="${l.visible}">${icon(l.visible ? "eye" : "eyeoff", 18)}</button>
            <button class="lp-btn" data-act="lock" title="${l.locked ? "ロック中(タップで解除)" : "ロックする(選択・編集できなくなる)"}" aria-label="${esc(l.name)}のロック切り替え" aria-pressed="${l.locked}">${icon(l.locked ? "lock" : "unlock", 18)}</button>
            <input type="color" class="lp-color" data-k="color" value="${esc(l.color)}" aria-label="${esc(l.name)}の色">
            <input type="text" class="lp-name" data-k="name" value="${esc(l.name)}" aria-label="レイヤー名" maxlength="40">
            <span class="lp-n" title="図形の数">${n}</span>
          </div>
          <div class="lp-sub">
            <label>太さ<input type="number" data-k="width" min="0.5" max="24" step="0.5" value="${l.width}"></label>
            <select data-k="dash" aria-label="線種">${DASH_TYPES.map((d) => `<option value="${d.id}"${normDash(l.dash) === d.id ? " selected" : ""}>${d.label}</option>`).join("")}</select>
            <button class="btn" data-act="sel">図形を選択</button>
            <button class="btn danger" data-act="del"${l.id === BASE_LAYER_ID ? " disabled" : ""}>削除</button>
          </div>
        </div>`;
      })
      .join("");
    this.el.innerHTML = `<div class="lp-head"><h3>レイヤー</h3>
        <button class="btn" data-act="add">${icon("plus", 16)}追加</button>
        <button class="btn icon" data-act="close" style="min-height:28px;width:28px" aria-label="閉じる">${icon("x", 16)}</button></div>
      <div class="lp-list">${rows}</div>
      <p class="hint">● が描く先のレイヤーです。0以外に描くと、色・太さ・線種がレイヤーの設定に従います。非表示のレイヤーはPDFにも書き出されません。レイヤーの削除は図形も一緒に消えます(取り消しで戻せます)。</p>`;
  }

  rowId(e) {
    return e.target.closest(".lp-row")?.dataset.id;
  }

  async onClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const id = this.rowId(e);
    const m = this.model;
    const l = id ? m.layer(id) : null;
    switch (b.dataset.act) {
      case "close":
        this.setOpen(false);
        this.onClose?.();
        break;
      case "add": {
        const nl = m.addLayer();
        this.editor.setCurrentLayer(nl.id);
        this.refresh();
        break;
      }
      case "cur":
        this.editor.setCurrentLayer(id);
        break;
      case "vis":
        m.updateLayer(id, { visible: !l.visible });
        break;
      case "lock":
        m.updateLayer(id, { locked: !l.locked });
        break;
      case "sel": {
        if (!this.editor.curPageId) break;
        if (!["select", "marquee", "lasso"].includes(this.editor.tool)) this.editor.setTool("select");
        const n = this.editor.selectLayer(id);
        this.toast(n ? `「${l.name}」の図形を${n}個選択しました(このページ内)` : `このページに「${l.name}」の図形はありません`);
        break;
      }
      case "del": {
        const n = m.layerCount(id);
        const ok = await this.confirm(
          n ? `レイヤー「${l.name}」と、その中の図形${n}個(全ページ)を削除します。\n取り消しで元に戻せます。` : `レイヤー「${l.name}」を削除します。`,
          { ok: "削除", danger: true },
        );
        if (ok) {
          m.deleteLayer(id);
          this.refresh();
        }
        break;
      }
      default:
        break;
    }
  }

  onChange(e) {
    const k = e.target.dataset.k;
    const id = this.rowId(e);
    if (!k || !id) return;
    const v = e.target.value;
    if (k === "name") {
      const name = v.trim();
      if (!name) return this.refresh();
      if (this.model.layers.some((l) => l.id !== id && l.name === name)) {
        this.toast("同じ名前のレイヤーがあります", { error: true });
        return this.refresh();
      }
      this.model.updateLayer(id, { name });
    } else if (k === "width") {
      const w = Number(v);
      if (w > 0) this.model.updateLayer(id, { width: Math.min(24, w) });
      else this.refresh();
    } else if (k === "color") {
      this.model.updateLayer(id, { color: v });
    } else if (k === "dash") {
      this.model.updateLayer(id, { dash: v });
    }
  }
}
