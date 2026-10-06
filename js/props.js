// プロパティパネル: 選択中の図形(または現在のツールの初期値)の色・太さ・文字・雲ピッチなどを編集する
import { icon } from "./icons.js";
import { FONTS, textMetrics, textCorners } from "./render.js";
import { esc } from "./ui.js";
import { DASH_TYPES, normDash, arrowSizeOf } from "./geometry.js";

const COLORS = ["#e11d48", "#f97316", "#eab308", "#16a34a", "#2563eb", "#7c3aed", "#111827", "#6b7280", "#ffffff"];
const LINE_TYPES = new Set(["pen", "line", "arrow", "rect", "ellipse", "polygon", "cloud", "dim", "measure"]);
const FILL_TYPES = new Set(["rect", "ellipse", "polygon", "cloud"]);
const TOOL_TYPE = { pen: "pen", line: "line", arrow: "arrow", rect: "rect", ellipse: "ellipse", polygon: "polygon", cloud: "cloud", text: "text", dim: "dim", calib: "dim", measure: "measure", stamp: "stamp" };

/** 文字の回転: 箱の中心を動かさずに角度だけ変える */
function rotateTextAbout(sh, deg) {
  const m = textMetrics(sh);
  const c = textCorners(sh, m);
  const ctr = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
  const th = ((((Math.round(deg) % 360) + 360) % 360) * Math.PI) / 180;
  sh.angle = th ? Math.round((th * 180) / Math.PI) : undefined;
  sh.pts[0] = [ctr[0] - ((m.w / 2) * Math.cos(th) - (m.h / 2) * Math.sin(th)), ctr[1] - ((m.w / 2) * Math.sin(th) + (m.h / 2) * Math.cos(th))];
}

