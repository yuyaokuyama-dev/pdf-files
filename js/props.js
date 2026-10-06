// プロパティパネル: 選択中の図形(または現在のツールの初期値)の色・太さ・文字・雲ピッチなどを編集する
import { icon } from "./icons.js";
import { FONTS } from "./render.js";
import { esc } from "./ui.js";

const COLORS = ["#e11d48", "#f97316", "#eab308", "#16a34a", "#2563eb", "#7c3aed", "#111827", "#6b7280", "#ffffff"];
const LINE_TYPES = new Set(["pen", "line", "arrow", "rect", "ellipse", "polygon", "cloud", "dim", "measure"]);
const FILL_TYPES = new Set(["rect", "ellipse", "polygon", "cloud"]);
const TOOL_TYPE = { pen: "pen", line: "line", arrow: "arrow", rect: "rect", ellipse: "ellipse", polygon: "polygon", cloud: "cloud", text: "text", dim: "dim", calib: "dim", measure: "measure", stamp: "stamp" };

export class Props {
  constructor({ el, editor, getStamps, onPickStamp, onManageStamps, onToast }) {
    this.el = el;
    this.editor = editor;
    this.getStamps = getStamps;
    this.onPickStamp = onPickStamp;
    this.onManageStamps = onManageStamps;
    this.toast = onToast;
    this.dismissed = false;
    editor.on("selection", () => ((this.dismissed = false), this.refresh()));
    editor.on("tool", () => ((this.dismissed = false), this.refresh()));
    editor.model && this.bindModel();
    el.addEventListener("input", (e) => this.onInput(e, true));
    el.addEventListener("change", (e) => this.onInput(e, false));
    el.addEventListener("click", (e) => this.onClick(e));
  }

  bindModel() {
    // モデル変更(取り消し等)でパネルを更新。入力中は壊さない
    this._offModel?.();
    this._offModel = this.editor.model.onChange(() => {
      if (!this.el.contains(document.activeElement) || document.activeElement.tagName === "BUTTON") this.refresh();
    });
  }

  get ed() {
    return this.editor;
  }

  context() {
    const ed = this.ed;
    const sh = ed.selectedShape();
    if (sh) return { sel: true, type: sh.type, shape: sh, page: ed.selectedPage() };
    const type = TOOL_TYPE[ed.tool];
    if (!type) return null;
    return { sel: false, type, shape: null, page: ed.model.page(ed.curPageId) };
  }

  /* ---- 値の読み書き ---- */
  get(ctx, key) {
    const ed = this.ed;
    const sh = ctx.shape;
    switch (key) {
      case "color":
        if (ctx.type === "text") return sh ? sh.color || sh.style?.color : ed.textStyle.color;
        return sh ? sh.style?.color : ed.style.color;
      case "width":
      case "fill":
      case "fillOpacity":
      case "dash":
      case "opacity":
        return (sh ? sh.style : ed.style)?.[key];
      case "size":
        if (ctx.type === "dim" || ctx.type === "measure") return sh ? sh.size : ed.dimSize;
        return sh ? sh.size : ed.textStyle.size;
      case "font":
      case "bold":
        return sh ? sh[key] : ed.textStyle[key];
      case "pitch":
        return sh ? sh.pitch : ed.cloudPitch;
      case "text":
        return sh?.text ?? "";
      default:
        return undefined;
    }
  }

  apply(ctx, key, value, live) {
    const ed = this.ed;
    if (ctx.sel) {
      ed.updateSelected((sh) => {
        sh.style = sh.style || {};
        switch (key) {
          case "color":
            if (sh.type === "text") sh.color = value;
            sh.style.color = value;
            break;
          case "width":
          case "fill":
          case "fillOpacity":
          case "dash":
          case "opacity":
            sh.style[key] = value;
            break;
          case "size":
          case "font":
          case "bold":
          case "text":
            sh[key] = value;
            break;
          case "pitch":
            sh.pitch = value;
            break;
          default:
            break;
        }
      }, { live });
    } else {
      switch (key) {
        case "color":
          if (ctx.type === "text") ed.textStyle.color = value;
          else ed.style.color = value;
          break;
        case "width":
        case "fill":
        case "fillOpacity":
        case "dash":
        case "opacity":
          ed.style[key] = value;
          break;
        case "size":
          if (ctx.type === "dim" || ctx.type === "measure") ed.dimSize = value;
          else ed.textStyle.size = value;
          break;
        case "font":
        case "bold":
          ed.textStyle[key] = value;
          break;
        case "pitch":
          ed.cloudPitch = value;
          break;
        default:
          break;
      }
    }
  }

