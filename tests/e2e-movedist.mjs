// E2E: ドラッグ移動で Ctrl=スナップ・Shift=直交・Alt=極トラッキング / 移動・コピー中の数字入力で距離を固定
import { launch, register, openPdf, setZoom1, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "movedist01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 1.2) => Math.abs(a - b) <= tol;
const add = (a, b) => page.evaluate(([a, b]) => { const m = window.__apdf.model; return m.addShape(m.pages[0].id, { type: "line", pts: [a, b], style: { color: "#e11d48", width: 1 } }).id; }, [a, b]);
const pts = async (id) => (await shapes(page)).find((s) => s.id === id).pts;
const pick = async (id) => { await tool(page, "select"); await page.evaluate((i) => { const m = window.__apdf.model; window.__apdf.editor.setSelection({ pageId: m.pages[0].id, shapeId: i }); }, id); };
const scr = (p) => toScreen(page, 0, p[0], p[1]);
const dragTo = async (from, to, { mods = [], keys = [], steps = 8 } = {}) => {
  const [x0, y0] = await scr(from);
  const [x1, y1] = await scr(to);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(x1, y1, { steps });
  for (const k of keys) await page.keyboard.press(k);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
};

/* ---- Ctrl でスナップ: 基点(つかんだ点)が他の図形の端点に吸い付く ---- */
const a = await add([100, 100], [200, 100]);
const b = await add([300, 300], [400, 300]);
await pick(a);
await dragTo([150, 100], [352, 298], { mods: ["Control"] }); // 線の中点をつかみ、相手の中点(350,300)の近くへ
let p = await pts(a);
check("Ctrl+ドラッグで、つかんだ中点が相手の中点にスナップ", near(p[0][0], 300) && near(p[0][1], 300) && near(p[1][0], 400) && near(p[1][1], 300), JSON.stringify(p));
await page.evaluate(() => window.__apdf.model.undo());
await pick(a);
await dragTo([150, 100], [352, 298]);
p = await pts(a);
check("Ctrlなしなら、スナップせず見たままの位置", near(p[0][0], 302) && near(p[0][1], 298), JSON.stringify(p));
await page.evaluate(() => window.__apdf.model.undo());

/* ---- Shift で直交(90°固定) ---- */
await pick(a);
await dragTo([150, 100], [250, 130], { mods: ["Shift"] });
p = await pts(a);
check("Shift+ドラッグで、横方向だけに動く(縦は動かない)", p[0][0] > 190 && near(p[0][1], 100, 0.05), JSON.stringify(p));
await page.evaluate(() => window.__apdf.model.undo());

/* ---- ドラッグ中に数字: 距離を固定 ---- */
await pick(a);
await dragTo([150, 100], [260, 100], { keys: ["5", "0", "Enter"] });
p = await pts(a);
check("ドラッグ中に 50 と打って Enter → 右へちょうど50pt", near(p[0][0], 150, 0.05) && near(p[0][1], 100, 0.05) && near(p[1][0], 250, 0.05), JSON.stringify(p));
await page.evaluate(() => window.__apdf.model.undo());
await pick(a);
await dragTo([150, 100], [150, 220], { keys: ["7", "Backspace", "2", "5"] });
p = await pts(a);
check("打ち間違いは Backspace で直せる(25 → 下へ25pt、離して確定)", near(p[0][1], 125, 0.05) && near(p[0][0], 100, 0.05), JSON.stringify(p));
await page.evaluate(() => window.__apdf.model.undo());
await pick(a);
await dragTo([150, 100], [260, 100], { keys: ["5", "0", "Escape"] });
p = await pts(a);
check("Esc で数字を取り消すと、マウスの位置に戻る", near(p[0][0], 210, 1.5), JSON.stringify(p));
await page.evaluate(() => window.__apdf.model.undo());

/* ---- コピー・移動コマンド中の数字 ---- */
await pick(a);
await page.evaluate(() => window.__apdf.editor.startCommand("copy"));
await click(page, 0, [100, 100]);
const [mx, my] = await scr([180, 100]);
await page.mouse.move(mx, my, { steps: 4 });
const n0 = (await shapes(page)).length;
await page.keyboard.press("3");
await page.keyboard.press("0");
await page.keyboard.press("Enter");
check("コピー: 30 と打って Enter → 30pt先にコピーができる", (await shapes(page)).length === n0 + 1);
let c = (await shapes(page)).at(-1).pts;
check("コピーは右へちょうど30pt", near(c[0][0], 130, 0.05) && near(c[0][1], 100, 0.05), JSON.stringify(c));
await page.keyboard.press("Escape");
check("Escでコピーを終える", await page.evaluate(() => !window.__apdf.editor.cmd));
await page.evaluate(() => { for (let i = 0; i < 1; i++) window.__apdf.model.undo(); });

await pick(a);
await page.evaluate(() => window.__apdf.editor.startCommand("move"));
await click(page, 0, [100, 100]);
const [nx, ny] = await scr([100, 190]);
await page.mouse.move(nx, ny, { steps: 4 });
await page.keyboard.type("40");
await page.keyboard.press("Enter");
p = await pts(a);
check("移動: 40 と打って Enter → 下へちょうど40pt", near(p[0][0], 100, 0.05) && near(p[0][1], 140, 0.05), JSON.stringify(p));

/* ---- 縮尺ありなら、打った数字は実寸 ---- */
await page.evaluate(() => { const S = window.__apdf; S.model.mutate(() => { S.model.pages[0].scale = { ptsPerUnit: 0.5, unit: "mm" }; }); });
await pick(a);
const before = await pts(a);
await dragTo([150, 140], [260, 140], { keys: ["1", "0", "0", "Enter"] });
p = await pts(a);
check("縮尺あり: 100(mm)と打つと 50pt 動く", near(p[0][0] - before[0][0], 50, 0.05), JSON.stringify([before, p]));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`movedist: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
