// E2E: 書き出したPDFに、文字(テキスト・引出線・寸法)が「読める文字」の注釈としても入る(KEPLER など他のソフトが読める)
import { launch, register, openPdf, setZoom1, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "tannot1");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const r = await page.evaluate(async () => {
  const S = window.__apdf;
  const m = S.model;
  const pid = m.pages[0].id;
  const t = m.addShape(pid, { type: "text", pts: [[100, 100]], text: "2705", size: 18, style: { color: "#ff0000" } }).id;
  const l = m.addShape(pid, { type: "leader", pts: [[100, 200], [220, 260]], text: "〇", style: { color: "#ff0000", width: 1 } }).id;
  const { exportPdf } = await import("./js/export.js");
  const res = await exportPdf(m, { level: "standard" });
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFString } = await import("./vendor/pdf-lib.esm.min.js");
  const doc = await PDFDocument.load(res.bytes || res);
  const pg = doc.getPage(0);
  const annots = pg.node.Annots();
  const out = [];
  for (let i = 0; i < (annots?.size() ?? 0); i++) {
    const d = annots.lookup(i, PDFDict);
    const get = (k) => d.get(PDFName.of(k));
    const txt = (v) => (v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : String(v));
    out.push({ sub: String(get("Subtype")), contents: txt(get("Contents")), nm: txt(get("NM")), f: Number(String(get("F"))), rect: get("Rect").asArray().map((n) => Number(String(n))) });
  }
  const pageH = pg.getHeight();
  return { t, l, out, pageH };
});
const a = r.out.find((x) => x.contents === "2705");
const b = r.out.find((x) => x.contents === "〇");
check("テキストの文字が注釈の Contents に入る", !!a && a.sub === "/FreeText", JSON.stringify(r.out));
check("引出線の文字も注釈に入る", !!b);
check("注釈の名前に図形IDが入る", a?.nm === r.t && b?.nm === r.l, JSON.stringify([a?.nm, b?.nm, r.t, r.l]));
check("注釈は非表示(画像の文字と二重に出ない)", a?.f === 2);
check("注釈の位置が文字の場所(左上寄り)にある", a && a.rect[0] > 90 && a.rect[0] < 110 && a.rect[3] > r.pageH - 130 && a.rect[3] < r.pageH - 90, JSON.stringify(a?.rect));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const rr = summary();
console.log(`textannot: ${rr.pass} pass / ${rr.fail} fail`);
process.exit(rr.fail ? 1 : 0);
