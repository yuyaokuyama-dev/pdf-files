// E2E ①: 描画ツール・選択/移動/頂点編集・プロパティ・テキスト・寸法・縮尺/計測・取り消し
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page);
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

/* ---------- 1. 作成ツール(線・矢印・四角・丸・雲) ---------- */
for (const [id, type] of [["line", "line"], ["arrow", "arrow"], ["rect", "rect"], ["ellipse", "ellipse"], ["cloud", "cloud"]]) {
  await tool(page, id);
  const base = { line: 60, arrow: 120, rect: 180, ellipse: 260, cloud: 340 }[id];
  await drag(page, 0, [60, base], [220, base + 50]);
  const sh = await shapes(page);
  check(`${id} ツールで図形を作成`, sh.at(-1)?.type === type, JSON.stringify(sh.at(-1)));
  await tool(page, "select"); // 作成後は自動で選択モード
}
let sh = await shapes(page);
check("5種類の図形が追加された", sh.length === 5, `len=${sh.length}`);
check("雲のデフォルトピッチ", sh[4].pitch === 18);

/* ---------- 2. ペン(なめらか) ---------- */
await tool(page, "pen");
{
  const pts = [];
  for (let i = 0; i <= 60; i++) pts.push([300 + i * 3, 120 + Math.sin(i / 6) * 25]);
  const [sx, sy] = await toScreen(page, 0, pts[0][0], pts[0][1]);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (const p of pts) {
    const [x, y] = await toScreen(page, 0, p[0], p[1]);
    await page.mouse.move(x, y);
  }
  await page.mouse.up();
}
sh = await shapes(page);
const pen = sh.at(-1);
check("ペンで手書き線を作成", pen.type === "pen" && pen.pts.length > 10, `pts=${pen?.pts?.length}`);
const penD = await page.evaluate(() => document.querySelector('.shape-pen path[fill="none"]')?.getAttribute("d") || "");
check("ペンの線は滑らかな曲線(Q)で描画", /Q/.test(penD));

/* ---------- 3. 選択・移動・取り消し ---------- */
await tool(page, "select");
const rectBefore = (await shapes(page))[2].pts;
await drag(page, 0, [120, 205], [160, 245]); // 四角の内側(塗りなし)は図形ではないので何も起きない
await drag(page, 0, [60, 205], [90, 235]);
let after = (await shapes(page))[2].pts;
check("四角を辺からドラッグして移動", Math.abs(after[0][0] - rectBefore[0][0] - 30) < 1.5 && Math.abs(after[0][1] - rectBefore[0][1] - 30) < 1.5, `${JSON.stringify(rectBefore)} -> ${JSON.stringify(after)}`);
await page.click("#btnUndo");
after = (await shapes(page))[2].pts;
check("取り消しで元の位置に戻る", JSON.stringify(after) === JSON.stringify(rectBefore));
await page.click("#btnRedo");
check("やり直しで再び移動", (await shapes(page))[2].pts[0][0] > rectBefore[0][0] + 20);

/* ---------- 4. 頂点編集(多角形): ドラッグ・追加・削除 ---------- */
await tool(page, "polygon");
for (const p of [[320, 420], [420, 400], [470, 470], [400, 540], [320, 500]]) await click(page, 0, p);
await click(page, 0, [320, 420]); // 最初の点をクリックで閉じる
sh = await shapes(page);
const poly = sh.at(-1);
check("多角形(5頂点)を作成", poly.type === "polygon" && poly.pts.length === 5, JSON.stringify(poly.pts));
// 頂点ハンドルが5つ出ている
let handles = await page.locator(".handle[data-kind=v]").count();
check("選択すると頂点ハンドルが表示", handles === 5, `handles=${handles}`);
// 頂点0を移動
{
  const [hx, hy] = await toScreen(page, 0, 320, 420);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const [tx, ty] = await toScreen(page, 0, 300, 380);
  await page.mouse.move(tx, ty, { steps: 6 });
  await page.mouse.up();
}
let p2 = (await shapes(page)).at(-1);
check("頂点をドラッグして移動", Math.abs(p2.pts[0][0] - 300) < 1.5 && Math.abs(p2.pts[0][1] - 380) < 1.5, JSON.stringify(p2.pts[0]));
// 辺をダブルクリックして頂点追加(頂点1→2の中点 = (445,435))
await click(page, 0, [445, 435], { clickCount: 2, delay: 40 });
p2 = (await shapes(page)).at(-1);
check("辺のダブルクリックで頂点を追加", p2.pts.length === 6, `n=${p2.pts.length}`);
// 追加した頂点をダブルクリックで削除
{
  const v = p2.pts[2];
  await click(page, 0, v, { clickCount: 2, delay: 40 });
}
p2 = (await shapes(page)).at(-1);
check("頂点のダブルクリックで頂点を削除", p2.pts.length === 5, `n=${p2.pts.length}`);

