// E2E: 狭い寸法も描ける / 寸法値の引出線をアンダーラインにして、その上に書く
import { launch, register, openPdf, setZoom1, tool, shapes, drag, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "dimul01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
const sel = (id) => page.evaluate((i) => { const m = window.__apdf.model; window.__apdf.editor.setSelection({ pageId: m.pages[0].id, shapeId: i }); }, id);

/* ---- 狭い寸法 ---- */
await page.evaluate(() => window.__apdf.editor.setZoom(4));
await page.waitForTimeout(300);
await tool(page, "dim");
await drag(page, 0, [100, 100], [103, 100], { steps: 4 });
check("拡大していれば、3pt(画面で12px)の狭い寸法でも数値の入力が始まる", (await page.locator("dialog[open]").count()) === 1);
await page.keyboard.press("Escape");
await page.evaluate(() => window.__apdf.editor.setZoom(1));
await page.waitForTimeout(300);
await tool(page, "dim");
await drag(page, 0, [100, 100], [101, 100], { steps: 4 });
check("100%で1ptだけ動かしただけ(クリック同然)なら描かない", (await page.locator("dialog[open]").count()) === 0 && (await shapes(page)).length === 0);

/* ---- アンダーライン ---- */
const dimId = await page.evaluate(() => {
  const m = window.__apdf.model;
  return m.addShape(m.pages[0].id, { type: "dim", pts: [[100, 200], [300, 200]], off: 24, size: 12, text: "2000", style: { color: "#e11d48", width: 1 } }).id;
});
await tool(page, "select");
await sel(dimId);
const handle = page.locator('.handle[data-kind="txt"]');
check("寸法値をつかむ手がかりがある", await handle.count() === 1);
const box = await handle.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 60, { steps: 8 });
await page.mouse.up();
let s = (await shapes(page)).find((x) => x.id === dimId);
check("引き出すと textOff が付き、アンダーラインが有効になる", Array.isArray(s.textOff) && s.ul === true, JSON.stringify(s));
const draw = () => page.evaluate((id) => {
  const g = document.querySelector(`[data-id="${id}"]`);
  const t = g?.querySelector("text");
  return { paths: g ? g.querySelectorAll("path:not(.hit)").length : 0, rot: t?.getAttribute("transform") || "" };
}, dimId);
let d = await draw();
check("文字は水平(回転0)", /rotate\(0[ )]/.test(d.rot), d.rot);
const pathsUl = d.paths;
await sel(dimId);
const cb = page.locator('#props input[type=checkbox][data-k="ul"]');
check("プロパティにアンダーラインの切り替えがある", await cb.count() === 1 && await cb.isChecked());
await cb.uncheck();
s = (await shapes(page)).find((x) => x.id === dimId);
d = await draw();
check("オフにすると従来の置き方(線が1本減る)に戻る", !s.ul && d.paths === pathsUl - 1, `${d.paths} vs ${pathsUl}`);
await cb.check();
check("オンに戻せる", (await shapes(page)).find((x) => x.id === dimId).ul === true);

/* ---- 縦の寸法: 引き出した文字も縦のまま、接続線は寸法線の中央から ---- */
const vId = await page.evaluate(() => {
  const m = window.__apdf.model;
  return m.addShape(m.pages[0].id, { type: "dim", pts: [[450, 100], [450, 300]], off: 24, size: 12, text: "2500", style: { color: "#e11d48", width: 1 } }).id;
});
await sel(vId);
const vb = await page.locator('.handle[data-kind="txt"]').boundingBox();
await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
await page.mouse.down();
await page.mouse.move(vb.x + vb.width / 2 + 40, vb.y + vb.height / 2 - 60, { steps: 8 });
await page.mouse.up();
const vd = await page.evaluate((id) => {
  const g = document.querySelector(`[data-id="${id}"]`);
  const paths = [...g.querySelectorAll("path:not(.hit)")].map((p) => p.getAttribute("d"));
  return { rot: g.querySelector("text")?.getAttribute("transform") || "", paths };
}, vId);
check("縦寸法を引き出しても文字は縦のまま(-90°)", /rotate\(-90 /.test(vd.rot), vd.rot);
check("接続線は寸法線の中央(y=200)から出る", vd.paths.some((d) => /^M[0-9.]+ 200 L/.test(d)), JSON.stringify(vd.paths));

/* ---- DXF ---- */
const dxf = await page.evaluate(async () => {
  const { buildDxf } = await import("/js/dxf.js");
  const m = window.__apdf.model;
  const r = buildDxf({ w: m.pages[0].w, h: m.pages[0].h, shapes: m.pages[0].shapes, scale: m.pages[0].scale }, m.layers, { metrics: () => ({ w: 30, h: 14, lines: ["2000"] }) });
  return r.text.split("\n").filter((l) => l.trim() === "LINE").length;
});
check("DXFにも線が出る(寸法線・補助線2・引出線・アンダーライン)", dxf >= 5, String(dxf));
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`dimul: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
