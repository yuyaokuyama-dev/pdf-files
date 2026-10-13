// E2E: 作図コマンド(円・3点円弧・ポリライン・正多角形・辺ドラッグ・雲マークへの変換)
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "draw301");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const last = async () => (await shapes(page)).at(-1);
const ed = (fn, arg) => page.evaluate(fn, arg);
const setMode = (k, v) => ed(([k, v]) => window.__apdf.editor.setMode(k, v), [k, v]);

/* ---- 円(中心→半径) ---- */
await setMode("ellipse", "circle");
await tool(page, "ellipse");
await drag(page, 0, [200, 200], [260, 230]); // 半径 ≈ 67
let s = await last();
const r = Math.hypot(60, 30);
check("円: 中心から半径で作られる(正円)", s.type === "ellipse" && near(Math.abs(s.pts[1][0] - s.pts[0][0]), 2 * r, 2) && near(Math.abs(s.pts[1][1] - s.pts[0][1]), 2 * r, 2), JSON.stringify(s.pts));
check("円: 中心が押した位置", near((s.pts[0][0] + s.pts[1][0]) / 2, 200, 2) && near((s.pts[0][1] + s.pts[1][1]) / 2, 200, 2));
await setMode("ellipse", "ellipse");

/* ---- 3点円弧 ---- */
await setMode("arc", "three");
await tool(page, "arc");
await click(page, 0, [100, 400]);
await click(page, 0, [200, 300]);
await click(page, 0, [300, 400]);
s = await last();
check("3点円弧: 弧が作られる", s.type === "arc" && Number.isFinite(s.sweep) && Math.abs(s.sweep) > 1, JSON.stringify(s));
{
  // 中心は (200,400)、半径100。始点か終点が(100,400)か(300,400)付近
  const c = s.pts[0];
  const ok = near(c[0], 200, 2) && near(c[1], 400, 2);
  check("3点円弧: 中心と半径が正しい", ok && near(Math.hypot(s.pts[1][0] - c[0], s.pts[1][1] - c[1]), 100, 2), JSON.stringify(s.pts));
}
await setMode("arc", "center");

/* ---- ポリライン(開いた線) ---- */
await setMode("poly", "polyline");
await tool(page, "polygon");
for (const p of [[400, 100], [480, 160], [540, 100]]) await click(page, 0, p);
await ed(() => window.__apdf.editor.finishPolygon());
s = await last();
check("ポリライン: 開いた線として作られる", s.type === "polyline" && s.pts.length === 3, `${s.type} ${s.pts.length}`);
check("ポリライン: 塗りなし", !s.style?.fill || s.style.fill === "none");

/* ---- 正多角形 ---- */
await setMode("poly", "regular");
await setMode("n", 5);
await tool(page, "polygon");
await drag(page, 0, [450, 300], [450, 360]);
s = await last();
check("正多角形: 5角形が作られる", s.type === "polygon" && s.pts.length === 5, `${s.type} ${s.pts.length}`);
{
  const c = [s.pts.reduce((a, p) => a + p[0], 0) / 5, s.pts.reduce((a, p) => a + p[1], 0) / 5];
  const rs = s.pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]));
  check("正多角形: 頂点が同じ半径に並ぶ", Math.max(...rs) - Math.min(...rs) < 0.5, rs.join(","));
}
await setMode("poly", "polygon");

/* ---- 矩形の辺をドラッグ ---- */
await tool(page, "rect");
await drag(page, 0, [100, 600], [200, 680]);
await tool(page, "select");
await click(page, 0, [100, 640]); // 左辺で選択
let rc = await last();
await drag(page, 0, [150, 600], [150, 570]); // 上辺の中点を上へ
rc = await last();
const ys = [rc.pts[0][1], rc.pts[1][1]];
check("矩形: 上辺ドラッグで高さだけ変わる", near(Math.min(...ys), 570, 2) && near(Math.max(...ys), 680, 2), JSON.stringify(rc.pts));
check("矩形: 幅は変わらない", near(Math.abs(rc.pts[1][0] - rc.pts[0][0]), 100, 1.5));
await ed(() => window.__apdf.model.undo?.());
rc = await last();
check("矩形: 取り消しで元に戻る", near(Math.min(rc.pts[0][1], rc.pts[1][1]), 600, 2), JSON.stringify(rc.pts));

/* ---- 雲マークへ変換 ---- */
const n0 = (await shapes(page)).length;
await ed(() => window.__apdf.editor.convertToCloud());
rc = await last();
check("矩形→雲マークに変換(図形の数は同じ)", rc.type === "cloud" && (await shapes(page)).length === n0, rc.type);

/* ---- 多角形の辺をドラッグ ---- */
await tool(page, "polygon");
for (const p of [[300, 440], [400, 440], [400, 520], [300, 520]]) await click(page, 0, p);
await ed(() => window.__apdf.editor.finishPolygon());
let pg = await last();
check("四角形の多角形を作成", pg.type === "polygon" && pg.pts.length === 4, `${pg.type} ${pg.pts.length}`);
await drag(page, 0, [350, 440], [350, 410]); // 上辺の中点を上へ
pg = await last();
check("多角形: 辺ドラッグで両端が一緒に動く", near(pg.pts[0][1], 410, 2) && near(pg.pts[1][1], 410, 2) && near(pg.pts[2][1], 520, 2), JSON.stringify(pg.pts));
await ed(() => window.__apdf.editor.convertToCloud());
pg = await last();
check("多角形→雲マークに変換", pg.type === "cloud", pg.type);

/* ---- パネルの描き方切り替え ---- */
await tool(page, "ellipse");
await page.click('#props [data-act="mode"][data-key="ellipse"][data-v="circle"]');
check("パネルで円モードに切り替わる", (await ed(() => window.__apdf.editor.modes.ellipse)) === "circle");
await tool(page, "polygon");
await page.click('#props [data-act="mode"][data-key="poly"][data-v="regular"]');
check("正多角形では辺の数が出る", (await page.locator('#props [data-k="regN"]').count()) === 1);

check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
