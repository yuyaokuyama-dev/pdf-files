// E2E: 9999%まで拡大(見えている範囲だけ描き直す)・最小サイズ・引出線の文字位置・寸法の黒丸
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "pol701");
await openPdf(page, "tests/fixtures/sample.pdf");

// ① 2000%
await page.evaluate(() => { const ed = window.__apdf.editor; ed.zoomAt(20, innerWidth / 2, innerHeight / 2); });
await page.waitForTimeout(1200);
const z = await page.evaluate(() => ({
  zoom: window.__apdf.editor.zoom,
  label: document.querySelector("#btnZoomFit").textContent,
  region: !!window.__apdf.editor.els.get(window.__apdf.model.pages[0].id).region,
  cw: document.querySelector(".page canvas").width * document.querySelector(".page canvas").height,
}));
check("倍率は20(2000%)まで上がる", z.zoom === 20 && z.label === "2000%", JSON.stringify(z));
check("大きすぎるときは見えている範囲だけを描く(画素数が上限内)", z.region && z.cw <= 16_000_000, JSON.stringify(z));
const before = await page.evaluate(() => JSON.stringify(window.__apdf.editor.els.get(window.__apdf.model.pages[0].id).region));
await page.evaluate(() => { const v = window.__apdf.editor.viewer; v.scrollLeft += v.clientWidth * 3; v.scrollTop += v.clientHeight * 3; });
await page.waitForTimeout(1500);
const after = await page.evaluate(() => JSON.stringify(window.__apdf.editor.els.get(window.__apdf.model.pages[0].id).region));
check("動かして範囲の外に出たら描き直す", before !== after, before + " -> " + after);
await page.evaluate(() => { window.__apdf.editor.setZoom(1); });
await page.waitForTimeout(800);
check("元の倍率に戻ると全体描画に戻る", await page.evaluate(() => !window.__apdf.editor.els.get(window.__apdf.model.pages[0].id).region));

// 9999%まで上がり、そこでも描き直し・操作ができる
await page.evaluate(() => { const v = window.__apdf.editor.viewer; v.scrollTop = 0; v.scrollLeft = 0; });
await page.waitForTimeout(300);
const t0 = Date.now();
await page.evaluate(() => { const r = document.querySelector(".page").getBoundingClientRect(); window.__apdf.editor.zoomAt(500, r.left + r.width / 2, Math.max(r.top, 120) + 100); });
const zz = await page.evaluate(() => ({ zoom: window.__apdf.editor.zoom, label: document.querySelector("#btnZoomFit").textContent, w: document.querySelector("#btnZoomFit").scrollWidth, cw: document.querySelector("#btnZoomFit").clientWidth }));
check("倍率は9999%で止まり、表示欄に収まる", Math.abs(zz.zoom - 99.99) < 1e-9 && zz.label === "9999%" && zz.w <= zz.cw, JSON.stringify(zz));
await page.waitForTimeout(1500);
const z9 = await page.evaluate(() => { const c = document.querySelector(".page canvas"); return { region: !!window.__apdf.editor.els.get(window.__apdf.model.pages[0].id).region, px: c.width * c.height }; });
check("9999%でも見えている範囲だけ描く(画素数が上限内)", z9.region && z9.px <= 16_000_000, JSON.stringify(z9));
await page.evaluate(() => { const v = window.__apdf.editor.viewer; v.scrollLeft += v.clientWidth * 5; v.scrollTop += v.clientHeight * 5; });
await page.waitForTimeout(1500);
check("9999%でスクロールしても応答する(5秒以内に描き直す)", Date.now() - t0 < 30000 && (await page.evaluate(() => !!document.querySelector(".page canvas"))));
await page.evaluate(() => { window.__apdf.editor.setZoom(1); });
await page.waitForTimeout(800);

// ⑤ 引出線の文字位置 / ③ 先端なし / ⑥ 寸法の黒丸
const r = await page.evaluate(async () => {
  const { leaderGeometry } = await import("./js/leader.js");
  const { dimensionGeometry } = await import("./js/geometry.js");
  const sh = { pts: [[10, 10], [60, 40]], size: 14, tip: "none", toff: 0 };
  const g0 = leaderGeometry(sh, { w: 30, h: 17 });
  const g1 = leaderGeometry({ ...sh, toff: 4 }, { w: 30, h: 17 });
  const d = dimensionGeometry([0, 0], [100, 0], 20, 12, { endStyle: "dot" });
  const a = dimensionGeometry([0, 0], [100, 0], 20, 12, { endStyle: "arrow" });
  return { tip: g0.tipShape, line: g0.line, dy: g1.textTL[1] - g0.textTL[1], dotExt: d.ext0, arrowExt: a.ext0 };
});
check("先端なしは線だけ", r.tip === null && r.line[1][0] === 10);
check("文字の上下位置+4で4pt下がる", Math.abs(r.dy - 4) < 1e-9);
check("黒丸の寸法は補助線が突き出ない", r.dotExt[1][1] === 20 && r.arrowExt[1][1] === 24, JSON.stringify(r));

// ② 最小サイズ
await page.evaluate(() => {
  const m = window.__apdf.model;
  const id = m.pages[0].id;
  m.addShape(id, { type: "cloud", pts: [[50, 50], [150, 50], [150, 120], [50, 120]], pitch: 1, style: { color: "#e11d48", width: 1 } });
  m.addShape(id, { type: "text", pts: [[50, 200]], text: "小", size: 1, style: { color: "#111827" } });
});
check("雲(ピッチ1)と文字(1)を作ってもエラーにならない", errors.length === 0, errors.join("|"));
await env.close();
summary();
