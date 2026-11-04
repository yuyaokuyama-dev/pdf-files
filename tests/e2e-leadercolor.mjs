// E2E: 引出線の文字を赤にして書き出すと、他のソフトで開いても赤い(黒にならない)
import { launch, register, openPdf, setZoom1, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "ldrcol1");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const red = await page.evaluate(async () => {
  const S = window.__apdf;
  const m = S.model;
  const pid = m.pages[0].id;
  m.addShape(pid, { type: "leader", pts: [[100, 100], [220, 160]], text: "赤い文字", style: { color: "#ff0000", width: 1 } });
  const { exportPdf } = await import("./js/export.js");
  const res = await exportPdf(m, { level: "standard" });
  const { PDFDocument, PDFName, PDFRawStream } = await import("./vendor/pdf-lib.esm.min.js");
  const doc = await PDFDocument.load(res.bytes || res);
  const inflate = async (u8) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
  let reds = 0, blacks = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(PDFName.of("Subtype"))?.toString() !== "/Image" || d.get(PDFName.of("SMask")) === undefined) continue;
    const px = await inflate(obj.contents);
    for (let i = 0; i + 2 < px.length; i += 3) {
      if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] < 60) reds++;
      else if (px[i] < 40 && px[i + 1] < 40 && px[i + 2] < 40) blacks++;
    }
  }
  return { reds, blacks };
});
check("赤い引出線の文字が、書き出したPDFでも赤い", red.reds > 50, JSON.stringify(red));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`leadercolor: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
