// E2E ⑤: 線の太さ(0.5刻み・既定1.0)・線種(一点/二点鎖線)・「初期設定にする」
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "style01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

await tool(page, "line");
await drag(page, 0, [60, 100], [260, 100]);
let sh = (await shapes(page)).at(-1);
check("太さの既定は1.0", sh.style.width === 1, JSON.stringify(sh.style));

const setK = (k, v) => page.locator(`#props [data-k="${k}"]`).first().evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
await tool(page, "select");
await click(page, 0, [160, 100]);
check("太さスライダーの最小は0.5", (await page.locator('#props input[type=range][data-k="width"]').getAttribute("min")) === "0.5");
await setK("width", 0.5);
check("太さ0.5にできる", (await shapes(page)).at(-1).style.width === 0.5);
const opts = await page.locator('#props select[data-k="dash"] option').allTextContents();
check("線種: 実線・破線・一点鎖線・二点鎖線", JSON.stringify(opts) === JSON.stringify(["実線", "破線", "一点鎖線", "二点鎖線"]), JSON.stringify(opts));
await setK("dash", "dashdot");
sh = (await shapes(page)).at(-1);
const da = await page.evaluate(() => document.querySelector(".shape-line path:not(.hit)")?.getAttribute("stroke-dasharray"));
check("一点鎖線が描画される", sh.style.dash === "dashdot" && da?.split(" ").length === 4, `${sh.style.dash} ${da}`);
await setK("dash", "dashdot2");
const da2 = await page.evaluate(() => document.querySelector(".shape-line path:not(.hit)")?.getAttribute("stroke-dasharray"));
check("二点鎖線が描画される", da2?.split(" ").length === 6, da2);

/* ---- 矢印: サイズと線の太さを別々に調整 ---- */
await tool(page, "arrow");
await drag(page, 0, [60, 160], [260, 160]);
let ar = (await shapes(page)).at(-1);
check("矢印の既定サイズは10(新規は個別サイズを持つ)", ar.type === "arrow" && ar.headSize === 10, JSON.stringify(ar));
await tool(page, "select");
await click(page, 0, [110, 160]);
await setK("headSize", 30);
ar = (await shapes(page)).at(-1);
check("矢印のサイズだけ変えられる(太さは変わらない)", ar.headSize === 30 && ar.style.width === 1, JSON.stringify(ar));
await setK("width", 6);
ar = (await shapes(page)).at(-1);
check("線の太さを変えても矢印のサイズは変わらない", ar.headSize === 30 && ar.style.width === 6, JSON.stringify(ar));
const headW = await page.evaluate(() => { const S = window.__apdf; const el = S.editor.els.get(S.model.pages[0].id); const polys = [...el.layer.querySelectorAll("path")]; return polys.length; });
check("矢印が描画される", headW > 0);
await tool(page, "select");
await click(page, 0, [160, 100]);

await setK("width", 4);
await page.locator('#props .sw[data-c="#16a34a"]').click();
await page.locator('#props [data-act="set-default"]').click();
await tool(page, "line");
await drag(page, 0, [60, 200], [260, 200]);
sh = (await shapes(page)).at(-1);
check("「初期設定にする」で新規の線に反映", sh.style.width === 4 && sh.style.color === "#16a34a" && sh.style.dash === "dashdot2", JSON.stringify(sh.style));
await page.reload();
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 }).catch(() => {});
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("apdf_defaults_v1") || "null"));
check("初期設定は端末に保存される", saved?.style?.width === 4 && saved.style.dash === "dashdot2", JSON.stringify(saved));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
