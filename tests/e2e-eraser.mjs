// E2E: 消しゴム(ペンの線だけを、なぞった1本単位/なぞった部分だけ消す。取り消しで戻る)
import { launch, register, openPdf, setZoom1, drag, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "eraser01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

await tool(page, "pen");
await drag(page, 0, [60, 100], [200, 100], { steps: 20 });
await drag(page, 0, [60, 200], [200, 200], { steps: 20 });
await tool(page, "rect");
await drag(page, 0, [60, 300], [200, 360]);
let sh = await shapes(page);
check("ペン2本+四角が作成された", sh.filter((s) => s.type === "pen").length === 2 && sh.some((s) => s.type === "rect"), JSON.stringify(sh.map((s) => s.type)));

await tool(page, "eraser");
check("消しゴムツールが選べる", await page.evaluate(() => window.__apdf.editor.tool) === "eraser");
await drag(page, 0, [130, 60], [130, 140], { steps: 10 }); // 1本目だけ横切る
sh = await shapes(page);
check("なぞったペン線だけ消える", sh.filter((s) => s.type === "pen").length === 1);
await drag(page, 0, [100, 280], [100, 380], { steps: 10 }); // 四角をなぞる
sh = await shapes(page);
check("ペン以外(四角)は消えない", sh.some((s) => s.type === "rect"));
await drag(page, 0, [20, 200], [240, 200], { steps: 10 });
sh = await shapes(page);
check("残りのペン線も消える", sh.filter((s) => s.type === "pen").length === 0);

await page.click("#btnUndo");
sh = await shapes(page);
check("取り消しで1本戻る(1回のなぞり=1操作)", sh.filter((s) => s.type === "pen").length === 1);
// ---- 部分消しゴム(なぞった部分だけ消す。円の大きさはスライダー) ----
await page.click("#btnUndo"); // ペン2本に戻す
sh = await shapes(page);
check("取り消しでペン2本に戻る", sh.filter((s) => s.type === "pen").length === 2);
const xRange = (s) => [Math.min(...s.pts.map((p) => p[0])), Math.max(...s.pts.map((p) => p[0]))];
const onY = (y) => (s) => s.type === "pen" && s.pts.every((p) => Math.abs(p[1] - y) < 5);
const [x0a, x1a] = xRange(sh.find(onY(100)));
const [, x1b] = xRange(sh.find(onY(200)));
await tool(page, "eraser");
check("消しゴムのパネルが出る", await page.isVisible('[data-act="eraser-mode"][data-mode="partial"]'));
await page.click('[data-act="eraser-mode"][data-mode="partial"]');
check("なぞった部分モードに切り替わる", await page.evaluate(() => window.__apdf.editor.eraser.mode) === "partial");
await page.locator('input[data-k="eraserSize"]').fill("20");
check("スライダーで大きさが変わる", await page.evaluate(() => window.__apdf.editor.eraser.size) === 20);
await drag(page, 0, [130, 60], [130, 140], { steps: 10 }); // 1本目(y=100)の中央を縦に横切る
sh = await shapes(page);
let pens = sh.filter((s) => s.type === "pen");
const top = pens.filter(onY(100));
check("横切った線が2本に分かれる", pens.length === 3 && top.length === 2, JSON.stringify(pens.map((s) => s.pts.length)));
const xs = top.flatMap((s) => s.pts.map((p) => p[0]));
check("円の範囲(x≈119.5〜140.5)だけ消え、両端は残る", !xs.some((x) => x > 119.6 && x < 140.4) && xs.some((x) => x > 119 && x < 120) && Math.min(...xs) === x0a && Math.max(...xs) === x1a, JSON.stringify(top.map((s) => [s.pts[0][0], s.pts.at(-1)[0]])));
check("ペン以外(四角)は残る", sh.some((s) => s.type === "rect"));
check("円のカーソルが表示される", await page.locator(".draft .eraser-cursor").count() === 1);
await drag(page, 0, [x1b, 180], [x1b, 220], { steps: 10 }); // 2本目の右端だけ消す
sh = await shapes(page);
pens = sh.filter((s) => s.type === "pen");
const second = pens.filter(onY(200));
check("端だけなぞると短くなる(1本のまま)", second.length === 1 && Math.abs(xRange(second[0])[1] - (x1b - 10.5)) < 0.5, JSON.stringify(second.map(xRange)));
await page.click("#btnUndo");
sh = await shapes(page);
check("取り消しで1回分戻る", sh.filter(onY(200)).length === 1 && xRange(sh.find(onY(200)))[1] === x1b && sh.filter(onY(100)).length === 2);
check("設定は端末に保存される", await page.evaluate(() => JSON.parse(localStorage.getItem("apdf_defaults_v1")).eraser?.mode) === "partial");

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`eraser: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
