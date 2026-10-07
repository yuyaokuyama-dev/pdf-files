// E2E ⑯: ページ一覧のドラッグ&ドロップ(別PDFの挿入・並べ替え・画面外へドラッグして1ページだけ書き出し)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { PDFDocument } = require("pdf-lib");

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "thumbs01");
await openPdf(page, "tests/fixtures/sample.pdf");
await page.click("#btnPages");
await page.waitForSelector("#thumbs .thumb");
const ids = () => page.evaluate(() => window.__apdf.model.pages.map((p) => p.id));
const ids0 = await ids();
check("サンプルは2ページ以上", ids0.length >= 2, ids0.length);

// 1) 別PDFをページ一覧の 1ページ目と2ページ目の間にドロップ
const gapY = () => page.evaluate(() => { const t = [...document.querySelectorAll("#thumbs .thumb")]; const a = t[0].getBoundingClientRect(), b = t[1].getBoundingClientRect(); return [a.left + 40, (a.bottom + b.top) / 2 + 2]; });
const [gx, gy] = await gapY();
const dropFile = (type) => page.evaluate(async ([type, x, y]) => {
  const dt = new DataTransfer();
  const buf = await (await fetch("/tests/fixtures/rotated.pdf")).arrayBuffer();
  dt.items.add(new File([buf], "other.pdf", { type: "application/pdf" }));
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
  document.querySelector("#thumbs .thumb").dispatchEvent(ev);
  return ev.defaultPrevented;
}, [type, gx, gy]);
check("ファイルをページ一覧の上に持ってくるとドロップを受け付ける", await dropFile("dragover"));
const line = await page.evaluate(() => [...document.querySelectorAll(".drop-line")].find((l) => !l.hidden)?.getBoundingClientRect().top ?? null);
check("ページ一覧にも挿入線が出る", line !== null && Math.abs(line - gy) < 12, `${line} vs ${gy}`);
await dropFile("drop");
await page.waitForFunction((n) => window.__apdf.model.pages.length > n, ids0.length, { timeout: 15000 });
const p1 = await page.evaluate(() => window.__apdf.model.pages.map((p) => ({ id: p.id, src: p.srcId })));
const added = p1.length - ids0.length;
check("別PDFのページが1ページ目の直後に入る", p1[0].id === ids0[0] && p1[1].src !== p1[0].src && p1[1 + added].id === ids0[1], JSON.stringify(p1.map((p) => p.id.slice(-4))));
check("挿入線は消える", await page.evaluate(() => [...document.querySelectorAll(".drop-line")].every((l) => l.hidden)));
await page.click("#btnUndo");
check("取り消しで元に戻る", JSON.stringify(await ids()) === JSON.stringify(ids0));

// 2) 1ページ目をドラッグして2ページ目と3ページ目の間(=2番目)へ
await page.waitForSelector("#thumbs .thumb");
const thumbs = page.locator("#thumbs .thumb");
const b2 = await thumbs.nth(1).boundingBox();
await thumbs.nth(0).dragTo(thumbs.nth(1), { targetPosition: { x: b2.width / 2, y: b2.height - 4 } });
const ids2 = await ids();
check("ドロップした位置(2ページ目の後ろ)へ移動する", ids2[0] === ids0[1] && ids2[1] === ids0[0], JSON.stringify(ids2.map((x) => x.slice(-4))));
// 最後のページを先頭(1ページ目の上半分)へ
const last = ids2.length - 1;
await page.waitForSelector("#thumbs .thumb");
await thumbs.nth(last).dragTo(thumbs.nth(0), { targetPosition: { x: 20, y: 4 } });
const ids3 = await ids();
check("最後のページを先頭へ移動できる", ids3[0] === ids2[last] && ids3[1] === ids2[0], JSON.stringify(ids3.map((x) => x.slice(-4))));
// 自分の位置に落としても変わらない
await page.waitForSelector("#thumbs .thumb");
await thumbs.nth(1).dragTo(thumbs.nth(1));
check("同じ場所に落としても順番は変わらない", JSON.stringify(await ids()) === JSON.stringify(ids3));
await page.click("#btnUndo");
check("並べ替えも取り消せる", JSON.stringify(await ids()) === JSON.stringify(ids2));

// 3) 2ページ目を画面の外へドラッグして離す → そのページだけのPDFが保存される
const dragOut = (i, x, y) => page.evaluate(([i, x, y]) => {
  const t = document.querySelectorAll("#thumbs .thumb")[i];
  const dt = new DataTransfer();
  t.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }));
  t.dispatchEvent(new DragEvent("dragend", { bubbles: true, clientX: x, clientY: y, dataTransfer: dt }));
}, [i, x, y]);
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), dragOut(1, -40, 300)]);
check("画面外に落とすとファイル名にページ番号が付く", /_p2\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
const out = await PDFDocument.load(readFileSync(await dl.path()));
check("書き出したPDFは1ページだけ", out.getPageCount() === 1, out.getPageCount());
check("書き出しても元の文書は変わらない", JSON.stringify(await ids()) === JSON.stringify(ids2));

// 画面の中で離したときは何も作らない
let extra = 0;
page.on("download", () => extra++);
await dragOut(0, 400, 300);
await page.waitForTimeout(800);
check("画面内で離したときは書き出さない", extra === 0, extra);

// 4) チェックしたページを「書き出し」ボタンで(iPhone などドラッグできない端末向け)
await page.locator("#thumbs .thumb").nth(0).locator("input[type=checkbox]").check();
await page.locator("#thumbs .thumb").nth(1).locator("input[type=checkbox]").check();
const [dl2] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click('#thumbs [data-bar="exp"]')]);
const out2 = await PDFDocument.load(readFileSync(await dl2.path()));
// (ヘッドレスのChromiumは日本語のファイル名を "download" にしてしまうので、名前は確認しない)
check("チェックした2ページだけのPDFになる", out2.getPageCount() === 2, out2.getPageCount());

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
