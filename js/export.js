// 編集内容をPDFに書き出す。図形はベクターのまま、文字は画像化(日本語・任意フォント対応)して焼き込む。
import { angleDimGeometry, defaultAngleRadius, leaderTipShape } from "./dimx.js";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFOperator, PDFOperatorNames, PDFBool, degrees, rgb, LineCapStyle } from "../vendor/pdf-lib.esm.min.js";
import {
  linePath, polygonPath, ellipsePath, cloudPath, arrowHead, arrowShaft, arrowSizeOf, thinWidth, smoothPath,
  dimensionGeometry, rectPoints, rectHiddenEdges, rectRuns, dashArray, dimOpts, arcPath,
} from "./geometry.js";
import { hatchSegments, hatchWidth, segmentsPath, isHatch } from "./hatch.js";
import { textMetrics, labelFor, serializeOverlay, arcLines } from "./render.js";
import { TEXT_LINE } from "./render.js";
import { renderTextPng, recompressImage, renderPageJpeg } from "./raster.js";
import { visibleShapes, layerIdOf } from "./layers.js";
import { leaderGeometry, stadiumPath, LEADER_DEFAULT } from "./leader.js";
import { packEdit, pageOf, EDIT_FILE, OC_PREFIX } from "./editdata.js";

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

/** 専用レイヤーの内容を入れた内容ストリームの印(開き直して書き出すときに取り除く) */
const EDIT_MARK = "PFEdit";

function stripEditStreams(pg) {
  const c = pg.node.Contents();
  if (!(c instanceof PDFArray)) return;
  for (let i = c.size() - 1; i >= 0; i--) {
    const st = pg.node.context.lookup(c.get(i));
    if (st?.dict?.get(PDFName.of(EDIT_MARK))) c.remove(i);
  }
}

/**
 * PDFを作る。
 * embedEdit: 図形をPDF内の専用レイヤーに描き、編集用データ(図形・レイヤー)を添付する。
 * editImages: 写真・スタンプ・署名も編集用データに含める(容量が増える)
 * keepLayers: 図形をレイヤーごとに分けて書き出し、他のPDFソフトでもレイヤーの表示・非表示ができるようにする(編集用データは付けない。レイヤーが2つ以上あるときだけ)
 */
