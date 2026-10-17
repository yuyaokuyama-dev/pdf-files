// E2E: ショートカットキーの設定(複数文字・重複・入力中は無効・保存して再読み込み)
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "sc01");
await openPdf(page, "tests/fixtures/sample.pdf");
const tool = () => page.evaluate(() => window.__apdf.editor.tool);
const openSettings = async () => {
  await page.click("#btnUser");
  await page.locator("#menu button", { hasText: "設定" }).click();
  await page.click("#stKeysBtn");
};
const save = () => page.locator("dialog[open] button", { hasText: "保存" }).click();

// 初期の1文字キーは今までどおり
await page.keyboard.press("l");
check("初期: L で線", (await tool()) === "line");
await page.keyboard.press("v");
check("初期: V で選択", (await tool()) === "select");

// 設定画面で展開し、線を「ln」・四角を「rt」・多角形を「l」と重ねて保存を試す
await openSettings();
check("機能一覧が展開される", await page.locator("#stKeysBox").isVisible());
check("線の欄に初期値 L が入っている", (await page.inputValue('[data-sk="line"]')) === "l");
await page.fill('[data-sk="line"]', "LN-");
check("入力は小文字の英数字に整う", (await page.inputValue('[data-sk="line"]')) === "ln");
await page.fill('[data-sk="rect"]', "rt");
await page.fill('[data-sk="polygon"]', "rt");
check("重なると警告が出る", /重なっています/.test(await page.locator("#stKeysMsg").innerText()));
await save();
check("重なったままでは保存できない(画面が残る)", await page.locator("dialog[open]").count() === 1);
await page.fill('[data-sk="polygon"]', "pg");
await save();
await page.waitForSelector("dialog[open]", { state: "detached" });

// 複数文字
await page.keyboard.press("l");
check("L だけでは線にならない(LN が登録されたため、初期のLは外れる)", (await tool()) === "select");
await page.keyboard.press("l");
await page.keyboard.press("n");
check("LN で線", (await tool()) === "line");
await page.keyboard.press("v");
await page.keyboard.press("r");
check("R の途中では四角にならない", (await tool()) === "select");
check("入力途中の文字が画面に出る", (await page.locator("#keyBuf").innerText()) === "R");
await page.keyboard.press("t");
check("RT で四角", (await tool()) === "rect");
await page.keyboard.press("p");
await page.keyboard.press("g");
check("PG で多角形", (await tool()) === "polygon");

// Ctrl 付き・入力欄の中では反応しない
await page.keyboard.press("Escape");
await page.keyboard.press("v");
await page.keyboard.press("Control+l");
check("Ctrl+L では反応しない", (await tool()) === "select");
const tip = await page.locator('.tool[data-tool="line"]').getAttribute("title");
check("ボタンの説明にショートカットが出る", /LN/.test(tip), tip);

// 再読み込みしても残る
await page.reload();
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => window.__apdf?.editor?.shortcuts, null, { timeout: 15000 });
const saved = await page.evaluate(() => window.__apdf.editor.shortcuts);
check("保存されたショートカットが再読み込み後も使われる", saved.line === "ln" && saved.rect === "rt" && saved.polygon === "pg", JSON.stringify(saved));

// 初期に戻す
await openSettings();
await page.click("#stKeysReset");
check("初期に戻すと L が線に戻る", (await page.inputValue('[data-sk="line"]')) === "l");
await save();
await page.waitForSelector("dialog[open]", { state: "detached" });
await page.keyboard.press("l");
check("戻したあとは L で線", (await tool()) === "line");

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
