// レイヤー(DOM非依存・node でテスト可能)
// 図形は shape.layer にレイヤーidを持つ。色・線の太さ・線種は shape.bl に挙げた項目だけ「レイヤーに従う」。

export const BASE_LAYER_ID = "0";
export const BL_KEYS = ["color", "width", "dash"];

export function baseLayer() {
  return { id: BASE_LAYER_ID, name: "0", color: "#111827", width: 1, dash: "", visible: true, locked: false };
}

export function newLayerId(layers) {
  let n = layers.length;
  while (layers.some((l) => l.id === `L${n}`)) n++;
  return `L${n}`;
}

/** 新しいレイヤー名(「レイヤー1」「レイヤー2」…で重ならないもの) */
export function uniqueName(layers, base = "レイヤー") {
  let n = 1;
  while (layers.some((l) => l.name === `${base}${n}`)) n++;
  return `${base}${n}`;
}

export function findLayer(layers, id) {
  return layers.find((l) => l.id === id) || layers.find((l) => l.id === BASE_LAYER_ID) || baseLayer();
}

export const layerIdOf = (shape) => shape.layer || BASE_LAYER_ID;

/** 図形の色・太さ・線種に、レイヤーの設定を反映した複製を返す(表示・書き出し用) */
export function resolveShape(shape, layers) {
  const bl = shape.bl;
  if (!bl || !bl.length) return shape;
  const L = findLayer(layers, layerIdOf(shape));
  const style = { ...(shape.style || {}) };
  const out = { ...shape, style };
  if (bl.includes("color")) {
    style.color = L.color;
    if (shape.type === "text") out.color = L.color;
  }
  if (bl.includes("width")) style.width = L.width;
  if (bl.includes("dash")) style.dash = L.dash || false;
  return out;
}

/** 表示する図形だけを、レイヤー設定を反映して返す。layers 未指定なら何もしない */
export function visibleShapes(shapes, layers) {
  if (!layers) return shapes;
  const hidden = new Set(layers.filter((l) => !l.visible).map((l) => l.id));
  const out = [];
  for (const sh of shapes) {
    if (hidden.has(layerIdOf(sh))) continue;
    out.push(resolveShape(sh, layers));
  }
  return out;
}

export function isLayerLocked(shape, layers) {
  return !!findLayer(layers, layerIdOf(shape)).locked;
}
export function isLayerVisible(shape, layers) {
  return !!findLayer(layers, layerIdOf(shape)).visible;
}

/** 新しく描く図形に付ける設定。基本レイヤー以外では色・太さ・線種をレイヤーに従わせる */
export function stampNewShape(shape, layerId) {
  if (layerId && layerId !== BASE_LAYER_ID) shape.layer = layerId; // 基本レイヤーは省略(保存を小さく)
  else delete shape.layer;
  if (layerId !== BASE_LAYER_ID && shape.type !== "image") shape.bl = [...BL_KEYS];
  else delete shape.bl;
  return shape;
}

/** レイヤーを削除する。その図形も削除する。基本レイヤー(0)は消せない。消した図形の数を返す */
export function deleteLayerFrom(pages, layers, id) {
  if (id === BASE_LAYER_ID) return -1;
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0) return -1;
  layers.splice(i, 1);
  let n = 0;
  for (const p of pages) {
    const before = p.shapes.length;
    p.shapes = p.shapes.filter((s) => layerIdOf(s) !== id);
    n += before - p.shapes.length;
  }
  return n;
}

/** 保存データから読み込んだレイヤーを整える(無い・壊れている場合は基本レイヤーだけにする) */
export function normalizeLayers(raw) {
  const out = [];
  if (Array.isArray(raw)) {
    for (const l of raw) {
      if (!l || typeof l.id !== "string" || out.some((x) => x.id === l.id)) continue;
      out.push({ ...baseLayer(), ...l, id: l.id, name: String(l.name ?? l.id) });
    }
  }
  if (!out.some((l) => l.id === BASE_LAYER_ID)) out.unshift(baseLayer());
  return out;
}
