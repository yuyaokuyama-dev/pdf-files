// E2E: 円弧ツール(作成・開き角・直線①②・大きさ・回転・移動・書き出し)。常に正円のまま
import { launch, register, openPdf, setZoom1, drag, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "arc01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const radius = (s) => Math.hypot(s.pts[1][0] - s.pts[0][0], s.pts[1][1] - s.pts[0][1]);
const setK = (k, v) => page.locator(`#props [data-k="${k}"]`).first().evaluate((el, v) => {
  if (el.type === "checkbox") el.checked = v; else el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}, v);
async function dragPt(a, b) {
  const [x0, y0] = await toScreen(page, 0, a[0], a[1]);
  const [x1, y1] = await toScreen(page, 0, b[0], b[1]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 10 });
  await page.mouse.up();
}

/* ---- 作成: 中心から外へドラッグ。既定は半円、線は弧だけ ---- */
await tool(page, "arc");
await drag(page, 0, [200, 300], [280, 300]);
let a = (await shapes(page)).at(-1);
check("円弧ツールで作成", a?.type === "arc" && a.sweep === 180, JSON.stringify(a));
check("中心と半径(ドラッグ長さ)", near(a.pts[0][0], 200) && near(radius(a), 80), JSON.stringify(a.pts));
check("既定では直線①②は出さない", !a.r1 && !a.r2);
let d = await page.evaluate(() => document.querySelector(".shape-arc path:not(.hit)")?.getAttribute("d") || "");
check("弧(A)だけが描かれる", /A80 80 0 0 1/.test(d) && !/L/.test(d), d);

/* ---- プロパティ: 1/4円・3/4円・直線①② ---- */
await page.locator('#props [data-act="arc-preset"][data-s="90"]').click();
check("1/4円に切り替え", (await shapes(page)).at(-1).sweep === 90);
await page.locator('#props [data-act="arc-preset"][data-s="270"]').click();
a = (await shapes(page)).at(-1);
d = await page.evaluate(() => document.querySelector(".shape-arc path:not(.hit)")?.getAttribute("d") || "");
check("3/4円に切り替え(大きい弧)", a.sweep === 270 && / 0 1 1 /.test(d), d);
await setK("r1", true);
a = (await shapes(page)).at(-1);
d = await page.evaluate(() => document.querySelector(".shape-arc path:not(.hit)")?.getAttribute("d") || "");
check("直線①を表示", a.r1 === true && !a.r2 && /^M200(\.\d+)? 300(\.\d+)? L/.test(d), d);
await setK("r2", true);
d = await page.evaluate(() => document.querySelector(".shape-arc path:not(.hit)")?.getAttribute("d") || "");
check("直線②も表示", /L200(\.\d+)? 300(\.\d+)? Z$/.test(d), d);
await setK("r1", false);
a = (await shapes(page)).at(-1);
check("直線①だけ非表示にできる", !a.r1 && a.r2 === true, JSON.stringify(a));
await page.locator('#props [data-act="arc-preset"][data-s="180"]').click();

/* ---- 大きさ: 半径ハンドル。中心は動かず正円のまま ---- */
a = (await shapes(page)).at(-1);
check("ハンドル(両端・大きさ・回転)が出る", (await page.locator(".handle[data-kind=v]").count()) === 2 && (await page.locator(".handle[data-kind=rad]").count()) === 1 && (await page.locator(".handle[data-kind=rot]").count()) === 1);
await dragPt([200, 380], [200, 420]); // 半円の中央(真下)→ 外へ
a = (await shapes(page)).at(-1);
check("大きさハンドルで半径だけ変わる", near(radius(a), 120) && near(a.pts[0][0], 200) && near(a.pts[0][1], 300) && a.sweep === 180, JSON.stringify(a));
await setK("radiusMm", 25.4);
a = (await shapes(page)).at(-1);
check("半径を mm で指定(25.4mm = 72pt)", near(radius(a), 72, 0.01), String(radius(a)));

/* ---- 開き角: 終点ハンドルを円周に沿って動かす(45°付近で吸着) ---- */
await dragPt([128, 300], [201, 371]); // 終点(180°)→ 約89°の位置へ
a = (await shapes(page)).at(-1);
check("終点ハンドルで開き角を変更(90°に吸着)", a.sweep === 90 && near(radius(a), 72, 0.01), JSON.stringify(a));

/* ---- 回転: プロパティと回転ハンドル ---- */
await setK("arcRot", 90);
a = (await shapes(page)).at(-1);
check("回転(度)で向きを変える(半径はそのまま)", near(a.pts[1][0], 200, 0.01) && near(a.pts[1][1], 372, 0.01), JSON.stringify(a.pts));
await page.locator('#props [data-act="rot90"]').click();
a = (await shapes(page)).at(-1);
check("90°回す", near(a.pts[1][0], 128, 0.01) && near(a.pts[1][1], 300, 0.01), JSON.stringify(a.pts));
{
  const hp = await page.evaluate(() => { const h = document.querySelector(".handle[data-kind=rot]"); return [+h.getAttribute("cx"), +h.getAttribute("cy")]; });
  await dragPt(hp, [300, 300]); // 弧の中央を右へ向ける
}
a = (await shapes(page)).at(-1);
const midAng = (Math.atan2(a.pts[1][1] - 300, a.pts[1][0] - 200) * 180) / Math.PI + a.sweep / 2;
check("回転ハンドルで中心のまわりに回る", near(((midAng % 360) + 360) % 360, 0, 2) && near(radius(a), 72, 0.01) && near(a.pts[0][0], 200), JSON.stringify(a));

/* ---- 移動: 弧をドラッグ ---- */
await dragPt([262.35, 264], [302.35, 304]); // 弧の上(中央の大きさハンドルは避ける)
a = (await shapes(page)).at(-1);
check("弧をドラッグで移動", near(a.pts[0][0], 240) && near(a.pts[0][1], 340) && near(radius(a), 72, 0.01), JSON.stringify(a.pts));

/* ---- 書き出し・ページ回転 ---- */
const res = await page.evaluate(async () => { const S = window.__apdf; const r = await S.exportPdf(S.model, { level: "none" }); return r.bytes.length; });
check("円弧を含むPDFを書き出せる", res > 1000, String(res));

/* ---- 次に描く円弧の設定(ツール選択中) ---- */
await tool(page, "arc");
await page.locator('#props [data-act="arc-preset"][data-s="90"]').click();
await setK("r2", true);
await drag(page, 0, [400, 500], [400, 440]);
a = (await shapes(page)).at(-1);
check("ツールの設定(1/4円・直線②)で新規作成", a.type === "arc" && a.sweep === 90 && a.r2 === true && !a.r1, JSON.stringify(a));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
const { pass, fail } = summary();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await env.close();
process.exit(fail ? 1 : 0);
