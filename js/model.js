// ドキュメントモデル: 取り込んだPDF(sources)・ページ構成(pages)・画像(images)・取り消し履歴。
import { uid } from "./store.js";
import { readEdit, hideEditLayers, mergeLayers, remapShapes } from "./editdata.js";
import { baseLayer, newLayerId, uniqueName, normalizeLayers, deleteLayerFrom, stampNewShape, BASE_LAYER_ID } from "./layers.js";

export const A4 = { w: 595.28, h: 841.89 };
const HISTORY_MAX = 100;

export class DocModel {
  constructor() {
    this.sources = new Map(); // srcId → { id, name, bytes, pdf(pdf.js doc) }
    this.pages = [];          // { id, srcId|null, srcIndex, rot, w, h, shapes[], scale }
    this.images = new Map();  // imgId → dataURL
    this.layers = [baseLayer()]; // レイヤー(全ページ共通)。図形は shape.layer で所属を持つ
    this.curLayer = BASE_LAYER_ID; // 次に描く図形が入るレイヤー(取り消しの対象外)
    this.meta = { name: "無題.pdf", driveId: null, driveFolder: null, projectId: uid(), createdAt: Date.now() };
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.dirty = false;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(kind = "change") {
    for (const fn of this.listeners) fn(kind);
  }

  /* ---------- スナップショット(取り消し/やり直し) ---------- */
  snapshot() {
    return JSON.stringify({ pages: this.pages, layers: this.layers });
  }
  applySnapshot(s) {
    const d = JSON.parse(s);
    this.pages = d.pages;
    this.layers = d.layers;
    if (!this.layers.some((l) => l.id === this.curLayer)) this.curLayer = BASE_LAYER_ID;
  }
  /** 変更を確定する(直前の状態を履歴に積む)。before は変更前のスナップショット */
  commit(before) {
    const after = this.snapshot();
    if (before === after) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.dirty = true;
    this.emit("commit");
    return true;
  }
  /** fn の中で行った変更を1操作として履歴に記録する */
  mutate(fn) {
    const before = this.snapshot();
    const r = fn();
    this.commit(before);
    return r;
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    this.applySnapshot(this.undoStack.pop());
    this.dirty = true;
    this.emit("restore");
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    this.applySnapshot(this.redoStack.pop());
    this.dirty = true;
    this.emit("restore");
    return true;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /* ---------- 取り込み ---------- */
  /** pdfDoc: pdf.js のドキュメント。ページ構成に追加する(atIndex 省略で末尾) */
  async addSource({ name, bytes, pdf }, atIndex) {
    const id = "s" + uid();
    this.sources.set(id, { id, name, bytes, pdf });
    // 「編集用データ」入りで保存したPDFなら、図形とレイヤーを編集できる状態で戻す
    const edit = await readEdit(pdf);
    const restored = !!edit && edit.pages.length === pdf.numPages;
    let idMap = new Map();
    if (restored) {
      const m = mergeLayers(this.layers, edit.layers);
      this.layers = m.layers;
      idMap = m.idMap;
      this.sources.get(id).edit = true;
      pdf.pfOc = hideEditLayers(pdf);
      for (const [iid, url] of Object.entries(edit.images || {})) if (typeof url === "string" && !this.images.has(iid)) this.images.set(iid, url);
    }
    const pages = [];
    for (let i = 0; i < pdf.numPages; i++) {
      const pg = await pdf.getPage(i + 1);
      const vp = pg.getViewport({ scale: 1 });
      const ed = restored ? edit.pages[i] : null;
      pages.push({
        id: "p" + uid() + i, srcId: id, srcIndex: i, rot: 0, w: vp.width, h: vp.height, baseRot: pg.rotate || 0,
        shapes: ed ? remapShapes(ed.shapes, idMap) : [], scale: ed?.scale ?? null,
      });
    }
    if (atIndex == null) this.pages.push(...pages);
    else this.pages.splice(atIndex, 0, ...pages);
    return pages;
  }

  addImage(dataUrl) {
    const id = "i" + uid();
    this.images.set(id, dataUrl);
    return id;
  }

  /* ---------- ページ操作 ---------- */
  page(id) {
    return this.pages.find((p) => p.id === id);
  }
  indexOf(id) {
    return this.pages.findIndex((p) => p.id === id);
  }
  insertBlank(atIndex, size = A4) {
    const p = { id: "p" + uid(), srcId: null, srcIndex: 0, rot: 0, baseRot: 0, w: size.w, h: size.h, shapes: [], scale: null };
    this.mutate(() => this.pages.splice(atIndex, 0, p));
    return p;
  }
  deletePages(ids) {
    if (ids.length >= this.pages.length) return false; // 最後の1ページは消さない
    this.mutate(() => {
      this.pages = this.pages.filter((p) => !ids.includes(p.id));
    });
    return true;
  }
  movePage(id, toIndex) {
    const from = this.indexOf(id);
    if (from < 0 || toIndex < 0 || toIndex >= this.pages.length || from === toIndex) return false;
    this.mutate(() => {
      const [p] = this.pages.splice(from, 1);
      this.pages.splice(toIndex, 0, p);
    });
    return true;
  }
  /** 複数ページをまとめて挿入位置 at(移動前の並びで、そのページの前。末尾は pages.length)へ移す。並びは文書順のまま */
  movePages(ids, at) {
    const set = new Set(ids);
    const moving = this.pages.filter((p) => set.has(p.id));
    if (!moving.length) return false;
    const rest = this.pages.filter((p) => !set.has(p.id));
    const to = this.pages.slice(0, at).filter((p) => !set.has(p.id)).length;
    const next = [...rest.slice(0, to), ...moving, ...rest.slice(to)];
    if (next.every((p, i) => p === this.pages[i])) return false;
    this.mutate(() => {
      this.pages = next;
    });
    return true;
  }
  rotatePage(id, delta = 90) {
    const p = this.page(id);
    if (!p) return;
    this.mutate(() => {
      // 図形の座標系が変わるので、図形も一緒に回す
      const k = (((delta % 360) + 360) % 360) / 90;
      for (let n = 0; n < k; n++) {
        const W = p.w;
        const H = p.h;
        const rot = ([x, y]) => [H - y, x]; // 時計回り90度(新しい幅=H)
        for (const sh of p.shapes) {
          sh.pts = sh.pts.map(rot);
          if (sh.type === "text") sh.angle = ((sh.angle || 0) + 90) % 360;
          if (sh.textOff) sh.textOff = [-sh.textOff[1], sh.textOff[0]]; // 寸法値の移動量(ベクトル)も回す
        }
        p.w = H;
        p.h = W;
        p.rot = (p.rot + 90) % 360;
      }
    });
  }

  /* ---------- 図形操作 ---------- */
  addShape(pageId, shape) {
    const p = this.page(pageId);
    if (!p) return null;
    shape.id = shape.id || "h" + uid();
    if (!shape.layer) stampNewShape(shape, this.curLayer);
    this.mutate(() => p.shapes.push(shape));
    return shape;
  }
  removeShape(pageId, shapeId) {
    const p = this.page(pageId);
    if (!p) return;
    this.mutate(() => {
      p.shapes = p.shapes.filter((s) => s.id !== shapeId);
    });
  }
  removeShapes(pageId, ids) {
    const p = this.page(pageId);
    if (!p) return;
    const set = new Set(ids);
    this.mutate(() => {
      p.shapes = p.shapes.filter((s) => !set.has(s.id));
    });
  }
  findShape(shapeId) {
    for (const p of this.pages) {
      const s = p.shapes.find((x) => x.id === shapeId);
      if (s) return { page: p, shape: s };
    }
    return null;
  }

  /* ---------- レイヤー ---------- */
  layer(id) {
    return this.layers.find((l) => l.id === id);
  }
  addLayer(name) {
    const l = { ...baseLayer(), id: newLayerId(this.layers), name: (name || "").trim() || uniqueName(this.layers) };
    this.mutate(() => this.layers.push(l));
    return l;
  }
  /** レイヤーとその図形を削除する(取り消しで戻せる)。消した図形の数を返す */
  deleteLayer(id) {
    let n = -1;
    this.mutate(() => {
      n = deleteLayerFrom(this.pages, this.layers, id);
    });
    if (this.curLayer === id) this.curLayer = BASE_LAYER_ID;
    return n;
  }
  /** レイヤーの設定を変更する(取り消しで戻せる) */
  updateLayer(id, patch) {
    const l = this.layer(id);
    if (!l) return;
    this.mutate(() => Object.assign(l, patch));
  }
  layerCount(id) {
    let n = 0;
    for (const p of this.pages) for (const s of p.shapes) if ((s.layer || BASE_LAYER_ID) === id) n++;
    return n;
  }

  /* ---------- 永続化 ---------- */
  serialize() {
    return {
      id: this.meta.projectId,
      meta: { ...this.meta },
      sources: [...this.sources.values()].map((s) => ({ id: s.id, name: s.name, bytes: s.bytes, ...(s.edit ? { edit: true } : {}) })),
      pages: this.pages,
      images: [...this.images.entries()],
      layers: this.layers,
      updatedAt: Date.now(),
    };
  }
  /** 保存データから復元。loadPdf(bytes) は pdf.js ドキュメントを返す関数 */
  static async restore(data, loadPdf) {
    const m = new DocModel();
    m.meta = { ...m.meta, ...data.meta, projectId: data.id };
    for (const s of data.sources) {
      const pdf = await loadPdf(s.bytes);
      if (s.edit) pdf.pfOc = hideEditLayers(pdf);
      m.sources.set(s.id, { id: s.id, name: s.name, bytes: s.bytes, pdf, ...(s.edit ? { edit: true } : {}) });
    }
    m.pages = data.pages;
    m.images = new Map(data.images);
    m.layers = normalizeLayers(data.layers);
    return m;
  }
  /** 未使用の画像・ソースを掃除(保存サイズ削減) */
  prune() {
    const used = new Set();
    for (const p of this.pages) for (const s of p.shapes) if (s.imgId) used.add(s.imgId);
    const usedSrc = new Set(this.pages.map((p) => p.srcId).filter(Boolean));
    // 取り消し履歴が参照しうるので、履歴がある間は消さない
    if (this.undoStack.length || this.redoStack.length) return;
    for (const id of [...this.images.keys()]) if (!used.has(id)) this.images.delete(id);
    for (const id of [...this.sources.keys()]) if (!usedSrc.has(id)) this.sources.delete(id);
  }
}
