// E2E: 開いているファイルのタブ / タブを作業画面の外へドラッグして別ウィンドウで開く(並べて見比べる)
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, ctx, errors } = env;
await page.goto(env.base);
await register(page, "tabs01");
await openPdf(page, "tests/fixtures/sample.pdf");
const name1 = await page.evaluate(() => window.__apdf.model.meta.name);
const id1 = await page.evaluate(() => window.__apdf.model.meta.projectId);
const menu = async (label) => { await page.click("#btnFile"); await page.locator("#menu button", { hasText: label }).click(); };
const tabNames = (p = page) => p.evaluate(() => [...document.querySelectorAll("#tabbar .tab")].map((t) => t.querySelector(".tab-name").textContent));

check("ファイルが1つだけのときはタブを出さない", (await tabNames()).join() === name1 && (await page.locator("#tabbar").isHidden()), JSON.stringify(await tabNames()));
await menu("白紙から新規作成");
await page.waitForFunction(() => window.__apdf.model.meta.name === "白紙.pdf");
check("2つ目のファイルを開くとタブが並ぶ", (await tabNames()).join() === `${name1},白紙.pdf` && (await page.locator("#tabbar").isVisible()));
check("表示中のタブが強調される", (await page.locator("#tabbar .tab.on .tab-name").textContent()) === "白紙.pdf");

// タブのクリックで切り替え
await page.locator("#tabbar .tab", { hasText: name1 }).click();
await page.waitForFunction((n) => window.__apdf.model.meta.name === n, name1, { timeout: 15000 });
check("タブをクリックすると切り替わる", true);

// タブの並べ替え(左右にドラッグ)
const box = async (n) => page.locator("#tabbar .tab", { hasText: n }).boundingBox();
let a = await box(name1), b = await box("白紙.pdf");
await page.mouse.move(a.x + 20, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.width - 5, b.y + b.height / 2, { steps: 10 });
await page.mouse.up();
check("タブを左右にドラッグして並べ替えられる", (await tabNames()).join() === `白紙.pdf,${name1}`, JSON.stringify(await tabNames()));
check("並べ替えでは別ウィンドウは開かない", ctx.pages().length === 1);

// タブを作業画面の中(ページの上)へドラッグして離しても、別ウィンドウは開かない
a = await box(name1);
await page.mouse.move(a.x + 20, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(a.x + 80, a.y + 300, { steps: 8 });
check("ドラッグ中は「作業画面の外で離すと別ウィンドウ」と案内", (await page.locator(".tab-ghost .tab-ghost-hint").textContent()).includes("作業画面の外"));
check("作業画面の中ではまだ別ウィンドウの対象にならない", (await page.locator(".tab-ghost.out").count()) === 0);
await page.mouse.up();
await page.waitForTimeout(400);
check("作業画面の中で離しても別ウィンドウは開かない", ctx.pages().length === 1 && (await tabNames()).length === 2);

// タブを作業画面(ウィンドウ)の外へドラッグ → 別ウィンドウで開く
a = await box(name1);
const popupP = ctx.waitForEvent("page");
await page.mouse.move(a.x + 20, a.y + a.height / 2);
await page.mouse.down();
await page.mouse.move(a.x + 60, a.y + 300, { steps: 6 });
await page.mouse.move(1400, 300, { steps: 6 }); // 画面幅は1280
check("作業画面の外では強調表示になる", (await page.locator(".tab-ghost.out").count()) === 1);
await page.mouse.up();
const popup = await popupP;
const perr = [];
popup.on("pageerror", (e) => perr.push(e.message));
popup.on("console", (m) => m.type() === "error" && perr.push(m.text()));
await popup.waitForFunction(() => window.__apdf?.model?.pages.length > 0 && document.querySelectorAll('.page[data-rendered="1"]').length >= 1, null, { timeout: 20000 });
check("別ウィンドウにドラッグしたファイルが表示される(ログイン済みのまま)", (await popup.evaluate(() => window.__apdf.model.meta.projectId)) === id1);
check("別ウィンドウのタブはそのファイルだけ", (await tabNames(popup)).join() === name1, JSON.stringify(await tabNames(popup)));
await page.waitForFunction(() => window.__apdf.model.meta.name === "白紙.pdf", null, { timeout: 15000 });
check("元のウィンドウからはタブが外れ、残りのファイルが表示される", (await tabNames()).join() === "白紙.pdf", JSON.stringify(await tabNames()));

// 同じファイルを元のウィンドウで開こうとしても二重に開かない(保存の上書き防止)
await menu("開いているファイル");
await page.waitForSelector("dialog[open] .item");
check("一覧に「別ウィンドウ」と表示される", (await page.locator("dialog[open] .item", { hasText: "別ウィンドウ" }).count()) === 1);
await page.locator("dialog[open] .item", { hasText: "別ウィンドウ" }).locator("[data-sw]").click();
await page.waitForTimeout(500);
check("別ウィンドウで開いているファイルは元のウィンドウでは開かない", (await page.evaluate(() => window.__apdf.model.meta.name)) === "白紙.pdf");

// 別ウィンドウで編集 → 閉じると元のウィンドウのタブに戻り、編集内容も引き継がれる
await popup.evaluate(() => { const S = window.__apdf; S.model.meta.name = "編集済み.pdf"; });
await popup.close({ runBeforeUnload: true });
await page.waitForFunction(() => document.querySelectorAll("#tabbar .tab").length === 2, null, { timeout: 10000 });
check("別ウィンドウを閉じるとタブが元のウィンドウに戻る", (await tabNames()).length === 2, JSON.stringify(await tabNames()));
await page.locator("#tabbar .tab").nth(1).click();
await page.waitForFunction((id) => window.__apdf.model.meta.projectId === id, id1, { timeout: 15000 });
check("戻ったタブを開ける", true);

// タブの×: 閉じても履歴には残る
await page.locator("#tabbar .tab.on .tab-x").click();
await page.waitForFunction(() => document.querySelectorAll("#tabbar .tab").length === 1, null, { timeout: 10000 });
const recents = await page.evaluate(async () => (await window.__apdf.store.getAll("recents")).map((r) => r.id));
check("×で閉じたファイルは履歴に残る", recents.includes(id1));
check("×で閉じると残りのファイルが表示される", (await page.evaluate(() => window.__apdf.model.meta.name)) === "白紙.pdf");
check("コンソールエラーなし", errors.length === 0 && perr.length === 0, [...errors, ...perr].join("\n"));
await env.close();
const s = summary();
console.log(`tabs: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
