// E2E ⑧: ページボタンは選択の左・別PDFをページの間にドラッグ&ドロップで挿入・メール送信方式の切替
import { launch, register, openPdf, setZoom1, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "dnd01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

// ページボタンは「選択」ツールの左にある(上部バーにはない)
const order = await page.evaluate(() => [...document.querySelectorAll("#tools > *")].slice(0, 3).map((n) => n.id || n.dataset.tool || n.className));
check("ページ一覧ボタンが選択ツールの左にある", order[0] === "btnPages" && order[2] === "select", JSON.stringify(order));
check("上部バーのページ一覧ボタンは無くなった", (await page.locator(".topbar #btnPages").count()) === 0);
await page.click("#btnPages");
check("ボタンでページ一覧が開く", await page.locator("#thumbs").isVisible());
await page.click("#btnPages");

// ドラッグ&ドロップ: 左のページ一覧の1ページ目と2ページ目の間に別PDFを挿入
const n0 = await page.evaluate(() => window.__apdf.model.pages.length);
const ids0 = await page.evaluate(() => window.__apdf.model.pages.map((p) => p.id));
const dispatch = (sel, type, withFile, x, y) => page.evaluate(async ([sel, type, withFile, x, y]) => {
  const dt = new DataTransfer();
  if (withFile) {
    const buf = await (await fetch("/tests/fixtures/rotated.pdf")).arrayBuffer();
    dt.items.add(new File([buf], "other.pdf", { type: "application/pdf" }));
  }
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
  document.querySelector(sel).dispatchEvent(ev);
  return ev.defaultPrevented;
}, [sel, type, withFile, x, y]);
// ファイルを持ってくるとページ一覧が開く
await dispatch("#viewer", "dragenter", true, 400, 400);
check("ファイルをドラッグしてくるとページ一覧が開く", await page.locator("#thumbs").isVisible());
await page.waitForFunction(() => document.querySelectorAll("#thumbs .thumb").length >= 2);
const tb = await page.evaluate(() => { const e = [...document.querySelectorAll("#thumbs .thumb")]; const a = e[0].getBoundingClientRect(), b = e[1].getBoundingClientRect(); return { x: a.left + 40, y: (a.bottom + b.top) / 2 + 2 }; });
await dispatch("#thumbs .thumb", "dragover", true, tb.x, tb.y);
const line = await page.evaluate(() => { const l = document.querySelector(".drop-line"); return l && !l.hidden ? l.getBoundingClientRect().top : null; });
check("ページ一覧のドロップ位置(ページの間)に挿入線が出る", line !== null && Math.abs(line - tb.y) < 12, `${line} vs ${tb.y}`);
await dispatch("#thumbs .thumb", "drop", true, tb.x, tb.y);
await page.waitForFunction((n) => window.__apdf.model.pages.length > n, n0, { timeout: 15000 });
const ids1 = await page.evaluate(() => window.__apdf.model.pages.map((p) => ({ id: p.id, src: p.srcId })));
const added = ids1.length - n0;
check("別PDFのページが追加された", added >= 1, `${n0}→${ids1.length}`);
check("1ページ目の直後(ドロップした位置)に入る", ids1[0].id === ids0[0] && ids1[1].src !== ids1[0].src && ids1[1 + added].id === ids0[1], JSON.stringify(ids1.map((p) => p.id.slice(-4))));
check("挿入線は消える", await page.evaluate(() => document.querySelector(".drop-line").hidden));
await page.click("#btnUndo");
check("取り消しで元に戻る", (await page.evaluate(() => window.__apdf.model.pages.length)) === n0);

// 先頭のページより上にドロップすると先頭に入る
const top = await page.evaluate(() => { const r = document.querySelector("#thumbs .thumb").getBoundingClientRect(); return { x: r.left + 40, y: r.top + 3 }; });
await dispatch("#thumbs .thumb", "drop", true, top.x, top.y);
await page.waitForFunction((n) => window.__apdf.model.pages.length > n, n0, { timeout: 15000 });
const first = await page.evaluate(() => window.__apdf.model.pages[0].id);
check("ページより上にドロップすると先頭に入る", first !== ids0[0]);

// 作業画面にドロップすると、ページは追加せず新しいタブで開く
const before = await page.evaluate(() => ({ id: window.__apdf.model.meta.projectId, n: window.__apdf.model.pages.length }));
await dispatch("#viewer", "drop", true, 600, 500);
await page.waitForFunction((id) => window.__apdf.model.meta.projectId !== id && window.__apdf.model.pages.length > 0, before.id, { timeout: 15000 });
check("作業画面へのドロップは新しいタブで開く", (await page.evaluate(() => window.__apdf.model.meta.name)) === "other.pdf" && (await page.locator("#tabbar .tab").count()) === 2);
await page.locator("#tabbar .tab").first().click();
await page.waitForFunction((id) => window.__apdf.model.meta.projectId === id, before.id, { timeout: 15000 });
const nAfter = await page.evaluate(() => window.__apdf.model.pages.length);
check("元のファイルのページ数は変わらない", nAfter === before.n, `${before.n} → ${nAfter}`);

// メール送信方式の切替(設定)
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "設定" }).click();
await page.waitForSelector("dialog[open] #stMail");
check("メールの送り方が選べる(既定は直接送信)", (await page.inputValue("#stMail")) === "api");
await page.selectOption("#stMail", "app");
await page.click("dialog[open] .foot .btn.primary");
check("設定が保存される", (await page.evaluate(() => window.__apdf.settings.mailMode)) === "app");
await page.click("#btnSave");
await page.locator("#menu button", { hasText: /Gmail|メール/ }).first().click();
await page.waitForSelector("dialog[open] #mlTo");
check("メールソフト方式: Googleログイン不要でダイアログが開き、ボタンは『メールを作成』", (await page.textContent("dialog[open] .foot .btn.primary")).includes("メールを作成"));

await page.fill("#mlTo", "test@example.com");
await page.fill("#mlSub", "テスト件名");
let gmailUrl = "";
await env.ctx.route("https://mail.google.com/**", (route) => { gmailUrl = route.request().url(); route.fulfill({ status: 200, contentType: "text/html", body: "ok" }); });
const [popup, dl] = await Promise.all([
  env.ctx.waitForEvent("page", { timeout: 20000 }),
  page.waitForEvent("download", { timeout: 20000 }),
  page.click("dialog[open] .foot .btn.primary"),
]);
await popup.waitForLoadState().catch(() => {});
check("Gmailの作成画面が宛先・件名つきで開く", /mail\.google\.com\/mail\/\?/.test(gmailUrl) && /to=test%40example\.com/.test(gmailUrl) && /su=%E3%83%86/.test(gmailUrl) && /view=cm/.test(gmailUrl), gmailUrl.slice(0, 160));
check("添付用のPDFが端末に保存される", /\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
await popup.close().catch(() => {});

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
