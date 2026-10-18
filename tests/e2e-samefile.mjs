// E2E: 同じファイルを二重に開かない(場所で判定・場所が無ければ中身で判定) /
// アプリを閉じたらタブも全て閉じて履歴へ / 履歴の「保存」で元のファイルに上書き / 計測線の太さ
import { readFileSync } from "node:fs";
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, ctx, errors } = env;
const pdf = Array.from(readFileSync("tests/fixtures/sample.pdf"));
// 「このアプリで開く」(launchQueue)で、場所の分かるファイル(OPFS の本物のハンドル)を渡す
await page.addInitScript(() => {
  Object.defineProperty(window, "launchQueue", { configurable: true, value: { setConsumer: (fn) => (window.__lq = fn) } });
});
await page.goto(env.base);
await register(page, "same01");
await page.evaluate(async (arr) => {
  const root = await navigator.storage.getDirectory();
  for (const n of ["e2e-dirA", "e2e-dirB"]) {
    const dir = await root.getDirectoryHandle(n, { create: true }); // 同じ名前・同じ中身で、場所だけ違うファイル
    const h = await dir.getFileHandle("plan.pdf", { create: true });
    const w = await h.createWritable();
    await w.write(new Uint8Array(arr));
    await w.close();
  }
}, pdf);
const launchFile = (dir) => page.evaluate(async (dir) => {
  const root = await navigator.storage.getDirectory();
  const h = await (await root.getDirectoryHandle(dir)).getFileHandle("plan.pdf");
  window.__lq({ files: [h] });
}, dir);
const tabCount = () => page.evaluate(() => window.__apdf.tabs.length);
const waitTabs = (n) => page.waitForFunction((n) => window.__apdf.tabs.length === n && window.__apdf.model.pages.length > 0, n, { timeout: 20000 });

/* ---------- ① 同じ場所のファイルは新しいタブにしない ---------- */
await launchFile("e2e-dirA");
await waitTabs(1);
const idA = await page.evaluate(() => window.__apdf.model.meta.projectId);
check("場所の分かるファイルはハンドルを覚える", await page.evaluate(() => window.__apdf.model.meta.fileHandle?.kind === "file"));
await openPdf(page, "tests/fixtures/rotated.pdf"); // 別のファイル
await waitTabs(2);
await launchFile("e2e-dirA");
await page.waitForFunction((id) => window.__apdf.model.meta.projectId === id, idA, { timeout: 15000 });
check("同じ場所のファイルを開くと、新しいタブを作らず開いているタブを表示", (await tabCount()) === 2);
check("「すでに開いています」と知らせる", (await page.textContent("#toast")).includes("すでに開いています"));
await launchFile("e2e-dirB");
await waitTabs(3);
check("名前・中身が同じでも場所が違えば別のファイルとして開く", (await page.evaluate(() => window.__apdf.model.meta.projectId)) !== idA);

// 場所が分からない開き方(iPhone など): 中身で判定
await openPdf(page, "tests/fixtures/rotated.pdf");
await page.waitForTimeout(500);
check("場所が分からない場合は中身で同じファイルと判定し、タブを増やさない", (await tabCount()) === 3);
check("そのファイルのタブが表示される", (await page.evaluate(() => window.__apdf.model.meta.name)) === "rotated.pdf");

/* ---------- 編集 → すべて閉じる → 履歴から保存(元のファイルに上書き) ---------- */
await page.locator("#tabbar .tab").first().click();
await page.waitForFunction((id) => window.__apdf.model.meta.projectId === id, idA, { timeout: 15000 });
await setZoom1(page);
await tool(page, "rect");
await drag(page, 0, [100, 100], [300, 200]);
check("編集すると未保存になる", await page.evaluate(() => window.__apdf.model.meta.unsaved === true));
await page.waitForTimeout(1500); // 端末内への自動保存
await page.click("#btnFile");
await page.locator("#menu button", { hasText: "すべて閉じる" }).click();
await page.waitForFunction(() => window.__apdf.tabs.length === 0 && window.__apdf.model.pages.length === 0, null, { timeout: 15000 });
check("すべて閉じるとタブも全て閉じて空の画面になる", await page.locator("#empty").isVisible());
check("空の画面に「履歴から開く」がある", await page.locator("#emptyHistory").isVisible());
await page.waitForFunction(() => !document.querySelector("#emptyUnsaved").hidden);
check("保存していないファイルがあると空の画面で知らせる", (await page.textContent("#emptyUnsaved")).includes("1件"));
const sizeBefore = await page.evaluate(async () => (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("e2e-dirA")).getFileHandle("plan.pdf")).getFile()).size);
await page.click("#emptyHistory");
await page.waitForSelector("dialog[open] .item");
const items = page.locator("dialog[open] #hLocal .item");
check("閉じたファイルは履歴に残る", (await items.count()) === 3, `${await items.count()}`);
check("未保存のファイルだけ名前の横に保存ボタンが出る", (await page.locator("dialog[open] [data-save]").count()) === 1);
const row = items.filter({ has: page.locator(`[data-open="${idA}"]`) });
check("編集したファイルに保存ボタンが出て、名前と同じ行にある", (await row.locator(".name-row [data-save]").count()) === 1);
await row.locator("[data-save]").click();
await page.waitForFunction(() => !document.querySelector("dialog[open] [data-save]"), null, { timeout: 20000 });
const after = await page.evaluate(async () => {
  const f = await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("e2e-dirA")).getFileHandle("plan.pdf")).getFile();
  return { size: f.size, head: new TextDecoder().decode(new Uint8Array(await f.slice(0, 5).arrayBuffer())) };
});
check("保存ボタンで元のファイルに上書きされる", after.head === "%PDF-" && after.size !== sizeBefore, JSON.stringify({ sizeBefore, after }));
check("保存後はボタンが消えて保存済みになる", (await row.locator(".sub").textContent()).includes("保存済み"));
const rec = await page.evaluate(async (id) => (await window.__apdf.store.get("recents", id)).unsaved, idA);
check("履歴の記録も保存済みになる", rec === false);
await page.locator("dialog[open] button", { hasText: "閉じる" }).last().click();

