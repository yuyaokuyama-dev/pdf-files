// E2E: 連続作成(作成後も同じツールのまま) / ボタンの大きさ設定
import { launch, register, openPdf, setZoom1, drag, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "sticky01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
await page.evaluate(() => { window.__apdf.editor.sticky = true; });

const curTool = () => page.evaluate(() => window.__apdf.editor.tool);
for (const [id, y] of [["line", 80], ["rect", 140], ["ellipse", 240], ["arrow", 340]]) {
  await tool(page, id);
  await drag(page, 0, [60, y], [220, y + 40]);
  check(`${id}: 描いたあともツールはそのまま`, (await curTool()) === id);
  await drag(page, 0, [260, y], [420, y + 40]);
}
let sh = await shapes(page);
check("同じツールで続けて8個描けた", sh.length === 8, `len=${sh.length}`);
check("描いた図形は選択されない", await page.evaluate(() => !window.__apdf.editor.sel));

// 寸法線: 入力ダイアログのあとも寸法ツールのまま
await tool(page, "dim");
await drag(page, 0, [60, 440], [300, 440]);
await page.fill("#pdIn", "1200");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.some((s) => s.type === "dim"));
check("寸法線を描いたあともツールはそのまま", (await curTool()) === "dim");

// Esc で選択ツールに戻る
await page.keyboard.press("Escape");
check("Escで選択ツールに戻る", (await curTool()) === "select");

// ボタンの大きさ
const w0 = await page.evaluate(() => document.querySelector(".tool[data-tool=pen]").getBoundingClientRect().width);
await page.evaluate(() => { document.documentElement.dataset.ui = "xlarge"; });
const w1 = await page.evaluate(() => document.querySelector(".tool[data-tool=pen]").getBoundingClientRect().width);
check("特大にするとツールボタンが大きくなる", w1 > w0 + 20, `${w0} -> ${w1}`);

// 設定ダイアログから変更・保存
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "設定" }).click();
await page.selectOption("#stUi", "large");
await page.uncheck("#stSticky");
await page.locator("dialog[open] button", { hasText: "保存" }).click();
await page.waitForFunction(() => document.documentElement.dataset.ui === "large");
check("設定でボタンの大きさを変えられる", true);
check("設定で連続作成をオフにできる", await page.evaluate(() => window.__apdf.editor.sticky === false));
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`sticky: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
