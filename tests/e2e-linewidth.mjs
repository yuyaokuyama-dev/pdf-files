// E2E: 線の太さを0.1ptから選べる(図形・寸法とも)
import { launch, register, openPdf, setZoom1, tool, shapes, drag, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "lw01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const sel = (id) => page.evaluate((i) => { const m = window.__apdf.model; window.__apdf.editor.setSelection({ pageId: m.pages[0].id, shapeId: i }); }, id);
const numSel = '#props input[type=number][data-k="width"]';
const rangeSel = '#props input[type=range][data-k="width"]';

// 線を引いて、太さを0.1にする
await tool(page, "line");
await drag(page, 0, [100, 100], [300, 100]);
let list = await shapes(page);
await sel(list.at(-1).id);
check("太さのスライダーは0.1から選べる", (await page.locator(rangeSel).getAttribute("min")) === "0.1" && (await page.locator(rangeSel).getAttribute("step")) === "0.1");
check("数字の欄もある", await page.locator(numSel).count() === 1);
await page.fill(numSel, "0.1");
await page.locator(numSel).dispatchEvent("change");
list = await shapes(page);
check("線の太さを0.1にできる", list.at(-1).style.width === 0.1, String(list.at(-1).style.width));
await page.fill(numSel, "0.35");
await page.locator(numSel).dispatchEvent("change");
check("0.35のような細かい値も入れられる", (await shapes(page)).at(-1).style.width === 0.35);
check("スライダーも連動する", (await page.locator(rangeSel).inputValue()) === "0.35" || Math.abs(Number(await page.locator(rangeSel).inputValue()) - 0.35) < 0.06);
await page.fill(numSel, "0.01");
await page.locator(numSel).dispatchEvent("change");
check("0.1より細くはならない", (await shapes(page)).at(-1).style.width === 0.1);

// 寸法線: 太さ0.1にすると補助線も0.1以下(主線より太くならない)
const dimId = await page.evaluate(() => {
  const m = window.__apdf.model;
  return m.addShape(m.pages[0].id, { type: "dim", pts: [[100, 200], [300, 200]], off: 24, size: 12, text: "200", style: { color: "#e11d48", width: 2 } }).id;
});
await sel(dimId);
await page.fill(numSel, "0.1");
await page.locator(numSel).dispatchEvent("change");
check("寸法も太さ0.1にできる", (await shapes(page)).find((s) => s.id === dimId).style.width === 0.1);
const widths = await page.evaluate((id) => [...document.querySelectorAll(`[data-id="${id}"] path`)].map((p) => parseFloat(p.getAttribute("stroke-width"))).filter((w) => w > 0 && w < 14), dimId);
check("寸法の線はどれも0.1以下", widths.length > 0 && widths.every((w) => w <= 0.1 + 1e-9), JSON.stringify(widths));

// 次に描くものの太さも0.1にできる
await page.keyboard.press("Escape");
await tool(page, "line");
await page.fill(numSel, "0.1");
await page.locator(numSel).dispatchEvent("change");
await drag(page, 0, [100, 300], [300, 300]);
check("次に描く線も太さ0.1になる", (await shapes(page)).at(-1).style.width === 0.1);
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`linewidth: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
