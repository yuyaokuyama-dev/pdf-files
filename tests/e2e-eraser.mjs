// E2E: 消しゴム(ペンの線だけを、なぞった1本単位で消す。取り消しで戻る)
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
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`eraser: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
