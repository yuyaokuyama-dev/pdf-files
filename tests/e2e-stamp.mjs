// E2E ⑦: 印影の押す大きさ・ロック(書き出しでページを画像化)・署名ダイアログの幅
import { launch, register, openPdf, setZoom1, click, tool, shapes, check, summary } from "./e2e-lib.mjs";
import { readFileSync } from "node:fs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "stamp01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

// 印影を登録(名前から)
await page.click("#btnFile").catch(() => {});
await page.evaluate(() => {});
await page.keyboard.press("Escape");
await tool(page, "stamp");
await page.waitForSelector("dialog[open] #stText");
await page.click("#stText");
await page.fill("#hkText", "山田");
await page.click("dialog[open]:last-of-type .foot .btn.primary");
await page.waitForSelector('dialog[open] [data-w]');
const w0 = await page.inputValue("dialog[open] [data-w]");
check("新規の印影は既定で幅18mm", Number(w0) === 18, w0);
await page.fill("dialog[open] [data-w]", "12");
await page.locator("dialog[open] [data-w]").dispatchEvent("change");
await page.click('dialog[open] [data-use]');
await page.waitForSelector("#props:not([hidden]) [data-k=stampW]");
check("押す大きさがプロパティに出る(12mm)", (await page.inputValue('#props [data-k="stampW"]')) === "12");
await click(page, 0, [300, 300]);
let sh = (await shapes(page)).at(-1);
const wPt = Math.abs(sh.pts[1][0] - sh.pts[0][0]);
check("指定した大きさ(12mm≒34pt)で押される", Math.abs(wPt - 12 * 72 / 25.4) < 0.5, String(wPt));

// ロック(選択ツールで印影を選ぶ)
await tool(page, "select");
await click(page, 0, [300, 300]);
await page.click('#props [data-act="lock"]');
await page.waitForSelector("dialog[open]");
await page.click("dialog[open] .foot .btn.primary");
sh = (await shapes(page)).at(-1);
check("ロックできる", sh.locked === true);
const before = JSON.stringify(sh.pts);
await tool(page, "select");
await page.mouse.move(0, 0);
const [mx, my] = await page.evaluate(() => { const r = document.querySelector(".shape-image").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.mouse.move(mx, my); await page.mouse.down(); await page.mouse.move(mx + 80, my + 60, { steps: 6 }); await page.mouse.up();
check("ロック中は動かせない", JSON.stringify((await shapes(page)).at(-1).pts) === before);
await page.keyboard.press("Delete");
check("ロック中は削除できない", (await shapes(page)).length === 1);
check("ロック中はハンドルが出ない", (await page.locator(".handle").count()) === 0);

// 書き出し: ロックしたページは画像化される
const bytes = await page.evaluate(async () => {
  const { exportPdf } = await import("/js/export.js");
  const r = await exportPdf(window.__apdf.model, { level: "standard" });
  return Array.from(r.bytes);
});
const textCounts = await page.evaluate(async (arr) => {
  const pdfjs = await import("/vendor/pdf.min.mjs");
  const count = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: bytes, wasmUrl: "/vendor/wasm/", cMapUrl: "/vendor/cmaps/", standardFontDataUrl: "/vendor/standard_fonts/" }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.length);
    return out;
  };
  const locked = await count(new Uint8Array(arr));
  const m = window.__apdf.model;
  m.pages[0].shapes.forEach((sh) => delete sh.locked);
  const plain = await count((await window.__apdf.exportPdf(m, { level: "standard" })).bytes);
  return { locked, plain };
}, bytes);
check("ロックしたページは画像化され文字が残らない(他ページは文字のまま)", textCounts.locked[0] === 0 && textCounts.plain[0] > 0 && textCounts.locked[1] === textCounts.plain[1] && textCounts.locked[1] > 0, JSON.stringify(textCounts));
await page.evaluate(() => { const m = window.__apdf.model; m.pages[0].shapes.forEach((sh) => (sh.locked = true)); });

// ロック解除
await page.click('#props [data-act="unlock"]');
check("ロックを解除できる", !(await shapes(page)).at(-1).locked);

// 署名ダイアログは広い
await tool(page, "sign");
await page.mouse.move(100, 400);
await page.evaluate(() => window.__apdf.editor.emit("sign-request", { pageId: window.__apdf.model.pages[0].id, rect: [[100, 500], [300, 560]] }));
await page.waitForSelector("dialog[open] #sigPad");
const wd = await page.evaluate(() => document.querySelector("dialog[open]").getBoundingClientRect().width);
check("署名ダイアログは横長(約840px)", wd > 780, String(wd));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
