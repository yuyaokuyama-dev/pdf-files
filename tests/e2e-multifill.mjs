// E2E: 複数選択で、塗れる図形だけを同じ色でまとめて塗りつぶす
import { launch, register, openPdf, setZoom1, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "mfill01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const ids = await page.evaluate(() => {
  const m = window.__apdf.model;
  const pid = m.pages[0].id;
  const st = () => ({ color: "#e11d48", width: 1 });
  const a = m.addShape(pid, { type: "rect", pts: [[60, 60], [160, 140]], style: st() }).id;
  const b = m.addShape(pid, { type: "ellipse", pts: [[200, 60], [300, 140]], style: st() }).id;
  const c = m.addShape(pid, { type: "line", pts: [[60, 200], [300, 200]], style: st() }).id;
  window.__apdf.editor.setMultiSelection(pid, [a, b, c]);
  return [a, b, c];
});
const fillOn = page.locator('#props input[type=checkbox][data-k="fillOn"]');
check("複数選択に塗りつぶしの欄が出る", (await fillOn.count()) === 1);
await fillOn.check();
let sh = await shapes(page);
const f = (id) => sh.find((s) => s.id === id).style.fill;
check("四角と丸が塗られ、線は塗られない", f(ids[0]) && f(ids[0]) !== "none" && f(ids[0]) === f(ids[1]) && !f(ids[2]), JSON.stringify(sh.map((s) => s.style)));
await page.locator('#props input[data-k="fillColor"]').evaluate((el) => { el.value = "#16a34a"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
sh = await shapes(page);
check("色を選ぶと全部同じ色になる", f(ids[0]) === "#16a34a" && f(ids[1]) === "#16a34a" && !f(ids[2]));
await page.locator('#props input[type=checkbox][data-k="fillOn"]').uncheck();
sh = await shapes(page);
check("外すとまとめて塗りなしに戻る", f(ids[0]) === "none" && f(ids[1]) === "none");
await page.evaluate(() => {
  const S = window.__apdf;
  const m = S.model;
  const pid = m.pages[0].id;
  const l2 = m.addShape(pid, { type: "line", pts: [[60, 240], [300, 240]], style: { color: "#e11d48", width: 1 } }).id;
  S.editor.setMultiSelection(pid, [m.pages[0].shapes.find((x) => x.type === "line").id, l2]);
});
check("線だけの複数選択には塗りつぶしの欄を出さない", (await page.locator('#props input[data-k="fillOn"]').count()) === 0);
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`multifill: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
