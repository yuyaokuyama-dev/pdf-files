// E2E ⑥: 文字サイズ最小3・テキスト回転・寸法線の端部(黒丸既定)・縦寸法の文字向き・寸法値のドラッグ移動(引き出し線)
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "dim01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
const setK = (k, v, nth = 0) => page.locator(`#props [data-k="${k}"]`).nth(nth).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);

/* ---- 寸法線: 端部は黒丸が既定 ---- */
await tool(page, "dim");
await drag(page, 0, [100, 300], [400, 300]);
check("寸法入力は数字キーパッド(inputmode=decimal)", (await page.getAttribute("#pdIn", "inputmode")) === "decimal");
await page.click("#pdKb");
check("切替で通常キーボード(text)になる", (await page.getAttribute("#pdIn", "inputmode")) === "text");
await page.click("#pdKb");
check("もう一度切替で数字キーパッドに戻る", (await page.getAttribute("#pdIn", "inputmode")) === "decimal");
await page.fill("#pdIn", "3,600");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.at(-1)?.type === "dim");
let dim = (await shapes(page)).at(-1);
check("寸法線の端部は黒丸が既定", dim.endStyle === "dot" && dim.endSize === 6, JSON.stringify(dim));
const dots = await page.evaluate(() => [...document.querySelectorAll(".shape-dim path")].filter((p) => /A/.test(p.getAttribute("d") || "") && !p.classList.contains("hit")).length);
check("黒丸が2つ描画される", dots === 2, String(dots));
await setK("endStyle", "arrow");
dim = (await shapes(page)).at(-1);
check("端部を矢印に変更できる", dim.endStyle === "arrow");
await setK("endStyle", "dot");
await setK("endSize", 10);
check("端部サイズを変更できる", (await shapes(page)).at(-1).endSize === 10);
check("寸法の文字サイズは最小3まで", (await page.locator('#props input[type=range][data-k="size"]').getAttribute("min")) === "3");
await setK("size", 3);
check("寸法の文字サイズ3にできる", (await shapes(page)).at(-1).size === 3);
await setK("size", 12);

/* ---- 寸法値だけをドラッグ → 引き出し線 ---- */
const h = page.locator('.handle[data-kind="txt"]');
check("寸法値の移動ハンドルがある", (await h.count()) === 1);
const bb = await h.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
await page.mouse.down();
await page.mouse.move(bb.x + bb.width / 2 + 40, bb.y + bb.height / 2 - 60, { steps: 8 });
await page.mouse.up();
dim = (await shapes(page)).at(-1);
check("寸法値だけ移動(textOff)し、寸法線自体は動かない", Array.isArray(dim.textOff) && Math.abs(dim.pts[0][0] - 100) < 0.1 && Math.abs(dim.pts[1][0] - 400) < 0.1, JSON.stringify([dim.textOff, dim.pts]));
const paths = await page.evaluate(() => document.querySelectorAll(".shape-dim path:not(.hit)").length);
check("引き出し線が追加される(補助線2+寸法線+黒丸2+引き出し線)", paths === 6, String(paths));
await page.locator('#props [data-act="text-home"]').click();
check("元の位置へ戻せる", (await shapes(page)).at(-1).textOff === undefined);

/* ---- 縦寸法: 文字は下から上、線は文字の下側 ---- */
await tool(page, "dim");
await drag(page, 0, [500, 200], [500, 450]);
await page.fill("#pdIn", "2,500");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.at(-1)?.text === "2,500");
const v = await page.evaluate(() => {
  const t = [...document.querySelectorAll(".shape-dim text")].find((x) => x.textContent === "2,500");
  const tr = t.getAttribute("transform");
  const [tx] = [Number(t.getAttribute("x"))];
  return { tr, tx };
});
check("縦寸法の文字は -90°(下から上へ読む)", /rotate\(-90 /.test(v.tr), v.tr);
const sh = (await shapes(page)).at(-1);
check("縦寸法の文字は寸法線の左(=文字の上側)にある", v.tx < 500 + sh.off, `${v.tx} off=${sh.off}`);

/* ---- テキスト: 最小3・回転 ---- */
await tool(page, "text");
await click(page, 0, [100, 520]);
await page.waitForSelector("textarea.text-edit");
await page.keyboard.type("回転テスト");
await page.keyboard.press("Control+Enter");
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.at(-1)?.type === "text");
check("文字サイズは最小3まで選べる", (await page.locator('#props input[type=range][data-k="size"]').getAttribute("min")) === "3");
await setK("size", 3);
check("文字サイズ3にできる", (await shapes(page)).at(-1).size === 3);
await setK("size", 20);
const centerOf = () => page.evaluate(() => { const r = document.querySelector(".shape-text").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
const c0 = await centerOf();
await setK("angle", 30);
let t = (await shapes(page)).at(-1);
const tr = await page.evaluate(() => document.querySelector(".shape-text")?.getAttribute("transform"));
check("テキストを回転できる(30°)", t.angle === 30 && /^rotate\(30 /.test(tr), `${t.angle} ${tr}`);
const c1 = await centerOf();
check("回転しても文字の中心は動かない", Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) < 1.5, JSON.stringify([c0, c1]));
await page.locator('#props [data-act="rot90"]').click();
check("90°回すボタン", (await shapes(page)).at(-1).angle === 120);
const rh = page.locator('.handle[data-kind="rot"]');
check("回転ハンドルがある", (await rh.count()) === 1);
const rb = await rh.boundingBox();
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page.mouse.down();
const ctr = await page.evaluate(() => { const r = document.querySelector(".shape-text").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
await page.mouse.move(ctr[0] + 120, ctr[1], { steps: 8 }); // 右へ = 時計回り90°
await page.mouse.up();
check("ハンドルのドラッグで回転できる(約90°)", Math.abs((await shapes(page)).at(-1).angle - 90) <= 5, String((await shapes(page)).at(-1).angle));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