export async function exportPdf(doc, { level = "small", onProgress, embedEdit = false, editImages = false, keepLayers = false } = {}) {
  const cfg = LEVELS[level] || LEVELS.small;
  const wantEdit = !!embedEdit && !cfg.rasterize;
  const keepOc = !!keepLayers && !wantEdit && !cfg.rasterize && (doc.layers || []).length > 1;
  const ocgs = new Map(); // レイヤーid → { ref, key }
  const editPages = [];
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
    // ロックした印影があるページは画像化して、他のソフトで印影だけを消したり動かしたりできなくする
    const shapes = visibleShapes(page.shapes, doc.layers); // 非表示レイヤーは書き出さない。色・太さ・線種はレイヤーの設定を反映
    const flatten = shapes.some((sh) => sh.locked);
    if (cfg.rasterize || flatten) {
      const dpi = cfg.rasterize ? cfg.dpi : 200;
      const quality = cfg.rasterize ? cfg.quality : 0.8;
      const src = page.srcId ? doc.sources.get(page.srcId) : null;
      const pdfPage = src ? await pageOf(src.pdf, page.srcIndex + 1) : null;
      const overlaySvg = shapes.length ? serializeOverlay(page, doc.images, page.w, page.h, doc.layers) : null;
      const r = await renderPageJpeg({
        pdfPage, rotation: ((page.baseRot || 0) + page.rot) % 360, w: page.w, h: page.h, overlaySvg, dpi, quality,
      });
      const pg = out.addPage([page.w, page.h]);
      const img = await out.embedJpg(r.bytes);
      pg.drawImage(img, { x: 0, y: 0, width: page.w, height: page.h });
      editPages.push(null);
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
      if (doc.sources.get(page.srcId)?.edit) stripEditStreams(pg); // 前回の編集用レイヤーは、図形として復元済みなので外す
    } else {
      pg = out.addPage([page.w, page.h]);
    }
    if (wantEdit) {
      // 隠れているレイヤーの図形も含めて、すべての図形を編集用データに残す
      const keep = page.shapes.filter((s) => s.type !== "image" || editImages);
      editPages.push(keep.length || page.scale ? { shapes: keep, scale: page.scale || null } : {});
    }
    if (!shapes.length) continue;

    let baseStream = null;
    let baseRef = null;
    let editStream = null;
    let editRef = null;
    if (wantEdit) {
      // 画像などの焼き込みと、編集用レイヤーの図形を別々の内容ストリームに分ける
      baseStream = pg.getContentStream(false);
      baseRef = pg.contentStreamRef;
      editStream = pg.getContentStream(false);
      editRef = pg.contentStreamRef;
      editStream.dict.set(PDFName.of(EDIT_MARK), PDFBool.True);
    }
    const ocgFor = (layerId) => {
      let o = ocgs.get(layerId);
      if (!o) {
        const L = (doc.layers || []).find((l) => l.id === layerId);
        // 編集用レイヤーは名前の先頭に印を付ける(開き直すと非表示にして図形として復元)。レイヤー保持だけのときは普通の名前
        const ref = out.context.register(out.context.obj({ Type: "OCG", Name: PDFHexString.fromText((keepOc ? "" : OC_PREFIX) + (L?.name ?? layerId)) }));
        o = { ref, key: `PFL${ocgs.size}` };
        ocgs.set(layerId, o);
      }
      const res = pg.node.Resources();
      let props = res.lookupMaybe(PDFName.of("Properties"), PDFDict);
      if (!props) {
        props = out.context.obj({});
        res.set(PDFName.of("Properties"), props);
      }
      props.set(PDFName.of(o.key), o.ref);
      return o;
    };

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

    for (const sh of shapes) {
      const inEdit = wantEdit && (sh.type !== "image" || editImages);
      if (wantEdit) {
        pg.contentStream = inEdit ? editStream : baseStream;
        pg.contentStreamRef = inEdit ? editRef : baseRef;
      }
      const inOc = inEdit || keepOc;
      if (inOc) pg.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of("OC"), PDFName.of(ocgFor(layerIdOf(sh)).key)]));
      const st = sh.style || {};
      const color = hexToRgb(st.color || "#e11d48");
      const width = st.width ?? 2;
      const hasFill = st.fill && st.fill !== "none" && !isHatch(st);
      const strokeOpts = {
        borderColor: color, borderWidth: width, borderOpacity: st.opacity ?? 1,
        ...(dashArray(st.dash, width) ? { borderDashArray: dashArray(st.dash, width) } : {}),
      };
      const fillOpts = hasFill ? { color: hexToRgb(st.fill), opacity: st.fillOpacity ?? 0.25 } : {};
      if (isHatch(st) && st.fill && st.fill !== "none") {
        const hs = hatchSegments(sh); // ハッチング: 図形の内側に塗りの色で線を引く(外形線の下)
        if (hs.length) path(segmentsPath(hs), { borderColor: hexToRgb(st.fill), borderWidth: hatchWidth(st), borderOpacity: st.opacity ?? 1, borderLineCap: LineCapStyle.Butt });
      }
      switch (sh.type) {
        case "line":
          path(linePath(sh.pts), strokeOpts);
          break;
        case "arrow": {
          const size = arrowSizeOf(sh, width);
          const [a, b] = sh.pts;
          path(linePath(arrowShaft(a, b, size)), strokeOpts);
          path(polygonPath(arrowHead(a, b, size)), { color, opacity: st.opacity ?? 1, borderColor: color, borderWidth: Math.min(1, width) });
          break;
        }
        case "rect": {
          const rp = rectPoints(sh.pts[0], sh.pts[1]);
          const hidden = rectHiddenEdges(sh);
          if (!hidden) {
            path(polygonPath(rp), { ...strokeOpts, ...fillOpts });
            break;
          }
          if (hasFill) path(polygonPath(rp), fillOpts);
          for (const r of rectRuns(rp, hidden)) path(linePath(r.pts), strokeOpts);
          break;
        }
        case "ellipse":
          path(ellipsePath(sh.pts[0], sh.pts[1]), { ...strokeOpts, ...fillOpts });
          break;
        case "arc":
          path(arcPath(sh.pts[0], sh.pts[1], sh.sweep, arcLines(sh)), strokeOpts);
          break;
        case "polyline":
          path(linePath(sh.pts), strokeOpts);
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
            sh.pts[0], sh.angle || 0,
          );
          break;
        }
        case "leader": {
          const sz = sh.size || LEADER_DEFAULT.size;
          const m = sh.text ? textMetrics({ ...sh, size: sz }) : null;
          const geo = leaderGeometry(sh, m);
          path(linePath(geo.line), strokeOpts);
          if (geo.tipShape?.type === "arrow") path(polygonPath(geo.tipShape.poly), { color, opacity: st.opacity ?? 1, borderColor: color, borderWidth: Math.min(1, width) });
          else if (geo.tipShape?.type === "dot") path(ellipsePath([geo.tipShape.c[0] - geo.tipShape.r, geo.tipShape.c[1] - geo.tipShape.r], [geo.tipShape.c[0] + geo.tipShape.r, geo.tipShape.c[1] + geo.tipShape.r]), { color, borderColor: color, borderWidth: Math.min(0.5, width), opacity: st.opacity ?? 1 });
          if (geo.box?.type === "underline") path(linePath(geo.box.pts), strokeOpts);
          else if (geo.box?.type === "stadium") {
            path(stadiumPath(geo.box), strokeOpts);
            path(linePath(geo.box.stub), strokeOpts);
          }
          if (m) await placeText({ lines: m.lines, size: sz, font: sh.font, bold: !!sh.bold, color: sh.color || color, bg: null, w: m.w, h: m.h }, geo.textTL, 0);
          break;
        }
        case "dim":
        case "measure": {
          const size = sh.size || 12;
          const label = labelFor(sh, page);
          const geo = dimensionGeometry(sh.pts[0], sh.pts[1], sh.type === "dim" ? sh.off ?? 24 : 0, size, dimOpts(sh, label ? textMetrics({ text: label, size, font: sh.font }).w : 0));
          const thin = { ...strokeOpts, borderWidth: thinWidth(width) };
          if (sh.type === "dim" && !sh.noExt) {
            path(linePath(geo.ext0), thin);
            path(linePath(geo.ext1), thin);
          }
          path(linePath(geo.line), strokeOpts);
          for (const e of geo.ends) path(e.type === "dot" ? ellipsePath([e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]) : polygonPath(e.poly), { color, borderColor: color, borderWidth: Math.min(0.5, width), opacity: st.opacity ?? 1 });
          if (geo.leader) {
            path(linePath(geo.leader), thin);
            const lt = leaderTipShape(geo.leader, sh.ltip, sh.endSize ?? size / 2);
            if (lt) path(lt.type === "dot" ? ellipsePath([lt.c[0] - lt.r, lt.c[1] - lt.r], [lt.c[0] + lt.r, lt.c[1] + lt.r]) : polygonPath(lt.poly), { color, borderColor: color, borderWidth: Math.min(0.5, width), opacity: st.opacity ?? 1 });
          }
          if (geo.underline) path(linePath(geo.underline), thin);
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
        case "dimang": {
          const size = sh.size || 12;
          const geo = angleDimGeometry(sh.pts, sh.r ?? defaultAngleRadius(...sh.pts), size, { endStyle: sh.endStyle ?? "arrow", endSize: sh.endSize ?? size / 2 });
          if (!geo) break;
          const thin = { ...strokeOpts, borderWidth: thinWidth(width) };
          path(linePath(geo.ext[0]), thin);
          path(linePath(geo.ext[1]), thin);
          path(geo.arc, strokeOpts);
          for (const e of geo.ends) path(e.type === "dot" ? ellipsePath([e.c[0] - e.r, e.c[1] - e.r], [e.c[0] + e.r, e.c[1] + e.r]) : polygonPath(e.poly), { color, borderColor: color, borderWidth: Math.min(0.5, width), opacity: st.opacity ?? 1 });
          const label = sh.text || geo.label;
          const m = textMetrics({ text: label, size, font: sh.font });
          const h = size * TEXT_LINE;
          const c = [geo.textPos[0], geo.textPos[1] + size * 0.095];
          await placeText({ lines: [label], size, font: sh.font, bold: false, color: sh.color || st.color || "#e11d48", bg: null, w: m.w, h }, [c[0] - m.w / 2, c[1] - h / 2], 0);
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
      if (inOc) pg.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    }
  }
  if (keepOc && ocgs.size) {
    const refs = [...ocgs.values()].map((o) => o.ref);
    out.catalog.set(PDFName.of("OCProperties"), out.context.obj({ OCGs: refs, D: { Order: refs, ON: refs } }));
  }
  if (wantEdit && editPages.some((e) => e && e.shapes)) {
    const refs = [...ocgs.values()].map((o) => o.ref);
    if (refs.length) out.catalog.set(PDFName.of("OCProperties"), out.context.obj({ OCGs: refs, D: { Order: refs, ON: refs } }));
    const images = {};
    if (editImages) for (const e of editPages) for (const s of e?.shapes || []) if (s.imgId && doc.images.get(s.imgId)) images[s.imgId] = doc.images.get(s.imgId);
    const packed = await packEdit({ app: "PDF Files", layers: doc.layers || [], pages: editPages, images });
    await out.attach(packed, EDIT_FILE, { mimeType: "application/octet-stream", description: "PDF Files 編集用データ(図形・レイヤー)", creationDate: new Date(), modificationDate: new Date() });
  }
  onProgress?.(1, "保存データを作成中");
  const bytes = await out.save({ useObjectStreams: true, addDefaultPage: false });
  return { bytes, pages: out.getPageCount(), level };
}