  onInput(e, isInput) {
    const t = e.target;
    const key = t.dataset.k;
    if (!key) return;
    const ctx = this.context();
    if (!ctx) return;
    let v;
    if (t.type === "checkbox") v = t.checked;
    else if (t.type === "range" || t.type === "number") v = Number(t.value);
    else v = t.value;
    if (key === "fillOn") {
      if (isInput) return; // チェックボックスは change で1回だけ処理
      this.apply(ctx, "fill", v ? this.fillMemo || "#fde047" : "none", true);
      this.ed.commitLive();
      this.refresh();
      return;
    }
    if (key === "fillColor") {
      this.fillMemo = v;
      this.apply(ctx, "fill", v, true);
      if (!isInput) this.ed.commitLive();
      return;
    }
    if (t.type === "number" && (!Number.isFinite(v) || v <= 0)) return;
    // 入力中は履歴に積まずに反映(ライブ)、確定(change)で1操作として記録する
    this.apply(ctx, key, v, true);
    if (!isInput) this.ed.commitLive();
    // 数値表示の同期
    const pct = key === "opacity" || key === "fillOpacity";
    const out = this.el.querySelector(`[data-v="${key}"]`);
    if (out) out.textContent = pct ? `${Math.round(v * 100)}%` : String(v);
    if (t.type === "range") {
      const num = this.el.querySelector(`input[type=number][data-k="${key}"]`);
      if (num) num.value = v;
    }
    if (t.type === "number") {
      const r = this.el.querySelector(`input[type=range][data-k="${key}"]`);
      if (r) r.value = v;
    }
  }

  async onClick(e) {
    const b = e.target.closest("[data-act], .sw, .st");
    if (!b) return;
    const ctx = this.context();
    const ed = this.ed;
    if (b.classList.contains("sw")) {
      if (ctx) {
        this.apply(ctx, "color", b.dataset.c, false);
        this.refresh();
      }
      return;
    }
    if (b.classList.contains("st")) {
      const stamps = await this.getStamps();
      const s = stamps.find((x) => x.id === b.dataset.id);
      if (s) this.onPickStamp(s);
      this.refresh();
      return;
    }
    switch (b.dataset.act) {
      case "close":
        this.dismissed = true;
        this.refresh();
        break;
      case "dup": ed.duplicateSelected(); break;
      case "front": ed.reorderSelected(true); break;
      case "back": ed.reorderSelected(false); break;
      case "del": ed.deleteSelected(); break;
      case "edit-text": ed.editSelectedText(); break;
      case "stamps": this.onManageStamps(); break;
      case "scale-clear": {
        const pg = ctx?.page;
        if (pg) ed.model.mutate(() => (pg.scale = null));
        this.refresh();
        break;
      }
      case "scale-all": {
        const pg = ctx?.page;
        if (pg?.scale) {
          ed.model.mutate(() => ed.model.pages.forEach((p) => (p.scale = { ...pg.scale })));
          this.toast("全ページに縮尺を適用しました");
        }
        break;
      }
      default: break;
    }
  }

