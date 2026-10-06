// E2E: 開いているファイルの切り替え / 保存しないで閉じる
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "docs01");
await openPdf(page, "tests/fixtures/sample.pdf");
const name1 = await page.evaluate(() => window.__apdf.model.meta.name);
const menu = async (label) => { await page.click("#btnFile"); await page.locator("#menu button", { hasText: label }).click(); };

// 2つ目のファイル(白紙)を開く → 1つ目は閉じずに裏に残る
await menu("白紙から新規作成");
await page.waitForFunction(() => window.__apdf.model.meta.name === "白紙.pdf");
check("新しく開いたファイルが表示される", true);
await menu("開いているファイル");
await page.waitForSelector("dialog[open] .item");
const rows = await page.locator("dialog[open] .item").count();
check("開いているファイルが2件並ぶ", rows === 2, `rows=${rows}`);
await page.locator("dialog[open] [data-sw]").click();
await page.waitForFunction((n) => window.__apdf.model.meta.name === n, name1, { timeout: 15000 });
check("一覧から元のファイルへ切り替えられる", true);
check("切り替え後も2件のまま", await page.evaluate(() => window.__apdf.openDocs.length) === 2);

// 保存しないで閉じる(表示中のファイル) → 残りのファイルが表示される
await menu("保存しないで閉じる");
await page.locator("dialog[open] button", { hasText: "保存しないで閉じる" }).click();
await page.waitForFunction(() => window.__apdf.model.meta.name === "白紙.pdf", null, { timeout: 15000 });
check("閉じると、残っていたファイルが表示される", true);
const recents = await page.evaluate(async () => (await window.__apdf.store.getAll("recents")).map((r) => r.name));
check("破棄したファイルは履歴にも残らない", !recents.includes(name1), JSON.stringify(recents));
check("開いているファイルが1件になる", await page.evaluate(() => window.__apdf.openDocs.length) === 1);

// 最後の1件を閉じる → 空の状態
await menu("保存しないで閉じる");
await page.locator("dialog[open] button", { hasText: "保存しないで閉じる" }).click();
await page.waitForFunction(() => window.__apdf.model.pages.length === 0, null, { timeout: 15000 });
check("最後のファイルを閉じると空の画面になる", await page.locator("#empty").isVisible());
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`docs: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
