// E2E: トリム・延長・フィレット・面取り・切断・ストレッチ・結合・分解
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "modify02");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1.5) => near(p[0], q[0], tol) && near(p[1], q[1], tol);
const ed = (fn, arg) => page.evaluate(fn, arg);
const clear = async () => {
  await page.keyboard.press("Escape");
  await ed(() => { const e = window.__apdf.editor; e.setTool("select"); e.selectAll(); e.deleteSelected(); });
};
const line = async (a, b) => {
  await tool(page, "line");
  await drag(page, 0, a, b);
};
const start = (name, opts) => ed(([n, o]) => window.__apdf.editor.startCommand(n, o), [name, opts || {}]);
const types = async () => (await shapes(page)).map((s) => s.type).join(",");

/* ---- メニュー ---- */
await page.click('#tools [data-group="modify"]');
const items = await page.locator(".toolgroup .tool[data-cmd] span").allTextContents();
check("「修正」に各コマンドが並ぶ", ["トリム", "延長", "フィレット", "面取り", "切断", "ストレッチ", "結合", "分解"].every((w) => items.some((t) => t.includes(w))), items.join("|"));
await page.keyboard.press("Escape");

/* ---- トリム ---- */
await clear();
await line([100, 100], [400, 100]);
await line([200, 50], [200, 150]);
await line([300, 50], [300, 150]);
await start("trim");
await click(page, 0, [250, 100]);
let sh = await shapes(page);
check("トリム: 2本の線の間が消えて1本が2つに分かれる", sh.length === 4, String(sh.length));
const h = sh.filter((s) => near(s.pts[0][1], 100) && near(s.pts[1][1], 100));
const xs = h.map((s) => [Math.min(s.pts[0][0], s.pts[1][0]), Math.max(s.pts[0][0], s.pts[1][0])]).sort((a, b) => a[0] - b[0]);
check("トリム: 残りは 100〜200 と 300〜400", xs.length === 2 && near(xs[0][0], 100) && near(xs[0][1], 200) && near(xs[1][0], 300) && near(xs[1][1], 400), JSON.stringify(xs));
await click(page, 0, [350, 100]); // 交点のない区間はそのまま
check("トリム: 交わる図形がない区間は変えない", (await shapes(page)).length === 4);
await ed(() => window.__apdf.model.undo());
check("トリムは1回の取り消しで戻る", (await shapes(page)).length === 3);
await page.keyboard.press("Escape");

/* ---- 延長 ---- */
await clear();
await line([100, 300], [200, 300]);
await line([400, 250], [400, 350]);
await start("extend");
await click(page, 0, [190, 300]);
sh = await shapes(page);
const a = sh.find((s) => near(s.pts[0][1], 300) && near(s.pts[1][1], 300));
check("延長: 線の端が次の図形(x=400)まで伸びる", a && near(Math.max(a.pts[0][0], a.pts[1][0]), 400) && near(Math.min(a.pts[0][0], a.pts[1][0]), 100), JSON.stringify(a?.pts));
await page.keyboard.press("Escape");

/* ---- フィレット ---- */
await clear();
await line([100, 500], [300, 500]);
await line([250, 450], [250, 650]);
await start("fillet", { radius: 20 });
await click(page, 0, [150, 500]);
await click(page, 0, [250, 600]);
sh = await shapes(page);
check("フィレット: 円弧が1つ増える", sh.length === 3 && sh.some((s) => s.type === "arc"), await types());
const l1 = sh[0];
check("フィレット: 横線は x=230 で止まる", near(Math.max(l1.pts[0][0], l1.pts[1][0]), 230) && near(Math.min(l1.pts[0][0], l1.pts[1][0]), 100), JSON.stringify(l1.pts));
const arc = sh.find((s) => s.type === "arc");
check("フィレット: 円弧の半径が20・開き角が90°", near(Math.hypot(arc.pts[1][0] - arc.pts[0][0], arc.pts[1][1] - arc.pts[0][1]), 20, 0.5) && near(arc.sweep, 90, 0.5), JSON.stringify(arc));
await ed(() => window.__apdf.model.undo());
check("フィレットは1回の取り消しで戻る", (await shapes(page)).length === 2);
await page.keyboard.press("Escape");

/* ---- 面取り ---- */
await start("chamfer", { d1: 20, d2: 30 });
await click(page, 0, [150, 500]);
await click(page, 0, [250, 600]);
sh = await shapes(page);
check("面取り: 斜めの線が1本増える", sh.length === 3 && sh[2].type === "line", await types());
check("面取り: 距離 20 と 30 で切れる", near(Math.max(sh[0].pts[0][0], sh[0].pts[1][0]), 230) && near(Math.min(sh[1].pts[0][1], sh[1].pts[1][1]), 530) || near(Math.max(sh[0].pts[0][0], sh[0].pts[1][0]), 230), JSON.stringify([sh[0].pts, sh[1].pts]));
await page.keyboard.press("Escape");

/* ---- 切断 ---- */
await clear();
await line([100, 100], [400, 100]);
await start("break");
await click(page, 0, [250, 100]);
sh = await shapes(page);
check("切断: 線が2本に分かれる", sh.length === 2, String(sh.length));
check("切断: つなぎ目が x=250", sh.some((s) => nearP(s.pts[1], [250, 100], 2)) && sh.some((s) => nearP(s.pts[0], [250, 100], 2)), JSON.stringify(sh.map((s) => s.pts)));
await page.keyboard.press("Escape");

/* ---- ストレッチ ---- */
await clear();
await tool(page, "rect");
await drag(page, 0, [300, 100], [400, 160]);
await start("stretch");
await click(page, 0, [380, 80]);
await click(page, 0, [420, 180]);
await click(page, 0, [400, 100]);
await click(page, 0, [450, 100]);
const r = (await shapes(page)).at(-1);
const rx = [r.pts[0][0], r.pts[1][0]].sort((p, q) => p - q);
check("ストレッチ: 右の辺だけ動いて幅が広がる", r.type === "rect" && near(rx[0], 300) && near(rx[1], 450), JSON.stringify(r.pts));
await ed(() => window.__apdf.model.undo());
check("ストレッチは1回の取り消しで戻る", (await shapes(page)).length === 1 && near(Math.max(...(await shapes(page))[0].pts.map((q) => q[0])), 400));

/* ---- 分解 ---- */
await ed(() => { const e = window.__apdf.editor; e.setTool("select"); e.selectAll(); e.explodeSelected(); });
sh = await shapes(page);
check("分解: 四角が4本の線になる", sh.length === 4 && sh.every((s) => s.type === "line"), await types());

/* ---- 結合 ---- */
await ed(() => window.__apdf.editor.selectAll());
await ed(() => window.__apdf.editor.joinSelected());
sh = await shapes(page);
check("結合: 4本がつながって閉じた多角形1つになる", sh.length === 1 && sh[0].type === "polygon" && sh[0].pts.length === 4, await types());

check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
