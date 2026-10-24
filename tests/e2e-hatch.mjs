// E2E: 塗りつぶしスタイル(斜線・格子)と、線の角度・間隔・太さ。複数選択・描画・保存して開き直し・PDF出力
import { launch, register, openPdf, setZoom1, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "hatch01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const ids = await page.evaluate(() => {
  const m = window.__apdf.model;
  const pid = m.pages[0].id;
  const st = () => ({ color: "#e11d48", width: 1 });
  const a = m.addShape(pid, { type: "rect", pts: [[60, 60], [200, 160]], style: st() }).id;
  const b = m.addShape(pid, { type: "ellipse", pts: [[240, 60], [360, 160]], style: st() }).id;
  window.__apdf.editor.setSelection({ pageId: pid, shapeId: a });
  return [a, b];
});
const sty = async (i = 0) => (await shapes(page)).find((s) => s.id === ids[i]).style;
const segs = (id) => page.evaluate((id) => document.querySelectorAll(`.shape[data-id="${id}"] path.hatch`).length, id);

// ① 塗りつぶしチェックの下に「塗りつぶしスタイル」が出る
check("塗りなしのときはスタイルの欄が出ない", (await page.locator('#props select[data-k="fillStyle"]').count()) === 0);
await page.locator('#props input[type=checkbox][data-k="fillOn"]').check();
const sel = page.locator('#props select[data-k="fillStyle"]');
check("塗りつぶしにするとスタイルの欄(べた塗り・斜線・格子)が出る", (await sel.count()) === 1 && (await sel.locator("option").allTextContents()).join() === "べた塗り,斜線,格子");
const order = await page.evaluate(() => { const p = document.querySelector("#props"); const a = p.querySelector('[data-k="fillOn"]'), b = p.querySelector('[data-k="fillStyle"]'); return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); });
check("スタイルの欄は塗りつぶしチェックの下にある", order);
check("べた塗りのあいだは「塗りの濃さ」を出し、ハッチングの欄は出さない", (await page.locator('#props [data-k="fillOpacity"]').count()) > 0 && (await page.locator('#props input[data-k="hatchAngle"]').count()) === 0);

// ② 斜線
await sel.selectOption("lines");
check("斜線にするとハッチングの角度・間隔・太さの欄が出る", (await page.locator('#props input[data-k="hatchAngle"]').count()) === 1 && (await page.locator('#props input[data-k="hatchGap"]').count()) === 1 && (await page.locator('#props input[data-k="hatchWidth"]').count()) === 1);
check("「塗りの濃さ」は出なくなる", (await page.locator('#props [data-k="fillOpacity"]').count()) === 0);
check("画面に斜線が描かれ、べた塗りはされない", (await segs(ids[0])) === 1 && (await page.evaluate((id) => !document.querySelector(`.shape[data-id="${id}"] path[fill-opacity]`), ids[0])));
const n45 = await page.evaluate((id) => document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("d").split("M").length - 1, ids[0]);

const setNum = (k, v) => page.locator(`#props input[data-k="${k}"]`).evaluate((el, v) => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); }, v);
await setNum("hatchAngle", "0");
check("角度0にすると水平の線になる", await page.evaluate((id) => { const d = document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("d"); return [...d.matchAll(/M([\d.-]+) ([\d.-]+)L([\d.-]+) ([\d.-]+)/g)].every((m) => m[2] === m[4]); }, ids[0]));
await setNum("hatchGap", "6");
const n6 = await page.evaluate((id) => document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("d").split("M").length - 1, ids[0]);
await setNum("hatchGap", "3");
const n3 = await page.evaluate((id) => document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("d").split("M").length - 1, ids[0]);
check("間隔を半分にすると線の本数がほぼ2倍になる", n3 > n6 * 1.8 && n3 < n6 * 2.2, `${n6} -> ${n3}`);
await setNum("hatchWidth", "2");
check("線の太さを変えられる", (await page.evaluate((id) => document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("stroke-width"), ids[0])) === "2");
await page.locator('#props input[data-k="fillColor"]').evaluate((el) => { el.value = "#2563eb"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
check("線の色は塗りの色", (await page.evaluate((id) => document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("stroke"), ids[0])) === "#2563eb");
let st = await sty();
check("設定が図形に保存される", st.fillStyle === "lines" && st.hatchAngle === 0 && st.hatchGap === 3 && st.hatchWidth === 2, JSON.stringify(st));

// ③ 格子
await sel.selectOption("cross");
await setNum("hatchAngle", "45");
const nx = await page.evaluate((id) => document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("d").split("M").length - 1, ids[0]);
check("格子にすると斜線の約2倍の本数になる", nx > n45 * 1.6, `${n45} -> ${nx}`);

// ④ 複数選択でまとめて設定
await page.evaluate(([a, b]) => { const S = window.__apdf; S.editor.setMultiSelection(S.model.pages[0].id, [a, b]); }, ids);
const ms = page.locator('#props select[data-k="fillStyle"]');
check("複数選択にも塗りつぶしスタイルが出る(塗れる図形があるとき)", (await ms.count()) === 1);
// 先頭の四角は塗り済みなのでチェックは付いている。いったん外してから付け直すと、全部が同じ色で塗られる
await page.locator('#props input[type=checkbox][data-k="fillOn"]').uncheck();
await page.locator('#props input[type=checkbox][data-k="fillOn"]').check();
await ms.selectOption("lines");
await setNum("hatchGap", "4");
check("複数選択でまとめて斜線・同じ間隔になる", (await sty(0)).fillStyle === "lines" && (await sty(1)).fillStyle === "lines" && (await sty(1)).hatchGap === 4 && (await segs(ids[1])) === 1);
check("丸の中だけに線が引かれる(線が丸の外接矩形に収まる)", await page.evaluate((id) => { const d = document.querySelector(`.shape[data-id="${id}"] path.hatch`).getAttribute("d"); return [...d.matchAll(/([\d.-]+) ([\d.-]+)/g)].every((m) => +m[1] >= 239.9 && +m[1] <= 360.1 && +m[2] >= 59.9 && +m[2] <= 160.1); }, ids[1]));

// ⑤ PDFに出力 → 開き直すと設定が戻る
const back = await page.evaluate(async () => {
  const S = window.__apdf;
  const { exportPdf } = await import("./js/export.js");
  const m = S.model;
  const res = await exportPdf(m, { level: "standard", embedEdit: true });
  const bytes = res.bytes;
  const pdfjs = await import("./vendor/pdf.min.mjs");
  const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  const { readEdit } = await import("./js/editdata.js");
  const edit = await readEdit(pdf);
  return { size: bytes.length, shapes: edit?.pages?.[0]?.shapes?.map((s) => s.style) ?? null };
});
check("PDFが作られ、編集用データにハッチングの設定が残る", back.size > 1000 && back.shapes?.length >= 2 && back.shapes.every((s) => s.fillStyle === "lines" && s.hatchGap === 4), JSON.stringify(back).slice(0, 300));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`hatch: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
