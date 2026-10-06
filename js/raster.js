// ブラウザ(canvas)を使う画像処理。書き出し・署名・印影・カメラ画像で共通利用。
import { fontCss, TEXT_ASCENT, TEXT_LINE } from "./render.js";

export const canvasToBlob = (canvas, type = "image/png", quality) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("画像の変換に失敗しました"))), type, quality));

export const blobToBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());

export function dataUrlToBytes(url) {
  const bin = atob(url.slice(url.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export const dataUrlType = (url) => (url.match(/^data:([^;,]+)/) || [])[1] || "image/png";

export function fileToDataUrl(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("画像を読み込めません"));
    img.src = src;
  });
}

/** 文字を透明PNGにする(日本語・任意フォントを確実に出力するため)。scale 倍の解像度で描く */
export async function renderTextPng({ lines, size, font, bold, color, bg, w, h }, scale = 4) {
  if (document.fonts?.ready) await document.fonts.ready;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w * scale));
  c.height = Math.max(1, Math.ceil(h * scale));
  const g = c.getContext("2d");
  g.scale(scale, scale);
  if (bg) {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
  }
  g.fillStyle = color;
  g.font = `${bold ? "bold " : ""}${size}px ${fontCss(font)}`;
  g.textBaseline = "alphabetic";
  lines.forEach((line, i) => g.fillText(line, 0, size * TEXT_ASCENT + i * size * TEXT_LINE));
  return blobToBytes(await canvasToBlob(c));
}

/** 画像を最大辺 maxDim に縮小して再エンコード。透過があれば PNG、無ければ JPEG */
export async function recompressImage(dataUrl, { maxDim = 2000, quality = 0.82 } = {}) {
  const img = await loadImage(dataUrl);
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k));
  const h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const wantsAlpha = dataUrlType(dataUrl) === "image/png";
  if (!wantsAlpha) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
  }
  g.drawImage(img, 0, 0, w, h);
  if (wantsAlpha) {
    // 実際に透過ピクセルが無ければ JPEG にして軽くする
    const d = g.getImageData(0, 0, w, h).data;
    let alpha = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) { alpha = true; break; }
    if (alpha) return { bytes: await blobToBytes(await canvasToBlob(c, "image/png")), type: "png", w: img.naturalWidth, h: img.naturalHeight };
    g.globalCompositeOperation = "destination-over";
    g.fillStyle = "#fff";
    g.fillRect(0, 0, w, h);
  }
  return { bytes: await blobToBytes(await canvasToBlob(c, "image/jpeg", quality)), type: "jpg", w: img.naturalWidth, h: img.naturalHeight };
}

/** 取り込む写真を軽くする(撮影画像は数MBあるため) → JPEG の dataURL */
export async function downscaleToDataUrl(src, maxDim = 2000, quality = 0.85) {
  const img = await loadImage(src);
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return { url: c.toDataURL("image/jpeg", quality), w: c.width, h: c.height };
}

/** キャンバスの透明余白を切り詰める(署名・印影用)。何も描かれていなければ null */
export function trimCanvas(canvas, pad = 4) {
  const g = canvas.getContext("2d");
  const { width: W, height: H } = canvas;
  const d = g.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (d[(y * W + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(W - 1, x1 + pad);
  y1 = Math.min(H - 1, y1 + pad);
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d").drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** 撮影・取り込みした印影画像: 白背景を透明にし、必要なら朱色に統一する */
export async function stampFromImage(src, { threshold = 200, recolor = "#d9261c", maxDim = 600 } = {}) {
  const img = await loadImage(src);
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k);
  c.height = Math.round(img.naturalHeight * k);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, c.width, c.height);
  const im = g.getImageData(0, 0, c.width, c.height);
  const d = im.data;
  const rgb = recolor ? [parseInt(recolor.slice(1, 3), 16), parseInt(recolor.slice(3, 5), 16), parseInt(recolor.slice(5, 7), 16)] : null;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    if (lum >= threshold) {
      d[i + 3] = 0;
    } else {
      // 明るいほど薄く(にじみを自然に残す)
      d[i + 3] = Math.min(255, Math.round(((threshold - lum) / threshold) * 255 * 1.6));
      if (rgb) {
        d[i] = rgb[0];
        d[i + 1] = rgb[1];
        d[i + 2] = rgb[2];
      }
    }
  }
  g.putImageData(im, 0, 0);
  const t = trimCanvas(c, 2);
  if (!t) throw new Error("印影が見つかりませんでした。明るい場所で白い紙に押した印影を撮影してください");
  return t.toDataURL("image/png");
}

/** 文字から丸い印影(縦書き)を作る */
export function makeHankoDataUrl(text, color = "#d9261c", size = 240) {
  const chars = [...text.trim()].slice(0, 4);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const cx = size / 2;
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = size * 0.045;
  g.beginPath();
  g.arc(cx, cx, size * 0.46, 0, Math.PI * 2);
  g.stroke();
  const n = Math.max(1, chars.length);
  const fs = Math.min(size * 0.62 / n * 1.05, size * 0.5);
  g.font = `bold ${fs}px "Yu Mincho","Hiragino Mincho ProN","MS PMincho","Noto Serif JP","Noto Serif CJK JP",serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const total = fs * n;
  chars.forEach((ch, i) => g.fillText(ch, cx, cx - total / 2 + fs * (i + 0.5)));
  return c.toDataURL("image/png");
}

/** ページを JPEG にレンダリング(最大圧縮モード用)。pdfPage: pdf.js page、overlaySvg: 図形SVG文字列 */
export async function renderPageJpeg({ pdfPage, rotation, w, h, overlaySvg, dpi = 130, quality = 0.6 }) {
  const scale = dpi / 72;
  const c = document.createElement("canvas");
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  if (pdfPage) {
    const vp = pdfPage.getViewport({ scale, rotation });
    await pdfPage.render({ canvasContext: g, canvas: c, viewport: vp }).promise;
  }
  if (overlaySvg) {
    const url = URL.createObjectURL(new Blob([overlaySvg], { type: "image/svg+xml" }));
    try {
      const img = await loadImage(url);
      g.drawImage(img, 0, 0, c.width, c.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  return { bytes: await blobToBytes(await canvasToBlob(c, "image/jpeg", quality)), w, h };
}
