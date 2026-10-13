// E2E: ページ一覧の Ctrl/Shift+クリックで複数選択・まとめて並べ替え・ドロップした場所へ保存(DownloadURL)・
// 書き出しの保存先選択(最初は今のファイルと同じ場所)
import { createRequire } from "node:module";
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { PDFDocument } = require("pdf-lib");

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "pagesel01");
await openPdf(page, "tests/fixtures/sample.pdf");
// 4ページ以上にする
await page.evaluate(() => { const m = window.__apdf.model; while (m.pages.length < 4) m.insertBlank(m.pages.length); });
await page.click("#btnPages");
await page.waitForFunction(() => document.querySelectorAll("#thumbs .thumb").length >= 4);
const ids = () => page.evaluate(() => window.__apdf.model.pages.map((p) => p.id));
const ids0 = await ids();
const thumb = (i) => page.locator("#thumbs .thumb").nth(i).locator(".tv");
const state = () => page.evaluate(() => [...document.querySelectorAll("#thumbs .thumb")].map((t) => ({
  cb: t.querySelector("input[type=checkbox]").checked, cls: t.classList.contains("checked"), set: window.__apdf.thumbs.checked.has(t.dataset.id),
})));
const onIdx = (st) => st.map((s, i) => (s.cb && s.cls && s.set ? i : null)).filter((i) => i !== null);

/* ---- 1) Ctrl+クリック / Shift+クリック ---- */
await page.evaluate(() => window.__apdf.editor.scrollToPage(window.__apdf.model.pages[3].id));
await page.waitForTimeout(300);
const cur0 = await page.evaluate(() => window.__apdf.editor.curPageId);
await thumb(0).click({ modifiers: ["Control"] });
check("Ctrl+クリックでチェックが入る(チェックボックス・色・選択の3つとも)", JSON.stringify(onIdx(await state())) === "[0]", JSON.stringify(await state()));
check("Ctrl+クリックではページは移動しない", (await page.evaluate(() => window.__apdf.editor.curPageId)) === cur0);
await thumb(2).click({ modifiers: ["Control"] });
check("Ctrl+クリックで2つ目も追加される", JSON.stringify(onIdx(await state())) === "[0,2]");
await thumb(0).click({ modifiers: ["Control"] });
check("もう一度Ctrl+クリックで外れる", JSON.stringify(onIdx(await state())) === "[2]");
await thumb(0).click({ modifiers: ["Meta"] });
check("Mac の ⌘+クリックでも選べる", JSON.stringify(onIdx(await state())) === "[0,2]");
check("削除ボタンに選んだ数が出る", (await page.textContent('#thumbs [data-bar="del"]')).includes("2"));
// Shift+クリック: 前にクリックしたページ(1ページ目)から4ページ目まで
await thumb(3).click({ modifiers: ["Shift"] });
check("Shift+クリックで範囲をまとめて選べる", JSON.stringify(onIdx(await state())) === "[0,1,2,3]", JSON.stringify(onIdx(await state())));
// チェックボックスとCtrl+クリックは同じ扱い
await page.locator("#thumbs .thumb").nth(1).locator("input[type=checkbox]").uncheck();
await thumb(3).click({ modifiers: ["Control"] });
check("チェックボックスで外した分も同じ選択に反映される", JSON.stringify(onIdx(await state())) === "[0,2]");
await thumb(1).click();
await page.waitForTimeout(300);
check("普通のクリックは従来どおりそのページへ移動(選択は変えない)", (await page.evaluate(() => window.__apdf.editor.curPageId)) === ids0[1] && JSON.stringify(onIdx(await state())) === "[0,2]");

