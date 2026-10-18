// プロパティパネル: 選択中の図形(または現在のツールの初期値)の色・太さ・文字・雲ピッチなどを編集する
import { defaultAngleRadius, angleBetween, angleLabel } from "./dimx.js";
import { icon } from "./icons.js";
import { FONTS, textMetrics, textCorners } from "./render.js";
import { esc } from "./ui.js";
import { DASH_TYPES, normDash, arrowSizeOf, dist, clampSweep, rotateAbout } from "./geometry.js";
import { resolveShape, BL_KEYS, layerIdOf } from "./layers.js";
import { SNAP_KINDS, polarOf, pointAt } from "./snap.js";
import { LEADER_BOXES, LEADER_TIPS, LEADER_DEFAULT } from "./leader.js";

const COLORS = ["#e11d48", "#f97316", "#eab308", "#16a34a", "#2563eb", "#7c3aed", "#111827", "#6b7280", "#ffffff"];
const LINE_TYPES = new Set(["pen", "line", "arrow", "leader", "rect", "ellipse", "arc", "polygon", "polyline", "cloud", "dim", "dimang", "measure"]);
const FILL_TYPES = new Set(["rect", "ellipse", "polygon", "cloud"]);
const TEXT_LIKE = new Set(["text"]);
const TOOL_TYPE = { pen: "pen", line: "line", arrow: "arrow", rect: "rect", ellipse: "ellipse", arc: "arc", polygon: "polygon", polyline: "polyline", cloud: "cloud", text: "text", leader: "leader", dim: "dim", calib: "dim", measure: "measure", stamp: "stamp", eraser: "eraser" };

/** 文字の回転: 箱の中心を動かさずに角度だけ変える */
function rotateTextAbout(sh, deg) {
  const m = textMetrics(sh);
  const c = textCorners(sh, m);
  const ctr = [(c[0][0] + c[2][0]) / 2, (c[0][1] + c[2][1]) / 2];
  const th = ((((Math.round(deg) % 360) + 360) % 360) * Math.PI) / 180;
  sh.angle = th ? Math.round((th * 180) / Math.PI) : undefined;
  sh.pts[0] = [ctr[0] - ((m.w / 2) * Math.cos(th) - (m.h / 2) * Math.sin(th)), ctr[1] - ((m.w / 2) * Math.sin(th) + (m.h / 2) * Math.cos(th))];
}

