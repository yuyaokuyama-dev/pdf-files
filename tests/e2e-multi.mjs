// E2E: 複数選択(Ctrl+クリック・範囲選択)・まとめて色を変える・種類のチェック・コピー/貼り付け(ページ・ファイルをまたぐ)・
// 削除・「コピーしたもの」から押すスタンプ
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "multi01");
await openPdf(page, "tests/fixtures/sample.pdf");
await page.evaluate(() => window.__apdf.model.pages.length < 2 && window.__apdf.model.insertBlank(1));
await page.waitForFunction(() => window.__apdf.editor.els.size >= 2);
await setZoom1(page);
const ed = (fn, arg) => page.evaluate(fn, arg);
const ctrlClick = async (pi, p) => { await page.keyboard.down("Control"); await click(page, pi, p); await page.keyboard.up("Control"); };
const msel = () => ed(() => (window.__apdf.editor.msel || []).length);

// 線・四角・文字を描く
await tool(page, "line");
await drag(page, 0, [60, 100], [200, 100]);
await tool(page, "rect");
await drag(page, 0, [60, 140], [160, 200]);
await tool(page, "text");
await click(page, 0, [60, 240]);
await page.keyboard.type("ABC");
await page.keyboard.press("Control+Enter");
await tool(page, "select");
check("3つ描けた", (await shapes(page)).length === 3, JSON.stringify((await shapes(page)).map((s) => s.type)));

/* ---- Ctrl+クリックで複数選択 ---- */
await click(page, 0, [130, 100]);
await ctrlClick(0, [60, 170]);
check("Ctrl+クリックで2つ選べる", (await msel()) === 2);
await ctrlClick(0, [70, 246]);
check("種類が違っても(文字も)Ctrl+クリックで追加できる", (await msel()) === 3);
check("パネルに「複数選択(3個)」", (await page.locator("#props h3").first().textContent()).includes("複数選択(3個)"));
const types = await page.locator('#props input[data-k="mtype"]').evaluateAll((els) => els.map((e) => `${e.dataset.type}:${e.checked}`));
check("選択中の種類がチェックボックス付きで出る", types.join() === "line:true,rect:true,text:true", types.join());
await ctrlClick(0, [70, 246]);
check("選択済みをCtrl+クリックすると外れる", (await msel()) === 2);
await ctrlClick(0, [70, 246]);

/* ---- まとめて色を変える・種類のチェックを外す ---- */
await page.locator('#props .sw[data-c="#2563eb"]').click();
let sh = await shapes(page);
check("まとめて色を変えられる(線・四角・文字)", sh.every((s) => (s.type === "text" ? s.color : s.style.color) === "#2563eb"), JSON.stringify(sh.map((s) => s.style.color)));
await page.locator('#props input[data-k="mtype"][data-type="text"]').uncheck();
await page.locator('#props .sw[data-c="#16a34a"]').click();
sh = await shapes(page);
check("チェックを外した種類(文字)は変わらない", sh.find((s) => s.type === "text").color === "#2563eb" && sh.filter((s) => s.type !== "text").every((s) => s.style.color === "#16a34a"), JSON.stringify(sh.map((s) => s.style.color)));
check("外した種類は灰色の枠", (await page.locator(".sel-box.off").count()) === 1);
await page.locator('#props input[data-k="mtype"][data-type="text"]').check();

/* ---- 範囲選択(何もない所をドラッグで囲む) ---- */
await click(page, 0, [400, 600]);
check("何もない所をクリックで選択解除", (await msel()) === 0 && !(await ed(() => window.__apdf.editor.sel)));
await drag(page, 0, [40, 80], [220, 215]);
check("囲んだ図形(線・四角)だけが選ばれる", (await msel()) === 2 && (await ed(() => window.__apdf.editor.selShapes().map((f) => f.shape.type).sort().join())) === "line,rect");
const before = await shapes(page);
await drag(page, 0, [130, 100], [150, 130]);
sh = await shapes(page);
check("まとめてドラッグで移動", Math.abs(sh[0].pts[0][0] - before[0].pts[0][0] - 20) < 0.5 && Math.abs(sh[1].pts[0][1] - before[1].pts[0][1] - 30) < 0.5 && sh[2].pts[0][0] === before[2].pts[0][0], JSON.stringify([before[0].pts[0], sh[0].pts[0]]));