export class Props {
  constructor({ el, editor, getStamps, onPickStamp, onManageStamps, onStampWidth, onToast }) {
    this.el = el;
    this.editor = editor;
    this.getStamps = getStamps;
    this.onPickStamp = onPickStamp;
    this.onManageStamps = onManageStamps;
    this.onStampWidth = onStampWidth;
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
      case "dash":
        return normDash((sh ? sh.style : ed.style)?.dash);
      case "width":
      case "fill":
      case "fillOpacity":
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
      case "headSize":
        return sh ? arrowSizeOf(sh) : ed.arrowSize;
      case "angle":
        return sh?.angle || 0;
      case "endStyle":
        return sh ? sh.endStyle ?? "arrow" : ed.dimEnd.style;
      case "endSize":
        return sh ? sh.endSize ?? (sh.size || 12) / 2 : ed.dimEnd.size;
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
          case "angle":
            rotateTextAbout(sh, value);
            break;
          case "endStyle":
          case "endSize":
          case "headSize":
            sh[key] = value;
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
        case "endStyle":
          ed.dimEnd.style = value;
          break;
        case "endSize":
          ed.dimEnd.size = value;
          break;
        case "headSize":
          ed.arrowSize = value;
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
    if (key === "stampW") {
      if (!isInput && v > 0) {
        const mm = Math.min(200, Math.max(3, v));
        this.onStampWidth?.(this.ed.pendingStamp?.id, mm * (72 / 25.4));
      }
      return;
    }
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
    if (key === "dash") v = v || false;
    if (t.type === "number" && (!Number.isFinite(v) || (key !== "angle" && v <= 0))) return;
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
      case "set-default":
        if (ctx.sel) {
          ed.setDefaultsFrom(ctx.shape);
          this.toast("この設定を、新しく作る線・図形・文字の初期設定にしました");
        }
        break;
      case "rot90":
        if (ctx.sel) ed.updateSelected((sh) => rotateTextAbout(sh, (sh.angle || 0) + 90), { live: false });
        break;
      case "text-home":
        if (ctx.sel) ed.updateSelected((sh) => delete sh.textOff, { live: false });
        this.refresh();
        break;
      case "lock": ed.emit("lock-request", { lock: true }); break;
      case "unlock": ed.setLocked(false); this.refresh(); break;
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
        ${this.ed.pendingStamp?.id ? `<label class="field">押す大きさ(幅 mm)<input type="number" data-k="stampW" min="3" max="200" step="0.5" value="${+((this.ed.pendingStamp.w || 64) / (72 / 25.4)).toFixed(1)}" style="width:90px;height:34px"></label>` : ""}
        <div class="actions"><button class="btn" data-act="stamps">${icon("stamp", 18)}印影の登録・管理</button></div>
        <p class="hint">${stamps.length ? "印影を選んでから、押したい位置をタップします。" : "まず「印影の登録・管理」から印影を登録してください。"}</p>`);
    }

    if (LINE_TYPES.has(t) || t === "text") {
      const cur = (g("color") || "#e11d48").toLowerCase();
      parts.push(`<div class="field">色<div class="swatches">${COLORS.map((c) => `<button class="sw${c === cur ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}<input type="color" data-k="color" value="${cur}" aria-label="色を選ぶ"></div></div>`);
    }
    if (LINE_TYPES.has(t) && t !== "measure") parts.push(num("width", "線の太さ", 0.5, 24, 0.5, (v) => Number(v).toFixed(1)));
    if (FILL_TYPES.has(t)) {
      const fill = g("fill");
      const on = fill && fill !== "none";
      parts.push(`<div class="field"><label class="check"><input type="checkbox" data-k="fillOn"${on ? " checked" : ""}> 塗りつぶし</label>${on ? `<div class="row"><input type="color" data-k="fillColor" value="${fill}"></div>` : ""}</div>`);
      if (on) parts.push(num("fillOpacity", "塗りの濃さ", 0.05, 1, 0.05, (v) => `${Math.round(v * 100)}%`));
    }
    if (LINE_TYPES.has(t) && t !== "measure") {
      parts.push(`<label class="field">線の種類<select data-k="dash">${DASH_TYPES.map((d) => `<option value="${d.id}"${g("dash") === d.id ? " selected" : ""}>${d.label}</option>`).join("")}</select></label>`);
      parts.push(num("opacity", "不透明度", 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`));
    }
    if (t === "arrow") parts.push(num("headSize", "矢印のサイズ(線の太さとは別)", 3, 60, 0.5, (v) => Number(v).toFixed(1)));
    if (t === "cloud") parts.push(num("pitch", "雲のピッチ(円弧の大きさ)", 6, 80, 1));
    if (t === "text") {
      const size = g("size") || 18;
      parts.push(`<label class="field">文字サイズ<div class="row"><input type="range" data-k="size" min="3" max="120" step="0.5" value="${size}"><input type="number" data-k="size" min="3" max="400" step="0.5" value="${size}" style="width:70px;height:34px"></div></label>`);
      parts.push(`<label class="field">フォント<select data-k="font">${FONTS.map((f) => `<option value="${f.id}"${(g("font") || "gothic") === f.id ? " selected" : ""} style="font-family:${f.css.replace(/"/g, "'")}">${f.label}</option>`).join("")}</select></label>`);
      parts.push(`<label class="field check" style="display:flex"><input type="checkbox" data-k="bold"${g("bold") ? " checked" : ""}> 太字</label>`);
      if (ctx.sel) {
        const ang = g("angle");
        parts.push(`<label class="field">回転(度)<div class="row"><input type="range" data-k="angle" min="0" max="359" step="1" value="${ang}"><input type="number" data-k="angle" min="0" max="359" step="1" value="${ang}" style="width:70px;height:34px"></div></label>`);
        parts.push(`<div class="actions"><button class="btn" data-act="edit-text">文字を編集</button><button class="btn" data-act="rot90">90°回す</button></div>`);
      }
    }
    if (t === "dim" || t === "measure") {
      parts.push(num("size", "文字サイズ", 3, 48, 0.5));
      parts.push(`<label class="field">寸法線の端部<select data-k="endStyle"><option value="dot"${g("endStyle") === "dot" ? " selected" : ""}>黒丸</option><option value="arrow"${g("endStyle") === "arrow" ? " selected" : ""}>矢印</option></select></label>`);
      parts.push(num("endSize", "端部のサイズ", 1, 20, 0.5, (v) => Number(v).toFixed(1)));
      if (ctx.sel && ctx.shape.textOff) parts.push(`<div class="actions"><button class="btn" data-act="text-home">寸法値を元の位置へ戻す</button></div>`);
      if (t === "dim" && ctx.sel) parts.push(`<label class="field">寸法の文字(自由に入力)<input type="text" data-k="text" value="${esc(g("text"))}" placeholder="例: 3,600"></label>`);
      if (t === "measure" && ctx.sel) parts.push(`<p class="hint">計測値: <b>${esc(this.ed.labelOf(ctx.shape, ctx.page))}</b>(縮尺に基づく参考値)</p>`);
    }
    if (t === "dim" || t === "measure") {
      const pg = ctx.page;
      const sc = pg?.scale;
      parts.push(`<div class="field"><b style="color:var(--ink)">このページの縮尺</b><span>${sc ? `設定済み: 1 ${sc.unit} = ${sc.ptsPerUnit.toFixed(3)} pt` : "未設定(「縮尺設定」ツールで基準の2点をなぞります)"}</span></div>
        ${sc ? `<div class="actions"><button class="btn" data-act="scale-all">全ページに適用</button><button class="btn danger" data-act="scale-clear">解除</button></div>` : ""}`);
    }
    const locked = !!(ctx.sel && ctx.shape.locked);
    if (t === "image" && !locked) parts.push(`<p class="hint">四隅のハンドルで大きさを変更できます(縦横比は固定)。</p>`);
    if (t === "image" && ctx.sel && ["stamp", "signature"].includes(ctx.shape.kind)) {
      parts.push(locked
        ? `<p class="hint">🔒 ロック中です。動かしたり消したりできません。書き出すとこのページは画像化され、他のソフトでも編集できなくなります。</p><div class="actions"><button class="btn" data-act="unlock">ロックを解除</button></div>`
        : `<div class="actions"><button class="btn" data-act="lock">🔒 編集できないようにする</button></div>`);
    }
    if (locked) {
      this.el.innerHTML = parts.join("");
      return;
    }
    if (ctx.sel) {
      if (t !== "image" && t !== "stamp") parts.push(`<div class="actions"><button class="btn" data-act="set-default">${icon("check", 16)}この設定を初期設定にする</button></div>`);
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