/* ---- 2) チェックしたページをドラッグ → まとめて移動 ---- */
const dragTo = (from, toIdx, { end = true } = {}) => page.evaluate(([from, toIdx, end]) => {
  const ts = document.querySelectorAll("#thumbs .thumb");
  const r = ts[toIdx].getBoundingClientRect();
  const x = r.left + 30, y = r.top + 3; // toIdx のページの直前
  const dt = new DataTransfer();
  ts[from].dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const dragging = [...document.querySelectorAll("#thumbs .thumb.dragging")].length;
  ts[toIdx].dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  ts[toIdx].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
  if (end) ts[from].dispatchEvent(new DragEvent("dragend", { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
  return dragging;
}, [from, toIdx, end]);
// 3ページ目(チェック済み)を4ページ目の前へ → 1・3ページ目がまとめて 2ページ目の後ろへ
const nd = await dragTo(2, 3);
const ids1 = await ids();
check("ドラッグ中はチェックした全ページが薄くなる", nd === 2, nd);
check("チェックしたページがまとめて移動する(順番は保つ)", JSON.stringify(ids1) === JSON.stringify([ids0[1], ids0[0], ids0[2], ids0[3]]), JSON.stringify(ids1.map((x) => x.slice(-4))));
await page.click("#btnUndo");
check("まとめて移動も1回で取り消せる", JSON.stringify(await ids()) === JSON.stringify(ids0));
// チェックしていないページのドラッグは、そのページだけ
await page.waitForFunction(() => document.querySelectorAll("#thumbs .thumb").length >= 4);
await dragTo(3, 0);
check("チェックしていないページはそのページだけ動く", JSON.stringify(await ids()) === JSON.stringify([ids0[3], ids0[0], ids0[1], ids0[2]]));
await page.click("#btnUndo");
await page.waitForFunction(() => document.querySelectorAll("#thumbs .thumb").length >= 4);

/* ---- 3) ドロップした場所へ保存(Chrome/Edge: DownloadURL) ---- */
const pdfPages = async (url) => {
  const b64 = await page.evaluate(async (u) => {
    const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, url);
  return (await PDFDocument.load(Buffer.from(b64, "base64"))).getPageCount();
};
const dragStartData = (i) => page.evaluate((i) => {
  const t = document.querySelectorAll("#thumbs .thumb")[i];
  const dt = new DataTransfer();
  t.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  const v = dt.getData("DownloadURL");
  t.dispatchEvent(new DragEvent("dragend", { bubbles: true, clientX: 300, clientY: 300, dataTransfer: dt }));
  return v;
}, i);
check("Chrome(PC)ではドロップ先への保存が有効", await page.evaluate(() => window.__apdf.thumbs.canDropSave));
// マウスを乗せると裏でPDFを作り始める
// 乗せたページのPDFができるまで待つ
const readyFor = (i) => page.waitForFunction((i) => {
  const t = window.__apdf.thumbs;
  const id = window.__apdf.model.pages[i].id;
  return t.ready?.key === t.pdfKey(t.dragSet(id));
}, i, { timeout: 15000 });
await thumb(1).hover();
await readyFor(1);
const du1 = await dragStartData(1);
const m1 = du1.match(/^application\/pdf:(.+\.pdf):(blob:.+)$/);
check("ドラッグに保存用のPDF(DownloadURL)が付く・名前はページ番号付き", !!m1 && /_p2\.pdf$/.test(m1[1]), du1);
check("付いたPDFはそのページだけ", m1 && (await pdfPages(m1[2])) === 1);
// チェックしたページ(1・3ページ目)を乗せてドラッグ → 2ページのPDF
await thumb(2).hover();
await readyFor(2);
const du2 = await dragStartData(2);
const m2 = du2.match(/^application\/pdf:(.+\.pdf):(blob:.+)$/);
check("チェックしたページをドラッグすると全部が1つのPDFになる", !!m2 && /_2ページ\.pdf$/.test(m2[1]) && (await pdfPages(m2[2])) === 2, du2);
// 書き込みでページが変わったら、古いPDFは付けない
await page.evaluate(() => { const m = window.__apdf.model; m.mutate(() => m.pages[1].shapes.push({ id: "zz", type: "rect", pts: [[10, 10], [60, 60]], style: { color: "#2563eb", width: 2 } })); });
const du3 = await dragStartData(1);
check("ページを書き換えた後は古いPDFを付けない", du3 === "", du3);
// デスクトップなどに落として保存された(dropEffect=copy)ときは、保存先を聞かずに知らせるだけ
await thumb(0).hover();
await thumb(1).hover();
await readyFor(1);
await page.evaluate(() => { window.__picks = []; window.showSaveFilePicker = async (o) => { window.__picks.push(o); throw new DOMException("x", "AbortError"); }; });
await page.evaluate(() => {
  const t = document.querySelectorAll("#thumbs .thumb")[1];
  const dt = new DataTransfer();
  t.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  Object.defineProperty(dt, "dropEffect", { value: "copy" }); // 作ったDataTransferには代入できないので上書き
  t.dispatchEvent(new DragEvent("dragend", { bubbles: true, clientX: -50, clientY: 300, dataTransfer: dt }));
});
await page.waitForTimeout(300);
check("ドロップ先に保存できたら通知だけ出す", (await page.locator(".toast", { hasText: "ドロップした場所に保存しました" }).count()) >= 1 && (await page.evaluate(() => window.__picks.length)) === 0);

/* ---- 4) 書き出し: 保存先を選ぶ(最初は今のファイルと同じ場所) ---- */
await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  window.__orig = await root.getFileHandle("orig.pdf", { create: true });
  window.__out = await root.getFileHandle("out.pdf", { create: true });
  window.__apdf.model.meta.fileHandle = window.__orig; // PCで開いたファイル(場所が分かる)
  window.__picks = [];
  window.showSaveFilePicker = async (o) => { window.__picks.push(o); return window.__out; };
});
await page.click('#thumbs [data-bar="exp"]');
await page.waitForSelector(".toast >> text=を保存しました", { timeout: 15000 });
const pick = await page.evaluate(async () => {
  const o = window.__picks[0];
  return { n: window.__picks.length, name: o.suggestedName, same: o.startIn ? await o.startIn.isSameEntry(window.__orig) : false, id: o.id };
});
check("書き出しで保存先を選ぶ画面が開く", pick.n === 1 && /_2ページ\.pdf$/.test(pick.name), JSON.stringify(pick));
check("保存先の最初の場所は今のファイルと同じ場所", pick.same && !!pick.id, JSON.stringify(pick));
const outPages = async () => {
  const b64 = await page.evaluate(async () => {
    const buf = new Uint8Array(await (await window.__out.getFile()).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return btoa(s);
  });
  return (await PDFDocument.load(Buffer.from(b64, "base64"))).getPageCount();
};
check("選んだ場所にチェックしたページだけのPDFが保存される", (await outPages()) === 2);
// キャンセルしたら何も作らない
let dls = 0;
page.on("download", () => dls++);
await page.evaluate(() => { window.showSaveFilePicker = async () => { throw new DOMException("cancel", "AbortError"); }; });
await page.click('#thumbs [data-bar="exp"]');
await page.waitForTimeout(600);
check("保存先選びをキャンセルしたら保存しない", dls === 0 && !(await page.locator(".busy:visible").count()));
// 場所が分からないファイル(Googleドライブ・白紙など)は、前回選んだフォルダから(id で覚える)
await page.evaluate(() => { window.__apdf.model.meta.fileHandle = null; window.__picks = []; window.showSaveFilePicker = async (o) => { window.__picks.push(o); return window.__out; }; });
await page.click('#thumbs [data-bar="exp"]');
await page.waitForFunction(() => window.__picks.length === 1);
check("場所が分からないファイルは前回のフォルダから(startIn なし・id あり)", await page.evaluate(() => !window.__picks[0].startIn && !!window.__picks[0].id));
await page.waitForTimeout(800);

// 保存・出力 → PDFを端末に保存 でも同じ
await page.evaluate(() => { window.__apdf.model.meta.fileHandle = window.__orig; window.__picks = []; });
await page.click("#btnSave");
await page.locator("#menu button", { hasText: "PDFを端末に保存" }).click();
await page.waitForSelector("dialog[open] #exName");
check("ボタンは「作成して保存先を選ぶ」", (await page.textContent("dialog[open] .foot .btn.primary")).includes("保存先を選ぶ"));
await page.click("dialog[open] .foot .btn.primary");
await page.waitForFunction(() => window.__picks.length === 1, null, { timeout: 15000 });
const p2 = await page.evaluate(async () => ({ same: await window.__picks[0].startIn?.isSameEntry(window.__orig), name: window.__picks[0].suggestedName }));
check("端末に保存も最初は今のファイルと同じ場所", p2.same === true && /\.pdf$/.test(p2.name), JSON.stringify(p2));
await page.waitForSelector(".toast >> text=out.pdf", { timeout: 15000 });
check("選んだ場所に全ページのPDFが保存される", (await outPages()) === ids0.length);
check("ダウンロードフォルダには保存しない", dls === 0, dls);

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const { fail } = summary();
if (fail) process.exitCode = 1;
