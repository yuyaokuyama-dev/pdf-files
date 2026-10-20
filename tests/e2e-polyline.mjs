// E2E: ポリライン専用ツール(開いたまま確定 / 最初の点で閉じる / Enter / スナップ・直交)
import { launch, register, openPdf, setZoom1, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "polyline01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
const last = async () => (await shapes(page)).at(-1);

await tool(page, "polyline");
check("ツールがポリラインになる", (await page.evaluate(() => window.__apdf.editor.tool)) === "polyline");

// ① 開いたまま確定(完了)
for (const p of [[100, 100], [180, 160], [260, 100], [340, 160]]) await click(page, 0, p);
await page.evaluate(() => window.__apdf.editor.finishPolygon());
let s = await last();
check("開いたポリライン(4点)が作られる", s.type === "polyline" && s.pts.length === 4, `${s.type} ${s.pts.length}`);
check("塗りなし", !s.style?.fill || s.style.fill === "none");

// ② Enter で確定
await tool(page, "polyline");
for (const p of [[100, 300], [180, 360], [260, 300]]) await click(page, 0, p);
await page.keyboard.press("Enter");
s = await last();
check("Enter で開いたまま確定する", s.type === "polyline" && s.pts.length === 3, `${s.type} ${s.pts.length}`);

// ③ 最初の点をタップして閉じる
await tool(page, "polyline");
for (const p of [[100, 500], [200, 500], [200, 580], [100, 500]]) await click(page, 0, p);
s = await last();
check("最初の点をタップすると閉じた線(3点・塗りなし)になる", s.type === "polygon" && s.pts.length === 3 && (!s.style?.fill || s.style.fill === "none"), `${s.type} ${s.pts.length}`);

// ④ 「閉じる」
await tool(page, "polyline");
for (const p of [[300, 500], [400, 500], [400, 580], [300, 580]]) await click(page, 0, p);
await page.evaluate(() => window.__apdf.editor.finishPolygon(true));
s = await last();
check("「閉じる」で4点の閉じた線になる", s.type === "polygon" && s.pts.length === 4);

// ⑤ Shift で直交
await tool(page, "polyline");
await click(page, 0, [100, 700]);
const [x2, y2] = await toScreen(page, 0, 220, 712);
await page.keyboard.down("Shift");
await page.mouse.click(x2, y2);
await page.keyboard.up("Shift");
await page.keyboard.press("Enter");
s = await last();
check("Shift で次の点が水平に揃う", s.type === "polyline" && Math.abs(s.pts[1][1] - s.pts[0][1]) < 0.01, JSON.stringify(s.pts));

// ⑥ Esc で取り消し
const n0 = (await shapes(page)).length;
await tool(page, "polyline");
await click(page, 0, [100, 760]);
await click(page, 0, [160, 780]);
await page.keyboard.press("Escape");
check("Esc で途中の線は作られない", (await shapes(page)).length === n0);

// ⑦ 点が1つだけでは作られない
await tool(page, "polyline");
await click(page, 0, [300, 760]);
await page.keyboard.press("Enter");
check("1点だけでは作られない", (await shapes(page)).length === n0);

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`polyline: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
