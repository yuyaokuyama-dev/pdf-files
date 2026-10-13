// 保存PDFに入れる「編集用データ」(図形とレイヤー)の作成・読み取り(DOM非依存の部分は node でテスト可能)
// 図形はPDF内の専用レイヤー(OCG)に描き、同じ内容を圧縮して添付ファイルにも入れる。
// このアプリで開くと添付から図形を復元し、専用レイヤーは非表示にして二重に見えないようにする。
import { baseLayer, BASE_LAYER_ID, newLayerId } from "./layers.js";

export const EDIT_FILE = "pdffiles-edit.bin";
export const OC_PREFIX = "PDF Files/";
const VERSION = 1;

async function through(bytes, stream) {
  const w = stream.writable.getWriter();
  w.write(bytes).catch(() => {}); // 壊れたデータは読み出し側のエラーで扱う
  w.close().catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** 編集用データ → 圧縮したバイト列 */
export async function packEdit(payload) {
  const raw = new TextEncoder().encode(JSON.stringify({ v: VERSION, ...payload }));
  return through(raw, new CompressionStream("deflate"));
}
/** 圧縮したバイト列 → 編集用データ。壊れていれば null */
export async function unpackEdit(bytes) {
  try {
    const raw = await through(bytes, new DecompressionStream("deflate"));
    const d = JSON.parse(new TextDecoder().decode(raw));
    if (!d || d.v !== VERSION || !Array.isArray(d.pages)) return null;
    return d;
  } catch {
    return null;
  }
}

/** pdf.js のドキュメントから編集用データを読む。無ければ null */
export async function readEdit(pdf) {
  try {
    const att = await pdf.getAttachments();
    let content;
    if (att instanceof Map) {
      const a = att.get(EDIT_FILE);
      if (!a) return null;
      const c = await pdf.getAttachmentContent(a.rawFilename);
      content = c?.content ?? c;
    } else content = att?.[EDIT_FILE]?.content; // 古い版の pdf.js
    return content ? await unpackEdit(content instanceof Uint8Array ? content : new Uint8Array(content)) : null;
  } catch {
    return null;
  }
}

/** 描画時に専用レイヤーを隠す設定(pdf.js の render に渡す)。失敗したら undefined */
export function hideEditLayers(pdf) {
  return pdf
    .getOptionalContentConfig()
    .then((cfg) => {
      for (const [id, group] of cfg) if (String(group?.name || "").startsWith(OC_PREFIX)) cfg.setVisibility(id, false);
      return cfg;
    })
    .catch(() => undefined);
}

/** pdf.js のページを取得(編集用レイヤーを隠す設定つき) */
export async function pageOf(pdf, n) {
  const pg = await pdf.getPage(n);
  if (pdf.pfOc) pg.pfOc = pdf.pfOc;
  return pg;
}

/**
 * 読み込んだレイヤーを、いまのレイヤーに合わせて取り込む。
 * 同じ id・同じ名前なら共有、id だけ同じで別物なら新しい id を振る。{ layers, idMap }
 */
export function mergeLayers(docLayers, incoming) {
  const layers = docLayers.length ? docLayers.map((l) => ({ ...l })) : [baseLayer()];
  const idMap = new Map();
  for (const l of Array.isArray(incoming) ? incoming : []) {
    if (!l || typeof l.id !== "string") continue;
    if (l.id === BASE_LAYER_ID) {
      idMap.set(l.id, BASE_LAYER_ID);
      continue;
    }
    const same = layers.find((x) => x.id === l.id && x.name === l.name);
    if (same) {
      idMap.set(l.id, same.id);
      continue;
    }
    const byName = layers.find((x) => x.name === l.name && x.id !== BASE_LAYER_ID);
    if (byName) {
      idMap.set(l.id, byName.id);
      continue;
    }
    const nid = layers.some((x) => x.id === l.id) ? newLayerId(layers) : l.id;
    layers.push({ ...baseLayer(), ...l, id: nid, name: String(l.name ?? nid) });
    idMap.set(l.id, nid);
  }
  return { layers, idMap };
}

/** ページごとの図形を、レイヤーidの付け替えをして返す(読み込んだデータは触らない) */
export function remapShapes(shapes, idMap) {
  return (Array.isArray(shapes) ? shapes : [])
    .filter((s) => s && typeof s.type === "string" && Array.isArray(s.pts))
    .map((s) => {
      const c = JSON.parse(JSON.stringify(s));
      if (c.layer) {
        const m = idMap.get(c.layer);
        if (m && m !== BASE_LAYER_ID) c.layer = m;
        else delete c.layer;
      }
      return c;
    });
}