/* ---- コピー・貼り付け(ページをまたぐ)・削除 ---- */
await page.keyboard.press("Control+c");
check("コピーすると「コピーしたもの」が出る", (await page.locator("#clips").isVisible()) && (await page.locator("#clips .clip-item").count()) === 1);
const [hx, hy] = await toScreen(page, 1, 300, 300);
await page.mouse.move(hx, hy);
await page.keyboard.press("Control+v");
let p1 = await shapes(page, 1);
check("別のページへ貼り付け(マウスの位置が中心)", p1.length === 2 && Math.abs((p1[0].pts[0][0] + p1[0].pts[1][0]) / 2 - 300) < 60, JSON.stringify(p1.map((s) => s.pts)));
check("貼ったものが選ばれている", (await msel()) === 2 && (await ed(() => window.__apdf.editor.selShapes().every((f) => f.page === window.__apdf.model.pages[1]))));
await page.keyboard.press("Delete");
check("Delで選んだものをまとめて削除", (await shapes(page, 1)).length === 0 && (await shapes(page, 0)).length === 3);
await page.keyboard.press("Control+z");
check("削除は取り消せる", (await shapes(page, 1)).length === 2);
await page.keyboard.press("Control+z");
check("貼り付けも取り消せる", (await shapes(page, 1)).length === 0);
await click(page, 0, [400, 600]);
await page.keyboard.press("Control+a");
check("Ctrl+Aでページの図形を全部選ぶ", (await msel()) === 3);
await page.keyboard.press("Escape");

/* ---- コピーしたものをスタンプのように押す ---- */
await page.locator("#clips .clip-keep input").check();
await page.waitForFunction(async () => ((await window.__apdf.store.getSetting("clips", [])) || []).length === 1);
check("チェックを入れると候補として残る(端末に保存)", true);
await page.locator("#clips .clip-thumb").first().click();
check("候補をクリックで選ぶとスタンプモード", (await ed(() => window.__apdf.editor.tool)) === "clip" && (await page.locator("#clips .clip-item.on").count()) === 1);
await click(page, 1, [200, 150]);
await click(page, 1, [350, 260]);
p1 = await shapes(page, 1);
check("クリックした位置に何度でも貼れる", p1.length === 4, String(p1.length));
await page.keyboard.press("Escape");
check("Escでスタンプモードを終える", (await ed(() => window.__apdf.editor.tool)) === "select");

/* ---- 画像もファイルをまたいで貼れる ---- */
await ed(() => {
  const S = window.__apdf;
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  c.getContext("2d").fillRect(0, 0, 8, 8);
  const imgId = S.model.addImage(c.toDataURL());
  const s = S.model.addShape(S.model.pages[0].id, { type: "image", kind: "stamp", imgId, aspect: 1, pts: [[300, 300], [340, 340]], style: {} });
  S.editor.setSelection({ pageId: S.model.pages[0].id, shapeId: s.id });
});
await page.keyboard.press("Control+c");
await page.click("#btnFile");
await page.locator("#menu button", { hasText: "白紙から新規作成" }).click();
await page.waitForFunction(() => window.__apdf.model.meta.name === "白紙.pdf");
await page.locator("#viewer").focus();
await page.mouse.move(5, 5);
await page.keyboard.press("Control+v");
const img = await ed(() => {
  const S = window.__apdf;
  const s = S.model.pages[0].shapes[0];
  return s && s.type === "image" && S.model.images.get(s.imgId)?.startsWith("data:image");
});
check("画像(印影など)も別のファイルへ貼り付けられる", img);

/* ---- 候補は開き直しても残る・外すと消える ---- */
await page.reload();
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll("#clips .clip-item").length === 1);
check("開き直しても候補が残る", await page.locator("#clips").isVisible());
await page.locator("#clips .clip-keep input").click();
check("チェックを外すと候補から消える", (await page.locator("#clips .clip-item").count()) === 0 && (await page.locator("#clips").isHidden()));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const { fail } = summary();
process.exit(fail ? 1 : 0);