// 保存したファイルをもう一度開く → 履歴の編集データ(注釈を動かせる状態)で開き、タブは1つ
await launchFile("e2e-dirA");
await page.waitForFunction((id) => window.__apdf.model.meta.projectId === id, idA, { timeout: 15000 });
check("履歴にある同じファイルは、履歴の編集データで開く(重複しない)", (await tabCount()) === 1 && (await shapes(page)).some((s) => s.type === "rect"));

/* ---------- アプリを閉じて開き直す → タブは全て閉じた状態 / 再読み込みはそのまま ---------- */
await page.reload();
await page.waitForFunction(() => window.__apdf?.model?.pages.length > 0, null, { timeout: 20000 });
check("再読み込みでは開いていたタブが戻る", (await tabCount()) === 1);
const p2 = await ctx.newPage();
await page.close();
const e2 = [];
p2.on("pageerror", (e) => e2.push(e.message));
await p2.goto(env.base);
await p2.waitForSelector("#app:not([hidden])", { timeout: 15000 });
await p2.waitForTimeout(800);
check("アプリを開き直すと、タブも含めて全て閉じた状態から始まる", await p2.evaluate(() => window.__apdf.tabs.length === 0 && window.__apdf.model.pages.length === 0));
check("閉じたファイルは履歴に残っている", (await p2.evaluate(async () => (await window.__apdf.store.getAll("recents")).length)) === 3);

/* ---------- ③ 計測の線の太さ(0.5〜) ---------- */
await p2.evaluate(() => document.querySelector("#emptyBlank").click());
await p2.waitForFunction(() => window.__apdf.model.pages.length > 0 && document.querySelectorAll('.page[data-rendered="1"]').length >= 1, null, { timeout: 15000 });
await p2.evaluate(() => { const S = window.__apdf; S.editor.sticky = false; S.model.pages[0].scale = { unit: "mm", ptsPerUnit: 0.1 }; });
await setZoom1(p2);
await tool(p2, "measure");
await p2.waitForSelector('#props:not([hidden]) input[type=range][data-k="width"]');
check("計測にも線の太さスライダーがあり、最小は0.1", (await p2.locator('#props input[type=range][data-k="width"]').getAttribute("min")) === "0.1");
await p2.locator('#props input[type=range][data-k="width"]').evaluate((el) => { el.value = 0.5; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
await drag(p2, 0, [100, 300], [300, 300]);
let ms = (await shapes(p2)).at(-1);
check("計測線を太さ0.5で引ける", ms.type === "measure" && ms.style.width === 0.5, JSON.stringify(ms.style));
check("他の線の太さは変わらない", (await p2.evaluate(() => window.__apdf.editor.style.width)) === 1);
await tool(p2, "select");
await click(p2, 0, [200, 300]);
await p2.waitForSelector('#props:not([hidden]) input[type=range][data-k="width"]');
await p2.locator('#props input[type=range][data-k="width"]').evaluate((el) => { el.value = 3; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
ms = (await shapes(p2)).at(-1);
check("選択中の計測線の太さを変えられる", ms.style.width === 3, JSON.stringify(ms.style));
const sw = await p2.evaluate(() => document.querySelector(".shape-measure path:not(.hit)")?.getAttribute("stroke-width"));
check("画面の計測線に太さが反映される", sw === "3", sw);

check("コンソールエラーなし", errors.length === 0 && e2.length === 0, [...errors, ...e2].join("\n"));
await env.close();
const s = summary();
console.log(`samefile: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
