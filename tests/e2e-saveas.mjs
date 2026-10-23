// E2E: 保存・出力 → 別名で保存(名前と保存先を選ぶ。保存したあとは保存先が新しい場所に変わる)
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "saveas01");
await openPdf(page, "tests/fixtures/sample.pdf");

const menuItem = async (label) => { await page.click("#btnSave"); await page.locator("#menu button", { hasText: label }).click(); };
await page.click("#btnSave");
check("保存メニューに「別名で保存」がある", (await page.locator("#menu button", { hasText: "別名で保存" }).count()) === 1);
await page.keyboard.press("Escape");
await page.mouse.click(5, 400);

await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  window.__orig = await root.getFileHandle("orig.pdf", { create: true });
  window.__out = await root.getFileHandle("copy-out.pdf", { create: true });
  window.__apdf.model.meta.fileHandle = window.__orig; // PCで開いたファイル
  window.__picks = [];
  window.showSaveFilePicker = async (o) => { window.__picks.push(o); return window.__out; };
});

// ① キャンセル: 何も保存しない
await menuItem("別名で保存");
await page.waitForSelector("dialog[open] .foot .btn");
check("保存先に「この端末」と「Googleドライブ」が選べる", (await page.locator("dialog[open] .foot .btn", { hasText: "この端末" }).count()) === 1 && (await page.locator("dialog[open] .foot .btn", { hasText: "Googleドライブ" }).count()) === 1);
await page.locator("dialog[open] .foot .btn", { hasText: "キャンセル" }).click();
await page.waitForTimeout(300);
check("キャンセルしたら保存先選びも出ない", (await page.evaluate(() => window.__picks.length)) === 0);

// ② この端末: 名前を入れて保存先を選ぶ
await menuItem("別名で保存");
await page.locator("dialog[open] .foot .btn", { hasText: "この端末" }).click();
await page.waitForSelector("dialog[open] #pdIn");
check("名前の欄に今のファイル名(拡張子なし)が入る", (await page.inputValue("dialog[open] #pdIn")) === "sample");
await page.fill("dialog[open] #pdIn", "新しい名前");
await page.locator("dialog[open] .foot .btn.primary").click();
await page.waitForFunction(() => window.__picks.length === 1, null, { timeout: 15000 });
const pick = await page.evaluate(async () => ({ name: window.__picks[0].suggestedName, same: await window.__picks[0].startIn?.isSameEntry(window.__orig) }));
check("保存先選びの名前が「新しい名前.pdf」・最初は今のファイルと同じ場所", pick.name === "新しい名前.pdf" && pick.same === true, JSON.stringify(pick));
await page.waitForSelector(".toast >> text=として保存しました", { timeout: 20000 });
const st = await page.evaluate(async () => {
  const m = window.__apdf.model;
  const out = await (await window.__out.getFile()).arrayBuffer();
  const orig = await (await window.__orig.getFile()).size;
  return {
    head: new TextDecoder().decode(new Uint8Array(out).slice(0, 5)),
    size: out.byteLength,
    orig,
    sameHandle: await m.meta.fileHandle.isSameEntry(window.__out),
    name: m.meta.name,
    unsaved: !!m.meta.unsaved,
    driveId: m.meta.driveId,
  };
});
check("選んだ場所に PDF が書かれる", st.head === "%PDF-" && st.size > 1000, JSON.stringify(st));
check("元のファイルは書き換わらない", st.orig === 0);
check("保存先が新しいファイルに変わる(次の上書きはそこへ)", st.sameHandle === true && st.name === "copy-out.pdf" && !st.unsaved && st.driveId == null, JSON.stringify(st));
check("タブ・画面の名前も新しいファイル名になる", (await page.evaluate(() => window.__apdf.tabNames?.get?.(window.__apdf.model.meta.projectId) ?? window.__apdf.model.meta.name)) === "copy-out.pdf");

// ③ 上書き保存は新しいファイルへ
await page.evaluate(async () => { const w = await window.__out.createWritable(); await w.write("x"); await w.close(); });
await menuItem("上書き保存");
await page.waitForSelector(".toast >> text=上書き保存しました", { timeout: 20000 });
const after = await page.evaluate(async () => ({ out: (await window.__out.getFile()).size, orig: (await window.__orig.getFile()).size }));
check("これ以降の上書き保存は新しいファイルへ入る(元のファイルには入らない)", after.out > 1000 && after.orig === 0, JSON.stringify(after));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`saveas: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