const PT_MM = 25.4 / 72;
const LEADER_FIELD = { lsize: "size", lbox: "box", ltip: "tip", ltipSize: "tipSize", ltoff: "toff", ltext: "text" };
const ARC_PRESETS = [{ s: 90, label: "1/4円" }, { s: 180, label: "半円" }, { s: 270, label: "3/4円" }];
const arcAngle = (sh) => {
  const [c, a] = sh.pts;
  return ((Math.round((Math.atan2(a[1] - c[1], a[0] - c[0]) * 180) / Math.PI) % 360) + 360) % 360;
};
/** 円弧の向き: 中心を動かさずに始点を指定角度へ回す */
function rotateArcTo(sh, deg) {
  const [c] = sh.pts;
  sh.pts[1] = rotateAbout(sh.pts[1], c, Math.round(deg) - arcAngle(sh));
}
/** 円弧の大きさ: 中心と向きはそのまま、半径だけ変える(常に正円) */
function setArcRadius(sh, r) {
  const [c, a] = sh.pts;
  const r0 = dist(c, a) || 1;
  sh.pts[1] = [c[0] + ((a[0] - c[0]) * r) / r0, c[1] + ((a[1] - c[1]) * r) / r0];
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
    this.mv = { angle: 90, rcopy: false, k: 2, scopy: false, keep: true, rows: 2, cols: 3, rowd: 20, cold: 20, count: 6, pang: 360, protate: true, dist: 10 };
    this.modOpen = false;
    el.addEventListener("toggle", (e) => e.target.classList?.contains("modbox") && (this.modOpen = e.target.open), true);
    editor.on("selection", () => ((this.dismissed = false), this.refresh()));
    editor.on("tool", () => ((this.dismissed = false), this.refresh()));
    editor.on("layer-current", () => this.refresh());
    editor.on("snap-config", () => this.refresh());
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
    if (ed.multi) {
      const first = ed.selectedItems()[0];
      return { sel: true, multi: true, type: "multi", shape: first?.shape || null, page: ed.model.page(ed.multi.pageId) };
    }
    const sh = ed.selectedShape();
    if (sh) return { sel: true, type: sh.type, shape: sh, page: ed.selectedPage() };
    const type = TOOL_TYPE[ed.tool];
    if (!type) return null;
    return { sel: false, type, shape: null, page: ed.model.page(ed.curPageId) };
  }

  /* ---- 値の読み書き ---- */
  get(ctx, key) {
    const ed = this.ed;
    const sh = ctx.shape ? resolveShape(ctx.shape, ed.model.layers) : ctx.shape; // レイヤーに従う項目はレイヤーの値を表示
    switch (key) {
      case "color":
        if (ctx.type === "text") return sh ? sh.color || sh.style?.color : ed.textStyle.color;
        return sh ? sh.style?.color : ed.style.color;
      case "dash":
        return normDash((sh ? sh.style : ed.style)?.dash);
      case "width":
        if (!sh && ctx.type === "measure") return ed.measureWidth;
        return (sh ? sh.style : ed.style)?.width;
      case "fill":
      case "fillOpacity":
      case "opacity":
        return (sh ? sh.style : ed.style)?.[key];
      case "size":
        if (ctx.type === "dim" || ctx.type === "dimang" || ctx.type === "measure") return sh ? sh.size : ed.dimSize;
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
      case "sweep":
        return sh ? sh.sweep : ed.arc.sweep;
      case "r1":
      case "r2":
        return !!(sh ? sh[key] : ed.arc[key]);
      case "arcRot":
        return sh ? arcAngle(sh) : 0;
      case "radiusMm":
        return sh ? +(dist(sh.pts[0], sh.pts[1]) * PT_MM).toFixed(1) : 0;
      case "endStyle":
        return sh ? sh.endStyle ?? "arrow" : ed.dimEnd.style;
      case "endSize":
        return sh ? sh.endSize ?? (sh.size || 12) / 2 : ed.dimEnd.size;
      case "text":
        return sh?.text ?? "";
      case "dltip":
        return sh?.ltip ?? "none";
      case "angR":
        return sh ? sh.r ?? defaultAngleRadius(...sh.pts) : 0;
      case "ltext":
        return sh?.text ?? "";
      case "lsize":
      case "lbox":
      case "ltip":
      case "ltoff":
      case "ltipSize": {
        const f = LEADER_FIELD[key];
        return sh ? sh[f] ?? LEADER_DEFAULT[f] : ed.leader[f];
      }
      default:
        return undefined;
    }
  }

  apply(ctx, key, value, live) {
    const ed = this.ed;
    if (ctx.sel) {
      ed.updateSelected((sh) => {
        sh.style = sh.style || {};
        if (sh.bl && BL_KEYS.includes(key)) {
          // 個別に指定したら、その項目だけレイヤーに従わなくなる
          sh.bl = sh.bl.filter((k) => k !== key);
          if (!sh.bl.length) delete sh.bl;
        }
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
          case "sweep":
            sh.sweep = clampSweep(value);
            break;
          case "r1":
          case "r2":
            if (value) sh[key] = true;
            else delete sh[key];
            break;
          case "arcRot":
            rotateArcTo(sh, value);
            break;
          case "radiusMm":
            setArcRadius(sh, value / PT_MM);
            break;
          case "endStyle":
          case "endSize":
          case "headSize":
            sh[key] = value;
            break;
          case "dltip":
            if (value === "none") delete sh.ltip;
            else sh.ltip = value;
            break;
          case "angR":
            sh.r = value;
            break;
          case "ltext":
          case "lsize":
          case "lbox":
          case "ltip":
          case "ltoff":
          case "ltipSize":
            sh[LEADER_FIELD[key]] = value;
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
          if (ctx.type === "measure") ed.measureWidth = value;
          else ed.style.width = value;
          break;
        case "fill":
        case "fillOpacity":
        case "dash":
        case "opacity":
          ed.style[key] = value;
          break;
        case "size":
          if (ctx.type === "dim" || ctx.type === "dimang" || ctx.type === "measure") ed.dimSize = value;
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
        case "lsize":
        case "lbox":
        case "ltip":
        case "ltoff":
        case "ltipSize":
          ed.leader[LEADER_FIELD[key]] = value;
          ed.saveDefaults();
          break;
        case "sweep":
          ed.arc.sweep = clampSweep(value);
          ed.saveDefaults();
          break;
        case "r1":
        case "r2":
          ed.arc[key] = !!value;
          ed.saveDefaults();
          break;
        default:
          break;
      }
    }
  }

  /** 選んだ図形の色・太さなどを変えたら、次に作る図形にも引き継ぐ(直前の設定を覚える) */
  carryOver(ctx) {
    if (!ctx?.sel || ctx.multi || !ctx.shape || ctx.type === "image" || ctx.type === "stamp") return;
    this.ed.setDefaultsFrom(ctx.shape);
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
    if (key === "layer") {
      if (!isInput) {
        this.ed.moveSelectedToLayer(v);
        this.refresh();
      }
      return;
    }
    if (key.startsWith("mv:")) {
      const k = key.slice(3);
      if (t.type === "checkbox") this.mv[k] = t.checked;
      else if (Number.isFinite(v)) this.mv[k] = v;
      return;
    }
    if (key === "regN") {
      if (!isInput && Number.isFinite(v)) this.ed.setMode("n", v);
      return;
    }
    if (key.startsWith("snap")) {
      if (isInput && t.type !== "number") return;
      const aid = this.ed.aid;
      if (key === "snapOsnap") {
        aid.setConfig({ osnap: v });
        this.refresh();
      } else if (key === "snapMode") aid.setConfig({ mode: v === "always" ? "always" : "ctrl" });
      else if (key === "snapPolar") {
        aid.setConfig({ polar: v });
        this.refresh();
      } else if (key === "snapPolarMode") aid.setConfig({ polarMode: v === "always" ? "always" : "alt" });
      else if (key === "snapDyn") aid.setConfig({ dyn: v });
      else if (key === "snapStep") {
        if (!isInput && v > 0 && v <= 90) aid.setConfig({ step: v });
      } else if (key.startsWith("snapKind:")) {
        const id = key.slice(9);
        const kinds = aid.cfg.kinds.filter((k) => k !== id);
        if (v) kinds.push(id);
        aid.setConfig({ kinds });
      }
      return;
    }
    if (key.startsWith("num")) {
      if (isInput || !ctx.sel || !Number.isFinite(v) || v < 0) return;
      const k = ctx.page?.scale?.ptsPerUnit || 1;
      this.ed.updateSelected((sh) => {
        const [a, b] = sh.pts;
        if (sh.type === "line" || sh.type === "arrow") {
          const cur = polarOf(a, b);
          if (key === "numLen" && v > 0) sh.pts[1] = pointAt(a, cur.ang, v * k);
          else if (key === "numAng") sh.pts[1] = pointAt(a, v, cur.len);
        } else if (sh.type === "rect" || sh.type === "ellipse") {
          const sx = Math.sign(b[0] - a[0]) || 1;
          const sy = Math.sign(b[1] - a[1]) || 1;
          if (key === "numW" && v > 0) sh.pts[1] = [a[0] + sx * v * k, b[1]];
          else if (key === "numH" && v > 0) sh.pts[1] = [b[0], a[1] + sy * v * k];
        }
      });
      this.refresh();
      return;
    }
    if (key === "curLayer") {
      if (!isInput) this.ed.setCurrentLayer(v);
      return;
    }
    if (key === "bl") {
      if (!isInput) {
        this.ed.setByLayer(BL_KEYS, v);
        this.refresh();
      }
      return;
    }
    if (key === "eraserSize") {
      this.ed.setEraser({ size: v });
      const out = this.el.querySelector('[data-v="eraserSize"]');
      if (out) out.textContent = `${this.ed.eraser.size}px`;
      return;
    }
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
    if (t.type === "number" && (!Number.isFinite(v) || (key !== "angle" && key !== "arcRot" && v <= 0))) return;
    // 入力中は履歴に積まずに反映(ライブ)、確定(change)で1操作として記録する
    this.apply(ctx, key, v, true);
    if (!isInput) {
      this.ed.commitLive();
      this.carryOver(ctx);
    }
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
        this.carryOver(ctx);
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
      case "cmd": {
        const m = this.mv;
        const k = ctx?.page?.scale?.ptsPerUnit || 1;
        const o = { move: {}, copy: {}, rotate: { angle: m.angle, copy: m.rcopy }, scale: { k: m.k, copy: m.scopy }, mirror: { keep: m.keep }, polar: { count: m.count, angle: m.pang, rotateItems: m.protate }, offset: { dist: m.dist * k } }[b.dataset.c];
        ed.startCommand(b.dataset.c, o || {});
        break;
      }
      case "cmd-array": {
        const m = this.mv;
        const k = ctx?.page?.scale?.ptsPerUnit || 1;
        ed.arrayRect(m.rows, m.cols, m.cold * k, m.rowd * k);
        break;
      }
      case "mode":
        ed.setMode(b.dataset.key, b.dataset.v);
        this.refresh();
        break;
      case "rect-side": {
        const side = b.dataset.side;
        ed.updateSelected((sh) => {
          if (sh.type !== "rect") return;
          const h = new Set(sh.hide || []);
          h.has(side) ? h.delete(side) : h.add(side);
          if (h.size) sh.hide = [...h];
          else delete sh.hide;
        });
        this.refresh();
        break;
      }
      case "to-cloud":
        ed.convertToCloud();
        this.refresh();
        break;
      case "eraser-mode":
        ed.setEraser({ mode: b.dataset.mode });
        this.refresh();
        break;
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
        if (ctx.sel && ctx.type === "arc") ed.updateSelected((sh) => rotateArcTo(sh, arcAngle(sh) + 90), { live: false });
        else if (ctx.sel) ed.updateSelected((sh) => rotateTextAbout(sh, (sh.angle || 0) + 90), { live: false });
        this.refresh();
        break;
      case "arc-preset":
        if (ctx) this.apply(ctx, "sweep", +b.dataset.s, false);
        this.refresh();
        break;
      case "text-home":
        if (ctx.sel) ed.updateSelected((sh) => delete sh.textOff, { live: false });
        this.refresh();
        break;
      case "scale-preset":
        if (ctx?.page) ed.emit("scale-preset", { pageId: ctx.page.id });
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
    const modifyBox = () => {
      const sc = ctx.page?.scale;
      const unit = sc?.unit || "pt";
      const m = this.mv;
      const nf = (k, w = 70, step = "any", min = "") => `<input type="number" data-k="mv:${k}" value="${m[k]}" step="${step}"${min !== "" ? ` min="${min}"` : ""} style="width:${w}px;height:34px">`;
      const ck = (k, label) => `<label class="check"><input type="checkbox" data-k="mv:${k}"${m[k] ? " checked" : ""}> ${label}</label>`;
      const single = !ctx.multi;
      return `<details class="modbox field"${this.modOpen ? " open" : ""}><summary style="cursor:pointer;font-weight:600">修正コマンド(基点を指定して動かす・増やす)</summary>
        <div class="field">移動・コピー<div class="actions" style="margin:0"><button class="btn" data-act="cmd" data-c="move">移動</button><button class="btn" data-act="cmd" data-c="copy">コピー</button></div></div>
        <div class="field">回転<div class="row">${nf("angle", 64)}<span>度(右回り)</span></div>${ck("rcopy", "元を残してコピー")}<div class="actions" style="margin:0"><button class="btn" data-act="cmd" data-c="rotate">基点をタップして回転</button></div></div>
        <div class="field">尺度(拡大・縮小)<div class="row">${nf("k", 64, "any", 0.01)}<span>倍</span></div>${ck("scopy", "元を残してコピー")}<div class="actions" style="margin:0"><button class="btn" data-act="cmd" data-c="scale">基点をタップして拡大縮小</button></div></div>
        <div class="field">ミラー複写(線対称に反転)${ck("keep", "元を残す(外すと元を消して反転)")}<div class="actions" style="margin:0"><button class="btn" data-act="cmd" data-c="mirror">軸の2点をタップ</button></div></div>
        <div class="field">配列複写(矩形)<div class="row"><span>行</span>${nf("rows", 56, 1, 1)}<span>列</span>${nf("cols", 56, 1, 1)}</div><div class="row"><span>行の間隔</span>${nf("rowd", 64)}<span>${unit}</span></div><div class="row"><span>列の間隔</span>${nf("cold", 64)}<span>${unit}</span></div><div class="actions" style="margin:0"><button class="btn" data-act="cmd-array">配列する</button></div></div>
        <div class="field">配列複写(円形)<div class="row"><span>個数</span>${nf("count", 56, 1, 2)}<span>全体で</span>${nf("pang", 64)}<span>度</span></div>${ck("protate", "図形も回す")}<div class="actions" style="margin:0"><button class="btn" data-act="cmd" data-c="polar">中心をタップして配列</button></div></div>
        ${single ? `<div class="field">オフセット(平行複写)<div class="row"><span>距離</span>${nf("dist", 70, "any", 0)}<span>${unit}</span></div><div class="actions" style="margin:0"><button class="btn" data-act="cmd" data-c="offset">ずらす側をタップ</button></div></div>` : ""}
      </details>`;
    };
    const ed = this.ed;
    const layers = ed.model.layers;
    const layerSelect = (key, selId, label) =>
      `<label class="field">${label}<select data-k="${key}">${layers.map((l) => `<option value="${esc(l.id)}"${l.id === selId ? " selected" : ""}>${esc(l.name)}${l.visible ? "" : "(非表示)"}</option>`).join("")}</select></label>`;
    const blBox = (shape) =>
      `<label class="check field" style="display:flex"><input type="checkbox" data-k="bl"${BL_KEYS.every((k) => shape?.bl?.includes(k)) ? " checked" : ""}> 色・太さ・線種をレイヤーに従う</label>`;
    const title = { pen: "ペン", line: "線", arrow: "矢印", rect: "四角", ellipse: "丸(楕円)", arc: "円弧", polygon: "多角形", polyline: "ポリライン", cloud: "雲マーク", text: "テキスト", dim: "寸法線", dimang: "角度寸法", leader: "引出線つき文字", measure: "計測", image: "画像・スタンプ・署名", stamp: "スタンプ", eraser: "消しゴム", multi: `複数選択(${ed.multi?.ids.length ?? 0}個)` }[t] || "";
    parts.push(`<div style="display:flex;align-items:center"><h3 style="flex:1">${title}${ctx.sel ? "(選択中)" : t === "eraser" ? "" : "(次に描くもの)"}</h3><button class="btn icon" data-act="close" style="min-height:28px;width:28px" aria-label="閉じる">${icon("x", 16)}</button></div>`);

    if (t === "multi") {
      const cur = (g("color") || "#e11d48").toLowerCase();
      parts.push(`<div class="field">色<div class="swatches">${COLORS.map((c) => `<button class="sw${c === cur ? " on" : ""}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join("")}<input type="color" data-k="color" value="${cur}" aria-label="色を選ぶ"></div></div>`);
      parts.push(num("width", "線の太さ", 0.5, 24, 0.5, (v) => Number(v).toFixed(1)));
      parts.push(`<label class="field">線の種類<select data-k="dash">${DASH_TYPES.map((d) => `<option value="${d.id}"${g("dash") === d.id ? " selected" : ""}>${d.label}</option>`).join("")}</select></label>`);
      parts.push(num("opacity", "不透明度", 0.1, 1, 0.05, (v) => `${Math.round(v * 100)}%`));
      if (ctx.shape) {
        parts.push(layerSelect("layer", layerIdOf(ctx.shape), "レイヤー(まとめて移す)"));
        parts.push(blBox(ctx.shape));
      }
      parts.push(modifyBox());
      parts.push(`<div class="actions">
        <button class="btn" data-act="dup">${icon("copy", 16)}複製</button>
        <button class="btn" data-act="front">前面へ</button>
        <button class="btn" data-act="back">背面へ</button>
        <button class="btn danger" data-act="del">${icon("trash", 16)}削除</button></div>`);
      parts.push(`<p class="hint">どれかをドラッグするとまとめて動きます。Shift(または範囲選択ツールのタップ)で追加・解除、矢印キーで微調整、色や太さの変更は全部に反映されます。</p>`);
      this.el.innerHTML = parts.join("");
      return;
    }

    if (t === "eraser") {
      const er = this.ed.eraser;
      const partial = er.mode === "partial";
      parts.push(`<div class="field">消し方<div class="actions" style="margin:0">
        <button class="btn${partial ? "" : " primary"}" data-act="eraser-mode" data-mode="stroke">線ごと</button>
        <button class="btn${partial ? " primary" : ""}" data-act="eraser-mode" data-mode="partial">なぞった部分</button></div></div>`);
      if (partial) parts.push(`<label class="field">消しゴムの大きさ(円の直径)<div class="row"><input type="range" data-k="eraserSize" min="4" max="120" step="1" value="${er.size}"><span class="val" data-v="eraserSize">${er.size}px</span></div></label>`);
      parts.push(`<p class="hint">${partial ? "ペンで書いた線の、円でなぞった部分だけを消します。線は途中で分かれます。" : "ペンで書いた線に触れると、その線を1本まるごと消します。"}取り消しで戻せます。</p>`);
    }

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
    if (LINE_TYPES.has(t)) parts.push(num("width", "線の太さ", 0.5, 24, 0.5, (v) => Number(v).toFixed(1)));
    if (!ctx.sel) {
      // 作図方法の切り替え(次に描くものだけに効く)
      const M = this.ed.modes;
      const radios = (key, opts) =>
        `<div class="field">描き方<div class="actions" style="margin:0">${opts.map(([v, l]) => `<button class="btn${M[key] === v ? " primary" : ""}" data-act="mode" data-key="${key}" data-v="${v}">${l}</button>`).join("")}</div></div>`;
      if (this.ed.tool === "ellipse") parts.push(radios("ellipse", [["ellipse", "楕円(対角)"], ["circle", "円(中心→半径)"]]));
      else if (this.ed.tool === "arc") parts.push(radios("arc", [["center", "中心と半径"], ["three", "3点"]]));
      else if (this.ed.tool === "polygon") {
        parts.push(radios("poly", [["polygon", "多角形"], ["polyline", "ポリライン"], ["regular", "正多角形"]]));
        if (M.poly === "regular") parts.push(`<label class="field">辺の数<input type="number" data-k="regN" min="3" max="64" step="1" value="${M.n}" style="width:80px;height:34px"></label>`);
      }
    }
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
    if (t === "leader") {
      const sel = (k, label, list) => `<label class="field">${label}<select data-k="${k}">${list.map((o) => `<option value="${o.id}"${g(k) === o.id ? " selected" : ""}>${o.label}</option>`).join("")}</select></label>`;
      if (ctx.sel) parts.push(`<label class="field">文字(空欄なら文字なしの引出線)<input type="text" data-k="ltext" value="${esc(g("ltext"))}" placeholder="例: 1 / 仕上げ材"></label>`);
      parts.push(sel("lbox", "文字の囲み", LEADER_BOXES));
      parts.push(sel("ltip", "引出線の先端", LEADER_TIPS));
      parts.push(num("lsize", "文字の大きさ", 1, 48, 0.5));
      parts.push(num("ltoff", "文字の上下位置(+で下げる・-で上げる)", -12, 12, 0.5, (v) => (v > 0 ? "+" : "") + Number(v).toFixed(1)));
      parts.push(num("ltipSize", "先端(矢印・黒丸)の大きさ", 3, 30, 0.5, (v) => Number(v).toFixed(1)));
    }
    if (t === "arrow") parts.push(num("headSize", "矢印のサイズ(線の太さとは別)", 3, 60, 0.5, (v) => Number(v).toFixed(1)));
    if (t === "cloud") parts.push(num("pitch", "雲のピッチ(円弧の大きさ)", 1, 80, 0.5));
    if (t === "arc") {
      const sw = g("sweep");
      parts.push(`<div class="field">開き角<div class="actions" style="margin:0">${ARC_PRESETS.map((p) => `<button class="btn${sw === p.s ? " primary" : ""}" data-act="arc-preset" data-s="${p.s}">${p.label}</button>`).join("")}</div>
        <div class="row"><input type="range" data-k="sweep" min="1" max="359" step="1" value="${sw}"><input type="number" data-k="sweep" min="1" max="359" step="1" value="${sw}" style="width:70px;height:34px"><span>度</span></div></div>`);
      parts.push(`<div class="field">半径の直線<label class="check"><input type="checkbox" data-k="r1"${g("r1") ? " checked" : ""}> 直線①(中心→始点)を表示</label><label class="check"><input type="checkbox" data-k="r2"${g("r2") ? " checked" : ""}> 直線②(中心→終点)を表示</label></div>`);
      if (ctx.sel) {
        const ang = g("arcRot");
        parts.push(`<label class="field">半径(mm・用紙上)<input type="number" data-k="radiusMm" min="0.5" max="2000" step="0.5" value="${g("radiusMm")}" style="width:90px;height:34px"></label>`);
        parts.push(`<label class="field">回転(度)<div class="row"><input type="range" data-k="arcRot" min="0" max="359" step="1" value="${ang}"><input type="number" data-k="arcRot" min="0" max="359" step="1" value="${ang}" style="width:70px;height:34px"></div></label>`);
        parts.push(`<div class="actions"><button class="btn" data-act="rot90">90°回す</button></div>`);
      }
    }
    if (t === "text") {
      const size = g("size") || 18;
      parts.push(`<label class="field">文字サイズ<div class="row"><input type="range" data-k="size" min="1" max="120" step="0.5" value="${size}"><input type="number" data-k="size" min="1" max="400" step="0.5" value="${size}" style="width:70px;height:34px"></div></label>`);
      parts.push(`<label class="field">フォント<select data-k="font">${FONTS.map((f) => `<option value="${f.id}"${(g("font") || "gothic") === f.id ? " selected" : ""} style="font-family:${f.css.replace(/"/g, "'")}">${f.label}</option>`).join("")}</select></label>`);
      parts.push(`<label class="field check" style="display:flex"><input type="checkbox" data-k="bold"${g("bold") ? " checked" : ""}> 太字</label>`);
      if (ctx.sel) {
        const ang = g("angle");
        parts.push(`<label class="field">回転(度)<div class="row"><input type="range" data-k="angle" min="0" max="359" step="1" value="${ang}"><input type="number" data-k="angle" min="0" max="359" step="1" value="${ang}" style="width:70px;height:34px"></div></label>`);
        parts.push(`<div class="actions"><button class="btn" data-act="edit-text">文字を編集</button><button class="btn" data-act="rot90">90°回す</button></div>`);
      }
    }
    if (t === "dim" || t === "dimang" || t === "measure") {
      parts.push(num("size", "文字サイズ", 1, 48, 0.5));
      parts.push(`<label class="field">寸法線の端部<select data-k="endStyle"><option value="dot"${g("endStyle") === "dot" ? " selected" : ""}>黒丸</option><option value="arrow"${g("endStyle") === "arrow" ? " selected" : ""}>矢印</option></select></label>`);
      parts.push(num("endSize", "端部のサイズ", 1, 20, 0.5, (v) => Number(v).toFixed(1)));
      if (ctx.sel && ctx.shape.textOff) {
        parts.push(`<label class="field">寸法値の引出線の先端<select data-k="dltip"><option value="none"${g("dltip") === "none" ? " selected" : ""}>なし</option><option value="dot"${g("dltip") === "dot" ? " selected" : ""}>黒丸</option><option value="arrow"${g("dltip") === "arrow" ? " selected" : ""}>矢印</option></select></label>`);
        parts.push(`<div class="actions"><button class="btn" data-act="text-home">寸法値を元の位置へ戻す</button></div>`);
      }
      if (t === "dimang" && ctx.sel) {
        parts.push(num("angR", "円弧の半径", 8, 400, 1, (v) => Number(v).toFixed(0)));
        parts.push(`<label class="field">角度の文字(空欄で自動計算)<input type="text" data-k="text" value="${esc(g("text"))}" placeholder="${esc(angleLabel(angleBetween(...ctx.shape.pts) ?? 0))}"></label>`);
      }
      if (t === "dim" && ctx.sel) parts.push(`<label class="field">寸法の文字(自由に入力)<input type="text" data-k="text" value="${esc(g("text"))}" placeholder="例: 3,600"></label>`);
      if (t === "measure" && ctx.sel) parts.push(`<p class="hint">計測値: <b>${esc(this.ed.labelOf(ctx.shape, ctx.page))}</b>(縮尺に基づく参考値)</p>`);
    }
    if (t === "dim" || t === "measure") {
      const pg = ctx.page;
      const sc = pg?.scale;
      parts.push(`<div class="field"><b style="color:var(--ink)">このページの縮尺</b><span>${sc ? `設定済み: ${sc.denom ? `${sc.paper || "このページ"} 1/${sc.denom}(` : "("}1 ${sc.unit} = ${sc.ptsPerUnit.toFixed(3)} pt)` : "未設定(「縮尺設定」ツールで基準の2点をなぞるか、用紙と縮尺を数値で設定します)"}</span></div>
        <div class="actions"><button class="btn" data-act="scale-preset">用紙と縮尺(1/〇〇)で設定</button></div>
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
    if (ctx.sel && ctx.shape && ["line", "arrow", "rect", "ellipse"].includes(t) && ctx.shape.pts.length === 2) {
      // 数値で大きさを決める(最初の点を固定したまま変える)
      const sc = ctx.page?.scale;
      const k = sc?.ptsPerUnit || 1;
      const unit = sc?.unit || "pt";
      const fmt = (x) => +(x / k).toFixed(sc ? 1 : 2);
      const [a, b] = ctx.shape.pts;
      const f = (key, label, val, extra = "") => `<label class="field">${label}<div class="row"><input type="number" data-k="${key}" min="0" step="any" value="${val}" style="width:96px;height:34px"> <span class="val">${extra || unit}</span></div></label>`;
      if (t === "line" || t === "arrow") {
        const pl = polarOf(a, b);
        parts.push(f("numLen", "長さ(最初の点から)", fmt(pl.len)) + f("numAng", "角度(右が0°・上向きが+)", +(((pl.ang % 360) + 360) % 360).toFixed(1), "°"));
      } else {
        parts.push(f("numW", "幅", fmt(Math.abs(b[0] - a[0]))) + f("numH", "高さ", fmt(Math.abs(b[1] - a[1]))));
      }
    }
    if (ctx.sel && ctx.shape) {
      parts.push(layerSelect("layer", layerIdOf(ctx.shape), "レイヤー"));
      if (t !== "image") parts.push(blBox(ctx.shape));
    }
    if (ctx.sel) {
      if (t !== "image" && t !== "stamp") parts.push(`<div class="actions"><button class="btn" data-act="set-default">${icon("check", 16)}この設定を初期設定にする</button></div>`);
      parts.push(modifyBox());
      parts.push(`<div class="actions">
        <button class="btn" data-act="dup">${icon("copy", 16)}複製</button>
        <button class="btn" data-act="front">前面へ</button>
        <button class="btn" data-act="back">背面へ</button>
        <button class="btn danger" data-act="del">${icon("trash", 16)}削除</button></div>`);
      if (t === "polygon" || t === "polyline" || t === "cloud") parts.push(`<p class="hint">頂点をドラッグで移動、辺の中点の四角をドラッグで辺ごと移動、辺をダブルタップで頂点を追加、頂点をダブルタップで削除できます。</p>`);
      if (t === "rect") parts.push(`<p class="hint">四隅の丸で大きさ、各辺の中点の四角で辺ごと動かせます。</p>`);
      if (t === "rect" && ctx.sel && ctx.shape) {
        const hide = ctx.shape.hide || [];
        const edge = (side, x1, y1, x2, y2) => {
          const off = hide.includes(side);
          return `<g data-act="rect-side" data-side="${side}" style="cursor:pointer"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${off ? "#9ca3af" : "#2563eb"}" stroke-width="${off ? 2 : 4}"${off ? ' stroke-dasharray="3 4"' : ""} stroke-linecap="round"/><rect x="${Math.min(x1, x2) - 8}" y="${Math.min(y1, y2) - 8}" width="${Math.abs(x2 - x1) + 16}" height="${Math.abs(y2 - y1) + 16}" fill="transparent"/></g>`;
        };
        parts.push(`<div class="field">線の表示(辺をクリックで切り替え)<svg viewBox="0 0 120 80" width="120" height="80" role="group" aria-label="四角の辺"><rect x="20" y="16" width="80" height="48" fill="rgba(37,99,235,.10)"/>${edge("t", 20, 16, 100, 16)}${edge("r", 100, 16, 100, 64)}${edge("b", 20, 64, 100, 64)}${edge("l", 20, 16, 20, 64)}</svg><p class="hint">青い実線が表示、灰色の点線が非表示です。塗りつぶしは辺を隠しても残ります。</p></div>`);
      }
      if (["rect", "ellipse", "polygon"].includes(t)) parts.push(`<div class="actions"><button class="btn" data-act="to-cloud">雲マークに変換</button></div>`);
      if (t === "arc") parts.push(`<p class="hint">両端の丸で開き角、弧の中央の四角で大きさ、外側の丸で回転できます。常に正円のままです。</p>`);
    }
    if (!ctx.sel && (LINE_TYPES.has(t) || TEXT_LIKE.has(t))) {
      parts.push(layerSelect("curLayer", ed.model.curLayer, "描く先のレイヤー"));
      if (ed.model.curLayer !== "0") parts.push(`<p class="hint">0以外のレイヤーに描いた図形は、色・太さ・線種がレイヤーの設定に従います(あとから個別に変えることもできます)。</p>`);
    }
    if (!ctx.sel && t !== "eraser" && t !== "stamp" && (LINE_TYPES.has(t) || TEXT_LIKE.has(t))) {
      const c = ed.aid.cfg;
      parts.push(`<details class="snapbox"><summary>スナップ・数値入力</summary>
        <label class="check"><input type="checkbox" data-k="snapOsnap"${c.osnap ? " checked" : ""}> オブジェクトスナップ(F3)</label>
        <label class="field">吸着するとき<select data-k="snapMode"${c.osnap ? "" : " disabled"}><option value="ctrl"${c.mode === "ctrl" ? " selected" : ""}>Ctrl(Macは⌘)を押している間だけ(指では常に)</option><option value="always"${c.mode === "always" ? " selected" : ""}>常に</option></select></label>
        <div class="snapkinds">${SNAP_KINDS.map((x) => `<label class="check"><input type="checkbox" data-k="snapKind:${x.id}"${c.kinds.includes(x.id) ? " checked" : ""}${c.osnap ? "" : " disabled"}> ${x.label}</label>`).join("")}</div>
        <label class="check"><input type="checkbox" data-k="snapPolar"${c.polar ? " checked" : ""}> 極トラッキング(F10)</label>
        <label class="field">角度に合わせるとき<select data-k="snapPolarMode"${c.polar ? "" : " disabled"}><option value="alt"${c.polarMode !== "always" ? " selected" : ""}>Altを押している間だけ(指では常に)</option><option value="always"${c.polarMode === "always" ? " selected" : ""}>常に</option></select></label>
        <label class="field">角度の刻み(度)<input type="number" data-k="snapStep" min="1" max="90" step="0.5" value="${c.step}" style="width:90px;height:34px"></label>
        <label class="check"><input type="checkbox" data-k="snapDyn"${c.dyn ? " checked" : ""}> 数値入力(線・矢印・四角・丸は、クリックしてから長さなどを入力)</label>
        <p class="hint">Shift を押しながら描くと 90° 刻みに固定します。ドラッグで描くとそのまま描け、クリックだけにすると数値入力になります。</p></details>`);
    }
    this.el.innerHTML = parts.join("");
  }
}
