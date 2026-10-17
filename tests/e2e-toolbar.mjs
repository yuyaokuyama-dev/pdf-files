// E2E: ツールバーのグループ・基本パレットのドラッグ(追加・並べ替え・削除)
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "tbar01");
await openPdf(page, "tests/fixtures/sample.pdf");

const pal = () => page.evaluate(() => [...document.querySelectorAll("#tools .tool.pal")].map((b) => b.dataset.tool));
const center = async (sel) => {
  const r = await page.locator(sel).first().boundingBox();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, r };
};
const dragTo = async (from, x, y) => {
  const a = await center(from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 12, a.y + 4, { steps: 3 });
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
};

const p0 = await pal();
check("初期の基本パレット", JSON.stringify(p0) === JSON.stringify(["pen", "eraser", "line", "arrow", "rect", "ellipse", "text"]), JSON.stringify(p0));
check("グループのボタンが4つ", (await page.locator("#tools .tool.group").count()) === 4);
check("多角形・雲は基本パレットにない", (await page.locator('#tools .tool[data-tool="polygon"]').count()) === 0);

// グループを開いて選ぶ
await page.click('#tools [data-group="draw"]');
await page.waitForSelector(".toolgroup");
check("作図を開くと多角形・雲などが並ぶ", (await page.locator('.toolgroup .tool[data-tool="polygon"]').count()) === 1 && (await page.locator('.toolgroup .tool[data-tool="cloud"]').count()) === 1);
await page.click('.toolgroup .tool[data-tool="polygon"]');
check("選ぶと閉じてそのツールになる", (await page.locator(".toolgroup").count()) === 0 && (await page.evaluate(() => window.__apdf.editor.tool)) === "polygon");
check("基本パレットにない機能のときはグループが光る", await page.locator('#tools [data-group="draw"].on').count() === 1);

// ドラッグで基本パレットに入れる(末尾)
await page.click('#tools [data-group="draw"]');
await page.waitForSelector(".toolgroup");
const last = await center('#tools .tool.pal >> nth=-1');
await dragTo('.toolgroup .tool[data-tool="cloud"]', last.r.x + last.r.width + 4, last.y);
let p1 = await pal();
check("雲が基本パレットの末尾に入る", p1.at(-1) === "cloud" && p1.length === p0.length + 1, JSON.stringify(p1));
await page.keyboard.press("Escape");

// 並べ替え: 文字を先頭へ
const first = await center('#tools .tool.pal >> nth=0');
await dragTo('#tools .tool[data-tool="text"]', first.r.x + 4, first.y);
let p2 = await pal();
check("ドラッグで並べ替えられる(文字が先頭)", p2[0] === "text", JSON.stringify(p2));

// 外へドラッグして削除
await dragTo('#tools .tool[data-tool="cloud"]', 600, 500);
let p3 = await pal();
check("基本パレットから外へドラッグすると外れる", !p3.includes("cloud") && p3.length === p2.length - 1, JSON.stringify(p3));
check("外してもグループからは選べる", await (async () => { await page.click('#tools [data-group="draw"]'); const n = await page.locator('.toolgroup .tool[data-tool="cloud"]').count(); await page.keyboard.press("Escape"); return n === 1; })());

// グループのほうは外へドラッグしても何も起きない
await page.click('#tools [data-group="insert"]');
await page.waitForSelector(".toolgroup");
await dragTo('.toolgroup .tool[data-tool="sign"]', 600, 500);
check("グループから外へドラッグしても変わらない", JSON.stringify(await pal()) === JSON.stringify(p3));

// 初期に戻す(グループは開いたまま)
await page.waitForSelector(".toolgroup");
await page.click(".toolgroup .tg-reset");
check("初期に戻せる", JSON.stringify(await pal()) === JSON.stringify(p0), JSON.stringify(await pal()));
await page.keyboard.press("Escape");

// 修正はそのままメニューが開く
await page.click('#tools [data-group="modify"]');
await page.waitForSelector("#menu:not([hidden])");
check("修正はメニューが開く", true);
await page.keyboard.press("Escape");

// 再読み込みしても並びが残る
await page.click('#tools [data-group="draw"]');
await page.waitForSelector(".toolgroup");
const l2 = await center('#tools .tool.pal >> nth=-1');
await dragTo('.toolgroup .tool[data-tool="arc"]', l2.r.x + l2.r.width + 4, l2.y);
await page.waitForTimeout(400);
await page.reload();
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 }).catch(() => {});
await page.waitForSelector("#tools .tool.pal");
check("再読み込みしても基本パレットが残る", (await pal()).includes("arc"), JSON.stringify(await pal()));

check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
