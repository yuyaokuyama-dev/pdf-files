// E2E: 寸法の拡張(半径・直径・角度・直列・並列、寸法値の引出線の先端)
import { launch, register, openPdf, setZoom1, click, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "dimx01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const ed = (fn, arg) => page.evaluate(fn, arg);
const last = async () => (await shapes(page)).at(-1);
const answer = async (text) => {
  await page.waitForSelector("dialog[open] #pdIn");
  await page.fill("dialog[open] #pdIn", text);
  await page.locator("dialog[open] .btn.primary").click();
  await page.waitForSelector("dialog[open]", { state: "detached" });
};
const start = (name) => ed((n) => window.__apdf.editor.startCommand(n), name);

// 土台の円(中心 250,250 半径 50)
await ed(() => { const m = window.__apdf.model; m.addShape(m.pages[0].id, { type: "ellipse", pts: [[200, 200], [300, 300]], style: { color: "#e11d48", width: 2, fill: "none" } }); });

/* ---- 半径寸法 ---- */
await start("dimradius");
await click(page, 0, [300, 250]);
await click(page, 0, [360, 250]);
await answer("50");
let s = await last();
check("半径寸法: R付きで、補助線なし・端部1つ", s.type === "dim" && s.text === "R50" && s.noExt && s.one, JSON.stringify(s));
check("半径寸法: 中心から円周へ", near(s.pts[0][0], 250) && near(s.pts[0][1], 250) && near(s.pts[1][0], 300) && near(s.pts[1][1], 250), JSON.stringify(s.pts));
check("半径寸法: 矢印が1つだけ描かれる", (await page.locator(".page").first().locator(".layer .shape-dim").last().locator("path[fill='#e11d48']").count()) === 1);

/* ---- 直径寸法 ---- */
await start("dimdiameter");
await click(page, 0, [300, 250]);
await click(page, 0, [360, 250]);
await answer("100");
s = await last();
check("直径寸法: ⌀付きで円の両端を結ぶ", s.text === "⌀100" && near(s.pts[0][0], 200) && near(s.pts[1][0], 300) && !s.one, JSON.stringify(s));

/* ---- 円以外をタップしたら進まない ---- */
await start("dimradius");
await click(page, 0, [100, 100]);
check("円以外では開始のまま", await ed(() => window.__apdf.editor.cmd?.picks.length === 0));
await ed(() => window.__apdf.editor.cancelCommand());

/* ---- 角度寸法 ---- */
await start("dimangle");
await click(page, 0, [100, 420]);
await click(page, 0, [200, 420]);
await click(page, 0, [100, 320]);
s = await last();
check("角度寸法が作られる(頂点+2点)", s.type === "dimang" && s.pts.length === 3 && near(s.pts[0][0], 100) && near(s.pts[0][1], 420), JSON.stringify(s));
const label = await page.locator(".page").first().locator(".layer .shape-dimang text").last().textContent();
check("角度は 90° と表示", label === "90°", label);
check("パネルに半径の調整が出る", (await page.locator('#props [data-k="angR"]').count()) === 1);
await page.locator('#props [data-k="text"]').fill("直角");
check("角度の文字を書き換えられる", (await page.locator(".page").first().locator(".layer .shape-dimang text").last().textContent()) === "直角");

/* ---- 直列寸法(Enter で完了) ---- */
const before = (await shapes(page)).length;
await start("dimseries");
await click(page, 0, [350, 330]);
await click(page, 0, [400, 330]);
await click(page, 0, [500, 330]);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("Enter");
let all = await shapes(page);
check("直列寸法: 測点3つで寸法2本", all.length === before + 2, `${all.length - before}`);
const [d1, d2] = all.slice(-2);
check("直列寸法: 寸法線が同じ直線上にそろう", near(d1.off, d2.off, 0.5) && d1.type === "dim", `${d1.off} ${d2.off}`);
check("直列寸法: 長さが自動で入る", d1.text === "50" && d2.text === "100", `${d1.text} ${d2.text}`);

/* ---- 並列寸法(完了ボタン) ---- */
await start("dimpara");
await click(page, 0, [350, 380]);
await click(page, 0, [400, 380]);
await click(page, 0, [500, 380]);
await page.locator("#toolHint .btn.primary", { hasText: "完了" }).click();
all = await shapes(page);
const [p1, p2] = all.slice(-2);
check("並列寸法: 同じ基準点から2本・寸法線が重ならない", all.length === before + 4 && p1.pts[0][0] === p2.pts[0][0] && p2.off > p1.off + 10, `${p1.off} ${p2.off}`);

/* ---- 寸法値の引出線の先端 ---- */
await ed(() => {
  const e = window.__apdf.editor; const pg = window.__apdf.model.pages[0];
  const sh = pg.shapes.at(-1);
  window.__apdf.model.mutate(() => { sh.textOff = [20, -30]; });
  e.setSelection({ pageId: pg.id, shapeId: sh.id });
});
await page.selectOption('#props [data-k="dltip"]', "dot");
s = await last();
check("引出線の先端を黒丸にできる", s.ltip === "dot", JSON.stringify(s.ltip));
check("黒丸が描かれる", (await page.locator(".page").first().locator(".layer .shape-dim").last().locator("path[fill='#e11d48']").count()) >= 3);

/* ---- 尺度変換・書き出し ---- */
await ed(() => { const e = window.__apdf.editor; const pg = window.__apdf.model.pages[0]; const a = pg.shapes.find((x) => x.type === "dimang"); e.setSelection({ pageId: pg.id, shapeId: a.id }); e.applyMatrices([{ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0, k: 2, rot: 0, flip: false }], {}); });
const ang = (await shapes(page)).find((x) => x.type === "dimang");
check("角度寸法も拡大で半径が変わる", ang.r != null && ang.r > 40, String(ang.r));
const bytes = await ed(async () => {
  const { exportPdf } = await import("./js/export.js");
  const res = await exportPdf(window.__apdf.model, { level: "standard" });
  return (res.bytes || res).length;
});
check("PDFに書き出せる", bytes > 1000, String(bytes));

check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
