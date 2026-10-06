// 編集内容をPDFに書き出す。図形はベクターのまま、文字は画像化(日本語・任意フォント対応)して焼き込む。
import { PDFDocument, degrees, rgb, LineCapStyle } from "../vendor/pdf-lib.esm.min.js";
import {
  linePath, polygonPath, ellipsePath, cloudPath, arrowHead, arrowShaft, smoothPath,
  dimensionGeometry, rectPoints,
} from "./geometry.js";
import { textMetrics, labelFor, serializeOverlay } from "./render.js";
import { TEXT_LINE } from "./render.js";
import { renderTextPng, recompressImage, renderPageJpeg } from "./raster.js";

/** 最適化レベル */
export const LEVELS = {
  standard: { label: "標準(画質優先)", maxDim: 2400, quality: 0.88 },
  small: { label: "軽量(おすすめ)", maxDim: 1600, quality: 0.72 },
  tiny: { label: "最小(ページを画像化・文字選択不可)", rasterize: true, dpi: 130, quality: 0.6 },
};

const hexToRgb = (hex = "#000000") => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return rgb(parseInt(n.slice(0, 2), 16) / 255, parseInt(n.slice(2, 4), 16) / 255, parseInt(n.slice(4, 6), 16) / 255);
};

/** 表示座標(左上原点・回転後) → PDFのユーザー空間への変換器を作る */
export function makeViewMapper(box, R) {
  const { x: cx, y: cy, width: W0, height: H0 } = box;
  switch (R) {
    case 90: return { origin: [cx, cy], toUser: (vx, vy) => [cx + vy, cy + vx] };
    case 180: return { origin: [cx + W0, cy], toUser: (vx, vy) => [cx + W0 - vx, cy + vy] };
    case 270: return { origin: [cx + W0, cy + H0], toUser: (vx, vy) => [cx + W0 - vy, cy + H0 - vx] };
    default: return { origin: [cx, cy + H0], toUser: (vx, vy) => [cx + vx, cy + H0 - vy] };
  }
}

