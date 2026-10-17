// E2E: 四角の辺ごとの表示/非表示(塗りは残る)
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "rs01");
await openPdf(page, "tests/fixtures/sample.pdf");

const sel = () => page.evaluate(() => {
  const S = window.__apdf;
  const pg = S.model.pages[0];
  const sh = pg.shapes.find((x) => x.type === "rect");
  S.editor.setTool("select");
  S.editor.setSelection({ pageId: pg.id, shapeId: sh.id });
});
await page.evaluate(() => {
  const m = window.__apdf.model;
  m.addShape(m.pages[0].id, { type: "rect", pts: [[100, 100], [220, 180]], style: { color: "#e11d48", width: 2, fill: "#facc15", fillOpacity: 0.5 } });
});
await sel();
await page.waitForSelector('[data-act="rect-side"]', { state: "attached" });
check("四角を選ぶと辺の切り替え欄が出る", (await page.locator('[data-act="rect-side"]').count()) === 4);
await page.locator('[data-act="rect-side"][data-side="l"]').click();
await page.locator('[data-act="rect-side"][data-side="r"]').click();
const hide = await page.evaluate(() => window.__apdf.model.pages[0].shapes.find((x) => x.type === "rect").hide);
check("左右をオフにすると hide に入る", hide?.length === 2 && hide.includes("l") && hide.includes("r"), JSON.stringify(hide));
const paths = await page.evaluate(() => {
  const g = document.querySelector(".shape-rect");
  return [...g.querySelectorAll("path:not(.hit)")].map((p) => ({ d: p.getAttribute("d"), fill: p.getAttribute("fill"), stroke: p.getAttribute("stroke") }));
});
const stroke = paths.find((p) => p.stroke !== "none");
check("塗りは全体に残る", paths.some((p) => p.fill === "#facc15" && /Z/i.test(p.d)), JSON.stringify(paths));
check("線は上下の2本だけ(M が2つ)", (stroke.d.match(/M/g) || []).length === 2, stroke.d);

// 取り消し・やり直し
await page.keyboard.press("Control+z");
const h2 = await page.evaluate(() => window.__apdf.model.pages[0].shapes.find((x) => x.type === "rect").hide);
check("取り消しで1辺ずつ戻る", h2?.length === 1, JSON.stringify(h2));
await page.locator('[data-act="rect-side"][data-side="r"]').click();

// DXF: 見える辺の数だけ折れ線
const dxfOk = await page.evaluate(async () => {
  const { buildDxf } = await import("./js/dxf.js");
  const pg = window.__apdf.model.pages[0];
  const txt = buildDxf(pg, window.__apdf.model.layers, {}).text;
  return (txt.match(/LWPOLYLINE/g) || []).length;
});
check("DXFは上・下の2本の折れ線", dxfOk === 2, String(dxfOk));

// 反転しても同じ辺(上下左右)が隠れたまま
await page.evaluate(() => {
  const S = window.__apdf;
  const sh = S.model.pages[0].shapes.find((x) => x.type === "rect");
  S.model.mutate(() => { sh.pts = [sh.pts[1], sh.pts[0]]; });
});
const kept = await page.evaluate(async () => {
  const { rectHiddenEdges } = await import("./js/geometry.js");
  const sh = window.__apdf.model.pages[0].shapes.find((x) => x.type === "rect");
  return rectHiddenEdges(sh);
});
check("対角を入れ替えても隠れる辺は左右のまま", JSON.stringify(kept) === JSON.stringify([false, true, false, true]), JSON.stringify(kept));
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