  async refresh() {
    const ctx = this.context();
    const show = !!ctx && !this.dismissed;
    this.el.hidden = !show;
    if (!show) return;
    const t = ctx.type;
    const g = (k) => this.get(ctx, k);
    const num = (k, label, min, max, step = 1, fmt) => {
      const v = g(k) ?? min;
      return `<label class="field">${label}<div class="row"><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val" data-v="${k}">${fmt ? fmt(v) : v}</span></div></label>`;
    };
    const parts = [];
    const title = { pen: "ペン", line: "線", arrow: "矢印", rect: "四角", ellipse: "丸(楕円)", polygon: "多角形", cloud: "雲マーク", text: "テキスト", dim: "寸法線", measure: "計測", image: "画像・スタンプ・署名", stamp: "スタンプ" }[t] || "";
    parts.push(`<div style="display:flex;align-items:center"><h3 style="flex:1">${title}${ctx.sel ? "(選択中)" : "(次に描くもの)"}</h3><button class="btn icon" data-act="close" style="min-height:28px;width:28px" aria-label="閉じる">${icon("x", 16)}</button></div>`);

    if (t === "stamp") {
      const stamps = await this.getStamps();
      parts.push(`<div class="stamp-tray">${stamps.map((s) => `<button class="st${this.ed.pendingStamp?.imgId === s.imgId ? " on" : ""}" data-id="${s.id}" title="${esc(s.name || "")}"><img src="${s.url}" alt=""></button>`).join("")}</div>
        <div class="actions"><button class="btn" data-act="stamps">${icon("stamp", 18)}印影の登録・管理</button></div>
        <p class="hint">${stamps.length ? "印影を選んでから、押したい位置をタップします。" : "まず「印影の登録・管理」から印影を登録してください。"}</p>`);
    }

    if (LINE_TYPES.has(t) || t === "text") {
      const cur = (g("color") || "#e11d48").toLowerCase();
      parts.push(`<div class="field">色<div class="swatches">${COLORS.map((c) => `<button class="sw${c === cur ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}<input type="color" data-k="color" value="${cur}" aria-label="色を選ぶ"></div></div>`);
    }
    if (LINE_TYPES.has(t) && t !== "measure") parts.push(num("width", "線の太さ", 1, 24, 0.5));
    if (FILL_TYPES.has(t)) {
      const fill = g("fill");
      const on = fill && fill !== "none";
      parts.push(`<div class="field"><label class="check"><input type="checkbox" data-k="fillOn"${on ? " checked" : ""}> 塗りつぶし</label>${on ? `<div class="row"><input type="color" data-k="fillColor" value="${fill}"></div>` : ""}</div>`);
      if (on) parts.push(num("fillOpacity", "塗りの濃さ", 0.05, 1, 0.05, (v) => `${Math.round(v * 100)}%`));
    }
    if (LINE_TYPES.has(t) && t !== "measure") {
      parts.push(`<label class="field check" style="display:flex"><input type="checkbox" data-k="dash"${g("dash") ? " checked" : ""}> 破線</label>`);
      parts.push(num("opacity", "不透明度", 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`));
    }
    if (t === "cloud") parts.push(num("pitch", "雲のピッチ(円弧の大きさ)", 6, 80, 1));
    if (t === "text") {
      const size = g("size") || 18;
      parts.push(`<label class="field">文字サイズ<div class="row"><input type="range" data-k="size" min="8" max="120" value="${size}"><input type="number" data-k="size" min="6" max="400" value="${size}" style="width:70px;height:34px"></div></label>`);
      parts.push(`<label class="field">フォント<select data-k="font">${FONTS.map((f) => `<option value="${f.id}"${(g("font") || "gothic") === f.id ? " selected" : ""} style="font-family:${f.css.replace(/"/g, "'")}">${f.label}</option>`).join("")}</select></label>`);
      parts.push(`<label class="field check" style="display:flex"><input type="checkbox" data-k="bold"${g("bold") ? " checked" : ""}> 太字</label>`);
      if (ctx.sel) parts.push(`<div class="actions"><button class="btn" data-act="edit-text">文字を編集</button></div>`);
    }
    if (t === "dim" || t === "measure") {
      parts.push(num("size", "文字サイズ", 6, 48, 1));
      if (t === "dim" && ctx.sel) parts.push(`<label class="field">寸法の文字(自由に入力)<input type="text" data-k="text" value="${esc(g("text"))}" placeholder="例: 3,600"></label>`);
      if (t === "measure" && ctx.sel) parts.push(`<p class="hint">計測値: <b>${esc(this.ed.labelOf(ctx.shape, ctx.page))}</b>(縮尺に基づく参考値)</p>`);
    }
    if (t === "dim" || t === "measure") {
      const pg = ctx.page;
      const sc = pg?.scale;
      parts.push(`<div class="field"><b style="color:var(--ink)">このページの縮尺</b><span>${sc ? `設定済み: 1 ${sc.unit} = ${sc.ptsPerUnit.toFixed(3)} pt` : "未設定(「縮尺設定」ツールで基準の2点をなぞります)"}</span></div>
        ${sc ? `<div class="actions"><button class="btn" data-act="scale-all">全ページに適用</button><button class="btn danger" data-act="scale-clear">解除</button></div>` : ""}`);
    }
    if (t === "image") parts.push(`<p class="hint">四隅のハンドルで大きさを変更できます(縦横比は固定)。</p>`);
    if (ctx.sel) {
      parts.push(`<div class="actions">
        <button class="btn" data-act="dup">${icon("copy", 16)}複製</button>
        <button class="btn" data-act="front">前面へ</button>
        <button class="btn" data-act="back">背面へ</button>
        <button class="btn danger" data-act="del">${icon("trash", 16)}削除</button></div>`);
      if (t === "polygon" || t === "cloud") parts.push(`<p class="hint">頂点をドラッグで移動、辺をダブルタップで頂点を追加、頂点をダブルタップで削除できます。</p>`);
    }
    this.el.innerHTML = parts.join("");
  }
}