export async function exportPdf(doc, { level = "small", onProgress } = {}) {
  const cfg = LEVELS[level] || LEVELS.small;
  const out = await PDFDocument.create();
  out.setTitle(doc.meta.name.replace(/\.pdf$/i, ""));
  out.setProducer("PDF Files");
  out.setCreator("PDF Files");
  const srcCache = new Map();
  const loadSrc = async (id) => {
    if (!srcCache.has(id)) srcCache.set(id, await PDFDocument.load(doc.sources.get(id).bytes, { ignoreEncryption: true, updateMetadata: false }));
    return srcCache.get(id);
  };
  const imgCache = new Map();
  const textCache = new Map();
  const embedImage = async (imgId) => {
    if (imgCache.has(imgId)) return imgCache.get(imgId);
    const url = doc.images.get(imgId);
    if (!url) return null;
    const r = await recompressImage(url, { maxDim: cfg.maxDim || 2400, quality: cfg.quality });
    const e = r.type === "png" ? await out.embedPng(r.bytes) : await out.embedJpg(r.bytes);
    imgCache.set(imgId, e);
    return e;
  };

  let n = 0;
  for (const page of doc.pages) {
    onProgress?.(n++ / doc.pages.length, `ページ ${n}/${doc.pages.length}`);
    if (cfg.rasterize) {
      const src = page.srcId ? doc.sources.get(page.srcId) : null;
      const pdfPage = src ? await src.pdf.getPage(page.srcIndex + 1) : null;
      const overlaySvg = page.shapes.length ? serializeOverlay(page, doc.images, page.w, page.h) : null;
      const r = await renderPageJpeg({
        pdfPage, rotation: ((page.baseRot || 0) + page.rot) % 360, w: page.w, h: page.h, overlaySvg, dpi: cfg.dpi, quality: cfg.quality,
      });
      const pg = out.addPage([page.w, page.h]);
      const img = await out.embedJpg(r.bytes);
      pg.drawImage(img, { x: 0, y: 0, width: page.w, height: page.h });
      continue;
    }

    let pg;
    let R = 0;
    if (page.srcId) {
      const src = await loadSrc(page.srcId);
      [pg] = await out.copyPages(src, [page.srcIndex]);
      out.addPage(pg);
      R = (((page.baseRot || 0) + page.rot) % 360 + 360) % 360;
      pg.setRotation(degrees(R));
    } else {
      pg = out.addPage([page.w, page.h]);
    }
    if (!page.shapes.length) continue;

    const box = typeof pg.getCropBox === "function" ? pg.getCropBox() : pg.getMediaBox();
    const map = makeViewMapper(box, R);
    const [ox, oy] = map.origin;

    const path = (d, o = {}) =>
      pg.drawSvgPath(d, {
        x: ox, y: oy, scale: 1, rotate: degrees(R),
        borderLineCap: LineCapStyle.Round,
        ...o,
      });

    /** 画像(または文字PNG)を表示座標で配置。tl: 左上(表示座標)、ang: 左上を軸に時計回りの角度 */
    const placeImage = (emb, tl, w, h, ang = 0) => {
      const a = (ang * Math.PI) / 180;
      const bl = [tl[0] + -h * Math.sin(a), tl[1] + h * Math.cos(a)]; // 左下(表示座標)
      const [ux, uy] = map.toUser(bl[0], bl[1]);
      pg.drawImage(emb, { x: ux, y: uy, width: w, height: h, rotate: degrees(R - ang) });
    };

    const placeText = async (spec, tl, ang = 0) => {
      const key = JSON.stringify(spec);
      let emb = textCache.get(key);
      if (!emb) {
        const bytes = await renderTextPng(spec, 4);
        emb = await out.embedPng(bytes);
        textCache.set(key, emb);
      }
      placeImage(emb, tl, spec.w, spec.h, ang);
    };

    for (const sh of page.shapes) {
      const st = sh.style || {};
      const color = hexToRgb(st.color || "#e11d48");
      const width = st.width ?? 2;
      const hasFill = st.fill && st.fill !== "none";
      const strokeOpts = {
        borderColor: color, borderWidth: width, borderOpacity: st.opacity ?? 1,
        ...(st.dash ? { borderDashArray: [width * 3, width * 2] } : {}),
      };
      const fillOpts = hasFill ? { color: hexToRgb(st.fill), opacity: st.fillOpacity ?? 0.25 } : {};
      switch (sh.type) {
        case "line":
          path(linePath(sh.pts), strokeOpts);
          break;
        case "arrow": {
          const size = Math.max(10, width * 4.5);
          const [a, b] = sh.pts;
          path(linePath(arrowShaft(a, b, size)), strokeOpts);
          path(polygonPath(arrowHead(a, b, size)), { color, opacity: st.opacity ?? 1, borderColor: color, borderWidth: 1 });
          break;
        }
        case "rect":
          path(polygonPath(rectPoints(sh.pts[0], sh.pts[1])), { ...strokeOpts, ...fillOpts });
          break;
        case "ellipse":
          path(ellipsePath(sh.pts[0], sh.pts[1]), { ...strokeOpts, ...fillOpts });
          break;
        case "polygon":
          path(polygonPath(sh.pts), { ...strokeOpts, ...fillOpts });
          break;
        case "cloud":
          path(cloudPath(sh.pts, sh.pitch || 16), { ...strokeOpts, ...fillOpts });
          break;
        case "pen":
          path(smoothPath(sh.pts), strokeOpts);
          break;
        case "text": {
          const m = textMetrics(sh);
          await placeText(
            { lines: m.lines, size: sh.size || 18, font: sh.font, bold: !!sh.bold, color: sh.color || st.color || "#e11d48", bg: sh.bg || null, w: m.w, h: m.h },
            sh.pts[0], 0,
          );
          break;
        }
        case "dim":
        case "measure": {
          const size = sh.size || 12;
          const geo = dimensionGeometry(sh.pts[0], sh.pts[1], sh.type === "dim" ? sh.off ?? 24 : 0, size);
          const thin = { ...strokeOpts, borderWidth: Math.max(0.6, width * 0.6) };
          if (sh.type === "dim") {
            path(linePath(geo.ext0), thin);
            path(linePath(geo.ext1), thin);
          }
          path(linePath(geo.line), strokeOpts);
          for (const h of [geo.head0, geo.head1]) path(polygonPath(h), { color, borderColor: color, borderWidth: 0.5, opacity: st.opacity ?? 1 });
          const label = labelFor(sh, page);
          if (label) {
            const m = textMetrics({ text: label, size, font: sh.font });
            const w = m.w;
            const h = size * TEXT_LINE;
            const a = (geo.textAngle * Math.PI) / 180;
            // 文字ボックスの中心 = textPos + 回転(0, 0.095*size)
            const c = [geo.textPos[0] - Math.sin(a) * size * 0.095, geo.textPos[1] + Math.cos(a) * size * 0.095];
            const tl = [c[0] + (-w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), c[1] + (-w / 2) * Math.sin(a) - (h / 2) * Math.cos(a)];
            await placeText({ lines: [label], size, font: sh.font, bold: false, color: sh.color || st.color || "#e11d48", bg: null, w, h }, tl, geo.textAngle);
          }
          break;
        }
        case "image": {
          const emb = await embedImage(sh.imgId);
          if (!emb) break;
          const [p0, p1] = sh.pts;
          const x = Math.min(p0[0], p1[0]);
          const y = Math.min(p0[1], p1[1]);
          placeImage(emb, [x, y], Math.abs(p1[0] - p0[0]), Math.abs(p1[1] - p0[1]), 0);
          break;
        }
        default:
          break;
      }
    }
  }
  onProgress?.(1, "保存データを作成中");
  const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
  return { bytes, pages: out.getPageCount(), level };
}