/* ---------- 5. 雲マークのピッチ変更(プロパティ) ---------- */
{
  // 雲を選択(辺をクリック)
  await tool(page, "select");
  const cloud = (await shapes(page))[4];
  await click(page, 0, [cloud.pts[0][0] + 20, cloud.pts[0][1]]);
  const arcsBefore = await page.evaluate(() => (document.querySelector(".shape-cloud path")?.getAttribute("d").match(/A/g) || []).length);
  const slider = page.locator('#props input[type=range][data-k="pitch"]');
  check("雲を選ぶとピッチ設定が出る", (await slider.count()) === 1);
  await slider.evaluate((el) => { el.value = 40; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  const c2 = (await shapes(page))[4];
  const arcsAfter = await page.evaluate(() => (document.querySelector(".shape-cloud path")?.getAttribute("d").match(/A/g) || []).length);
  check("ピッチを大きくすると円弧数が減る", c2.pitch === 40 && arcsAfter < arcsBefore, `pitch=${c2.pitch} ${arcsBefore}->${arcsAfter}`);
}

/* ---------- 6. 色・太さ(プロパティ) ---------- */
{
  const before = (await shapes(page))[4].style;
  await page.locator('#props .sw[data-c="#2563eb"]').click();
  await page.locator('#props input[type=range][data-k="width"]').evaluate((el) => { el.value = 8; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  const st = (await shapes(page))[4].style;
  check("色と線の太さを変更", st.color === "#2563eb" && st.width === 8, JSON.stringify(st));
  await page.click("#btnUndo");
  await page.click("#btnUndo");
  const st2 = (await shapes(page))[4].style;
  check("プロパティ変更も取り消せる", st2.color === before.color && st2.width === before.width, JSON.stringify(st2));
  await page.click("#btnRedo");
  await page.click("#btnRedo");
}

/* ---------- 7. テキスト(サイズ・フォント変更) ---------- */
await tool(page, "text");
await click(page, 0, [80, 640]);
await page.waitForSelector("textarea.text-edit");
await page.keyboard.type("寸法テスト ABC\n2行目");
await page.keyboard.press("Control+Enter");
sh = await shapes(page);
const txt = sh.at(-1);
check("テキストを入力(日本語・2行)", txt.type === "text" && txt.text === "寸法テスト ABC\n2行目", JSON.stringify(txt.text));
await page.locator('#props input[type=range][data-k="size"]').evaluate((el) => { el.value = 40; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
await page.locator('#props select[data-k="font"]').selectOption("mincho");
const t2 = (await shapes(page)).at(-1);
check("文字サイズとフォントを変更", t2.size === 40 && t2.font === "mincho", `${t2.size} ${t2.font}`);
const fonts = await page.locator('#props select[data-k="font"] option').count();
check("フォントは数種類用意されている", fonts >= 4, `fonts=${fonts}`);
// テキストのダブルクリックで再編集
await click(page, 0, [t2.pts[0][0] + 10, t2.pts[0][1] + 10], { clickCount: 2, delay: 40 });
await page.waitForSelector("textarea.text-edit", { timeout: 3000 }).then(() => check("テキストをダブルクリックで再編集", true)).catch(() => check("テキストをダブルクリックで再編集", false));
await page.keyboard.press("Escape");

/* ---------- 8. 寸法線(任意の数値を入力) ---------- */
await tool(page, "dim");
await drag(page, 0, [100, 700], [400, 700]);
await page.waitForSelector("dialog[open] #pdIn");
await page.fill("#pdIn", "3,600");
await page.keyboard.press("Enter");
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.at(-1)?.type === "dim");
const dim = (await shapes(page)).at(-1);
check("寸法線を作成し任意の数値を入力", dim.type === "dim" && dim.text === "3,600", JSON.stringify(dim));
const dimLabel = await page.evaluate(() => [...document.querySelectorAll(".shape-dim text")].map((t) => t.textContent).join("|"));
check("寸法線の数値が図面に表示される", dimLabel.includes("3,600"), dimLabel);
// オフセットハンドルを動かす
const offBefore = dim.off;
{
  const m = [(dim.pts[0][0] + dim.pts[1][0]) / 2, (dim.pts[0][1] + dim.pts[1][1]) / 2 + offBefore];
  const [hx, hy] = await toScreen(page, 0, m[0], m[1]);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const [tx, ty] = await toScreen(page, 0, m[0], m[1] + 30);
  await page.mouse.move(tx, ty, { steps: 5 });
  await page.mouse.up();
}
check("寸法線の位置(オフセット)をハンドルで調整", Math.abs((await shapes(page)).at(-1).off - (offBefore + 30)) < 2, String((await shapes(page)).at(-1).off));
// 寸法の文字を編集(ダブルクリック)
{
  const d = (await shapes(page)).at(-1);
  const off = d.off;
  await click(page, 0, [160, 700 + off], { clickCount: 2, delay: 40 });
  await page.waitForSelector("dialog[open] #pdIn", { timeout: 3000 });
  await page.fill("#pdIn", "3,650");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  check("寸法の文字を後から編集", (await shapes(page)).at(-1).text === "3,650");
}

/* ---------- 9. 縮尺設定 → 別の2点を計測 ---------- */
await tool(page, "calib");
await drag(page, 0, [100, 800], [500, 800]); // 400pt を 4000mm とする
await page.waitForSelector("dialog[open] #clVal");
await page.fill("#clVal", "4000");
await page.click("dialog[open] .foot .btn.primary");
await page.waitForFunction(() => window.__apdf.model.pages[0].scale);
const scale = await page.evaluate(() => window.__apdf.model.pages[0].scale);
check("縮尺を設定(400pt = 4000mm)", Math.abs(scale.ptsPerUnit - 0.1) < 1e-3 && scale.unit === "mm", JSON.stringify(scale));
check("縮尺設定後は自動で計測ツールになる", await page.evaluate(() => window.__apdf.editor.tool === "measure"));
await drag(page, 0, [150, 760], [350, 760]); // 200pt → 2000mm
sh = await shapes(page);
const meas = sh.at(-1);
const label = await page.evaluate(() => [...document.querySelectorAll(".shape-measure text")].map((t) => t.textContent).join("|"));
check("別の2点を計測すると参考値が出る(200pt → 2000 mm)", meas.type === "measure" && label.includes("2000 mm"), label);
await drag(page, 0, [100, 740], [160, 780]); // 斜め: √(60²+40²)=72.1pt → 721mm
const label2 = await page.evaluate(() => [...document.querySelectorAll(".shape-measure text")].map((t) => t.textContent).join("|"));
check("斜めの2点も計測できる(約 721 mm)", /72[01] mm/.test(label2), label2);

/* ---------- 10. 削除 ---------- */
await tool(page, "select");
const n0 = (await shapes(page)).length;
const last = (await shapes(page)).at(-1);
await click(page, 0, [(last.pts[0][0] + last.pts[1][0]) / 2, (last.pts[0][1] + last.pts[1][1]) / 2]);
await page.keyboard.press("Delete");
check("選択して Delete で削除", (await shapes(page)).length === n0 - 1);
await page.click("#btnUndo");
check("削除も取り消せる", (await shapes(page)).length === n0);

await page.screenshot({ path: `${process.env.SHOT_DIR || "/tmp"}/shot-draw.png` });
console.log("\nconsole errors:", errors.length ? "\n" + errors.join("\n") : "none");
check("コンソールエラーなし", errors.length === 0, errors.join(" / "));
const { pass, fail } = summary();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await env.close();
process.exit(fail ? 1 : 0);
