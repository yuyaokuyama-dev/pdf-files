// E2E: 連続作成(作成後は選択して調整 → 何もない所で元のツールに戻る) / ボタンの大きさ設定
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "sticky01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
await page.evaluate(() => { window.__apdf.editor.sticky = true; });

const curTool = () => page.evaluate(() => window.__apdf.editor.tool);
const selId = () => page.evaluate(() => window.__apdf.editor.sel?.shapeId || null);
const litTool = () => page.evaluate(() => document.querySelector(".tool.on")?.dataset.tool);
for (const [id, y] of [["line", 80], ["rect", 140], ["ellipse", 240], ["arrow", 340]]) {
  await tool(page, id);
  await drag(page, 0, [60, y], [220, y + 40]);
  let sh = await shapes(page);
  check(`${id}: 描いた直後はその図形が選択される`, (await curTool()) === "select" && (await selId()) === sh.at(-1).id);
  check(`${id}: 調整中もツールボタンは${id}のまま`, (await litTool()) === id);
  // 選択中にプロパティ(色)を変えると、描いた図形に反映される
  await page.click('#props .sw[data-c="#2563eb"]');
  check(`${id}: 調整中に色を変えられる`, (await shapes(page)).at(-1).style.color === "#2563eb");
  // 何もない所をクリックで確定して元のツールに戻る
  await click(page, 0, [500, y + 20]);
  check(`${id}: 何もない所をクリックで${id}ツールに戻る`, (await curTool()) === id && !(await selId()));
  await drag(page, 0, [260, y], [420, y + 40]);
  check(`${id}: 戻ったツールで続けて描ける`, (await shapes(page)).length === sh.length + 1);
  await click(page, 0, [500, y + 20]);
}
let sh = await shapes(page);
check("同じツールで続けて8個描けた", sh.length === 8, `len=${sh.length}`);

// 調整中に別の図形を選んでも、何もない所のクリックで元のツールに戻る
await tool(page, "line");
await drag(page, 0, [60, 400], [220, 400]);
await click(page, 0, [60, 80]); // 1本目の線の端
check("調整中に別の図形を選べる", (await selId()) === sh[0].id);
await click(page, 0, [500, 400]);
check("その後、何もない所で線ツールに戻る", (await curTool()) === "line");

// 寸法線: 入力ダイアログのあとは寸法線が選択され、何もない所で寸法ツールに戻る
await tool(page, "dim");
await drag(page, 0, [60, 440], [300, 440]);
await page.fill("#pdIn", "1200");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.some((s) => s.type === "dim"));
check("寸法線を描いたあとは寸法線が選択される", (await curTool()) === "select" && !!(await selId()));
await click(page, 0, [500, 600]);
check("何もない所で寸法ツールに戻る", (await curTool()) === "dim");

// 調整中の Esc も確定して元のツールに戻る。もう一度 Esc で選択ツール
await tool(page, "rect");
await drag(page, 0, [60, 520], [200, 580]);
await page.keyboard.press("Escape");
check("調整中のEscで四角ツールに戻る", (await curTool()) === "rect");
await page.keyboard.press("Escape");
check("Escで選択ツールに戻る", (await curTool()) === "select");

// 調整中に選択ツールを押したら、何もない所をクリックしても選択ツールのまま
await tool(page, "line");
await drag(page, 0, [300, 520], [450, 520]);
await tool(page, "select");
await click(page, 0, [500, 700]);
check("選択ツールを押したあとは戻らない", (await curTool()) === "select");

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
