// E2E: 元PDFの線をDXFへ / 画像・SVG書き出し / レイヤー保持でPDF書き出し
import { launch, register, openPdf, setZoom1, check, summary } from "./e2e-lib.mjs";
import fs from "node:fs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "exp201");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
await page.evaluate(() => {
  const m = window.__apdf.model;
  const id = m.pages[0].id;
  m.addShape(id, { type: "rect", pts: [[100, 100], [300, 200]], style: { color: "#e11d48", width: 2, fill: "none" } });
});
const menu = async (label) => {
  await page.click("#btnSave, button:has-text('保存・出力')");
  await page.locator("#menu button", { hasText: label }).click();
};

// --- DXF + 元PDFの線
await menu("DXFで書き出す");
await page.waitForSelector("dialog[open] #dxPdf");
await page.check("#dxPdf");
let [dl] = await Promise.all([page.waitForEvent("download"), page.locator("dialog[open] .btn.primary").click()]);
let text = fs.readFileSync(await dl.path(), "utf8");
const toast1 = await page.locator("#toast, .toast").first().textContent();
console.log("toast:", toast1);
check("DXFに元PDFの線の案内が出る(sample.pdfは線画を持つか確認)", /元PDFの線\d+本/.test(toast1) || /図形/.test(toast1), toast1);
check("DXFが読める形", text.includes("AC1021") && text.includes("EOF"));

// --- 画像
for (const [fmt, ext, magic] of [["png", "png", "89504e47"], ["jpeg", "jpg", "ffd8ff"], ["svg", "svg", null]]) {
  await menu("画像・SVGで書き出す");
  await page.waitForSelector("dialog[open] #imFmt");
  await page.selectOption("#imFmt", fmt);
  await page.selectOption("#imDpi", "72");
  [dl] = await Promise.all([page.waitForEvent("download"), page.locator("dialog[open] .btn.primary").click()]);
  const buf = fs.readFileSync(await dl.path());
  console.log(fmt, buf.subarray(0,8).toString("hex"));
  check(`${fmt}: ファイル名と中身`, dl.suggestedFilename().endsWith("-1." + ext) && (magic ? buf.subarray(0, 4).toString("hex").startsWith(magic) : buf.toString("utf8").includes("<svg") && buf.toString("utf8").includes("<image")), dl.suggestedFilename() + " " + buf.length);
}

// --- レイヤー保持
await page.evaluate(() => {
  const m = window.__apdf.model;
  m.addLayer?.("寸法");
});
const nLayers = await page.evaluate(() => window.__apdf.model.layers.length);
console.log("layers", nLayers);
if (nLayers > 1) {
  await menu("PDFを端末に保存");
  await page.waitForSelector("dialog[open] #exKeepLayers");
  check("レイヤー保持の選択肢が出る(既定オン)", await page.isChecked("#exKeepLayers"));
  await page.locator("dialog[open] .btn", { hasText: "キャンセル" }).first().click().catch(() => {});
}
const oc = await page.evaluate(async () => {
  const { exportPdf } = await import("./js/export.js");
  const m = window.__apdf.model;
  m.layers[1].name = "寸法線";
  m.addShape(m.pages[0].id, { type: "line", pts: [[10, 10], [200, 10]], layer: m.layers[1].id, style: { color: "#2563eb", width: 1 } });
  const on = await exportPdf(m, { level: "standard", keepLayers: true });
  const off = await exportPdf(m, { level: "standard", keepLayers: false });
  const { PDFDocument, PDFName } = await import("./vendor/pdf-lib.esm.min.js");
  const info = async (r) => {
    const d = await PDFDocument.load(r.bytes || r);
    const p = d.catalog.lookup(PDFName.of("OCProperties"));
    const names = p ? p.lookup(PDFName.of("OCGs")).asArray().map((o) => d.context.lookup(o).get(PDFName.of("Name")).decodeText()) : null;
    return names;
  };
  return { on: await info(on), off: await info(off) };
});
check("keepLayers=true でレイヤー名(寸法線)が入る", oc.on?.includes("寸法線") && !oc.on.some((n) => n.startsWith("PDF Files")), JSON.stringify(oc));
check("keepLayers=false では入らない", !oc.off || oc.off.length === 0, JSON.stringify(oc));
check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
