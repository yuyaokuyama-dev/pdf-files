// E2E: 別ウィンドウのファイルのページ一覧へ、ページをドラッグ&ドロップで入れる(既定はコピー、Shiftで移動)
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page: A, ctx, errors } = env;
await A.goto(env.base);
await register(A, "xpages01");
await openPdf(A, "tests/fixtures/sample.pdf");
const idSample = await A.evaluate(() => window.__apdf.model.meta.projectId);
await A.click("#btnFile");
await A.locator("#menu button", { hasText: "白紙から新規作成" }).click();
await A.waitForFunction(() => window.__apdf.model.meta.name === "白紙.pdf");

// sample.pdf のタブを別ウィンドウ(P)へドラッグして出す
const tab = await A.locator("#tabbar .tab", { hasText: /sample/ }).boundingBox();
const popupP = ctx.waitForEvent("page");
await A.mouse.move(tab.x + 20, tab.y + tab.height / 2);
await A.mouse.down();
await A.mouse.move(tab.x + 60, tab.y + 300, { steps: 6 });
await A.mouse.move(1400, 300, { steps: 6 });
await A.mouse.up();
const P = await popupP;
const perr = [];
P.on("pageerror", (e) => perr.push(e.message));
await P.waitForFunction(() => window.__apdf?.model?.pages.length > 0, null, { timeout: 20000 });
await A.waitForFunction(() => window.__apdf.model.meta.name === "白紙.pdf", null, { timeout: 15000 });

const nP0 = await P.evaluate(() => window.__apdf.model.pages.length);
const nA0 = await A.evaluate(() => window.__apdf.model.pages.length);
for (const pg of [A, P]) {
  if (!(await pg.locator("#thumbs").isVisible())) await pg.click("#btnPages");
  await pg.waitForFunction(() => document.querySelectorAll("#thumbs .thumb").length >= 1);
}

// P のページ一覧の1ページ目をドラッグ開始 → 運ぶデータを取り出す
async function pickUp() {
  const data = await P.evaluate(() => {
    const dt = new DataTransfer();
    const t = document.querySelector("#thumbs .thumb");
    t.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
    return dt.getData("application/x-pdffiles-xpages");
  });
  return data;
}
const drop = (data, shiftKey) => A.evaluate(([data, shiftKey]) => {
  const dt = new DataTransfer();
  dt.setData("application/x-pdffiles-xpages", data);
  const th = document.querySelector("#thumbs");
  const r = th.querySelector(".thumb").getBoundingClientRect();
  const y = r.bottom + 2; // 1ページ目の下 = 2番目の位置
  const over = new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: y, shiftKey, dataTransfer: dt });
  th.dispatchEvent(over);
  th.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: y, shiftKey, dataTransfer: dt }));
  return over.defaultPrevented;
}, [data, shiftKey]);

const payload = await pickUp();
check("ドラッグ開始で、ウィンドウとページを示すデータが付く", (() => { try { const p = JSON.parse(payload); return !!p.win && p.ids.length === 1; } catch { return false; } })(), payload);
const accepted = await drop(payload, false);
check("別ウィンドウのページ一覧はドロップを受け付ける", accepted);
await A.waitForFunction((n) => window.__apdf.model.pages.length === n + 1, nA0, { timeout: 20000 });
check("コピー: 受け取り側のページが1枚増える", true);
check("コピー: 元のファイルのページは減らない", (await P.evaluate(() => window.__apdf.model.pages.length)) === nP0);
check("2番目の位置に入る(元のファイルのページ)", await A.evaluate(() => { const m = window.__apdf.model; const s = m.sources.size; return m.pages[1].srcId && m.pages[1].srcId !== m.pages[0].srcId && s >= 1; }));
await P.evaluate(() => document.querySelector("#thumbs").dispatchEvent(new DragEvent("dragend", { bubbles: true })));

// Shift で離すと移動(元のファイルから消える)。元が2ページ以上のときだけ
if (nP0 >= 2) {
  const p2 = await pickUp();
  await drop(p2, true);
  await A.waitForFunction((n) => window.__apdf.model.pages.length === n + 2, nA0, { timeout: 20000 });
  await P.waitForFunction((n) => window.__apdf.model.pages.length === n - 1, nP0, { timeout: 10000 });
  check("Shift で離すと移動(元のファイルのページが1枚減る)", true);
} else {
  // 1ページしかない元のファイルは空にしない(コピーになる)
  const p2 = await pickUp();
  await drop(p2, true);
  await A.waitForFunction((n) => window.__apdf.model.pages.length === n + 2, nA0, { timeout: 20000 });
  check("元が1ページだけのときは、Shift でも移動せずコピーになる(ファイルを空にしない)", (await P.evaluate(() => window.__apdf.model.pages.length)) === 1);
}

check("コンソールエラーなし", errors.length === 0 && perr.length === 0, [...errors, ...perr].join("\n"));
await env.close();
const s = summary();
console.log(`xpages: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
