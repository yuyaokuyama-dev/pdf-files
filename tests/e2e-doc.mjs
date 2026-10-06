// E2E ②: ページ操作・PDF書き出し(再描画で画素検証)・最適化・署名/印影・写真・永続化
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page);
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

/* ---------- ページ操作(⑦) ---------- */
await page.click("#btnPages");
await page.waitForSelector(".thumb");
check("ページ一覧にサムネイルが3枚", (await page.locator(".thumb").count()) === 3);
const ids0 = await page.evaluate(() => window.__apdf.model.pages.map((p) => p.id));
await page.locator('.thumb').nth(0).locator('[data-act="down"]').click();
let ids1 = await page.evaluate(() => window.__apdf.model.pages.map((p) => p.id));
check("↓ボタンでページを並べ替え", ids1[0] === ids0[1] && ids1[1] === ids0[0]);
// ドラッグ&ドロップで並べ替え(3枚目を先頭へ)
await page.locator(".thumb").nth(2).dragTo(page.locator(".thumb").nth(0));
let ids2 = await page.evaluate(() => window.__apdf.model.pages.map((p) => p.id));
check("ドラッグ&ドロップでページを並べ替え", ids2[0] === ids1[2], `${ids1} -> ${ids2}`);
await page.click("#btnUndo");
await page.click("#btnUndo");
check("並べ替えを取り消せる", JSON.stringify(await page.evaluate(() => window.__apdf.model.pages.map((p) => p.id))) === JSON.stringify(ids0));
// 回転
const sz0 = await page.evaluate(() => [window.__apdf.model.pages[0].w, window.__apdf.model.pages[0].h]);
await page.locator('.thumb').nth(0).locator('[data-act="rot"]').click();
const sz1 = await page.evaluate(() => [window.__apdf.model.pages[0].w, window.__apdf.model.pages[0].h]);
check("ページを回転(縦横が入れ替わる)", Math.abs(sz1[0] - sz0[1]) < 0.01 && Math.abs(sz1[1] - sz0[0]) < 0.01);
await page.click("#btnUndo");
// 削除
page.once("dialog", () => {});
await page.locator('.thumb').nth(2).locator('[data-act="del"]').click();
await page.waitForSelector("dialog[open] .btn.danger");
await page.click("dialog[open] .foot .btn.danger");
await page.waitForFunction(() => window.__apdf.model.pages.length === 2);
check("ページを削除(3→2枚)", true);
// 白紙ページ追加
await page.click('[data-bar="add"]');
await page.locator("#menu button", { hasText: "白紙ページ(A4縦)" }).click();
await page.waitForFunction(() => window.__apdf.model.pages.length === 3);
check("白紙ページを追加(2→3枚)", true);
// 複数選択して削除
await page.locator(".thumb input[type=checkbox]").nth(1).check();
await page.locator(".thumb input[type=checkbox]").nth(2).check();
await page.click('[data-bar="del"]');
await page.click("dialog[open] .foot .btn.danger");
await page.waitForFunction(() => window.__apdf.model.pages.length === 1);
check("チェックしたページをまとめて削除", true);
await page.click("#btnUndo");
await page.waitForFunction(() => window.__apdf.model.pages.length === 3);
check("ページ削除の取り消し", true);
await page.click("#btnPages"); // 閉じる
await setZoom1(page);

/* ---------- 図形をまとめて作る → PDF書き出し(⑧) → 再描画して画素検証 ---------- */
await page.evaluate(() => {
  const S = window.__apdf;
  const m = S.model;
  const pg = m.pages[0];
  // 2ページ目以降に混ざった白紙ページは使わない。1ページ目にすべて載せる
  const st = (o) => ({ width: 4, fill: "none", ...o });
  const add = (s) => m.addShape(pg.id, s);
  add({ type: "rect", pts: [[100, 100], [300, 200]], style: st({ color: "#ff0000" }) });
  add({ type: "ellipse", pts: [[320, 100], [500, 200]], style: st({ color: "#0000ff", fill: "#0000ff", fillOpacity: 1 }) });
  add({ type: "line", pts: [[100, 250], [300, 250]], style: st({ color: "#00aa00" }) });
  add({ type: "arrow", pts: [[100, 300], [300, 350]], style: st({ color: "#000000" }) });
  add({ type: "cloud", pitch: 24, pts: [[100, 400], [300, 400], [300, 500], [100, 500]], style: st({ color: "#ff00ff" }) });
  add({ type: "polygon", pts: [[350, 400], [500, 400], [425, 520]], style: st({ color: "#ff8800", fill: "#ffcc00", fillOpacity: 1 }) });
  add({ type: "text", pts: [[100, 560]], text: "寸法テスト漢字", size: 30, font: "gothic", color: "#000000", style: { color: "#000000", width: 1 } });
  add({ type: "dim", pts: [[100, 650], [300, 650]], off: 30, size: 14, text: "3600", style: st({ color: "#cc0000", width: 1.5 }) });
  add({ type: "pen", pts: [[350, 600], [380, 640], [410, 600], [440, 640], [470, 600]], style: st({ color: "#009999", width: 5 }) });
  // 画像(緑ベタ)
  const c = document.createElement("canvas"); c.width = 100; c.height = 50;
  const g = c.getContext("2d"); g.fillStyle = "#00cc00"; g.fillRect(0, 0, 100, 50);
  const imgId = m.addImage(c.toDataURL("image/png"));
  add({ type: "image", kind: "stamp", imgId, aspect: 2, pts: [[350, 680], [450, 730]], style: {} });
});

async function renderExport(level, pageNo, points, regions = []) {
  return page.evaluate(async ([level, pageNo, points, regions]) => {
    const S = window.__apdf;
    const res = await S.exportPdf(S.model, { level });
    const pdfjs = await import("./vendor/pdf.min.mjs");
    const doc = await pdfjs.getDocument({ data: res.bytes.slice() }).promise;
    const pg = await doc.getPage(pageNo);
    const vp = pg.getViewport({ scale: 1 });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
    const px = points.map(([x, y]) => Array.from(ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)));
    const rc = regions.map(([x, y, w, h]) => {
      const d = ctx.getImageData(x, y, w, h).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
      return n;
    });
    return { size: res.bytes.length, pages: doc.numPages, w: vp.width, h: vp.height, px, rc };
  }, [level, pageNo, points, regions]);
}
const near = (c, [r, g, b], tol = 70) => Math.abs(c[0] - r) < tol && Math.abs(c[1] - g) < tol && Math.abs(c[2] - b) < tol;

const pts = [
  [200, 100], [200, 150],        // 四角: 上辺=赤 / 内側=白(元PDFの要素と被らない位置)
  [410, 150],                    // 塗り丸=青
  [200, 250],                    // 線=緑
  [450, 600],                    // (ペン付近)
  [425, 440],                    // 多角形の塗り=黄
  [200, 650 + 30 + 0],           // 寸法線の線 (y=680)
  [400, 705],                    // 画像=緑
];
const regs = [
  [100, 380, 200, 20],   // 雲: 上辺の外側へ膨らんだ円弧 (y 380–400)
  [100, 556, 260, 40],   // テキスト
  [150, 655, 100, 22],   // 寸法の数字
  [150, 305, 120, 40],   // 矢印
  [340, 590, 140, 60],   // ペン
];
const out = await renderExport("standard", 1, pts, regs);
check("書き出したPDFは3ページ", out.pages === 3, `pages=${out.pages}`);
check("四角の線が赤で出力される", near(out.px[0], [255, 0, 0]), JSON.stringify(out.px[0]));
check("四角の内側は塗りなし(白)", near(out.px[1], [255, 255, 255], 30), JSON.stringify(out.px[1]));
check("塗りつぶしの丸が青", near(out.px[2], [0, 0, 255]), JSON.stringify(out.px[2]));
check("線が緑で出力される", near(out.px[3], [0, 170, 0]), JSON.stringify(out.px[3]));
check("多角形の塗りが黄", near(out.px[5], [255, 204, 0]), JSON.stringify(out.px[5]));
check("寸法線(補助線/寸法線)が描画される", out.px[6][0] > 120 && out.px[6][1] < 120, JSON.stringify(out.px[6]));
check("画像(スタンプ)が配置される", near(out.px[7], [0, 204, 0]), JSON.stringify(out.px[7]));
check("雲マークの円弧が矩形の外側へ膨らむ", out.rc[0] > 40, `n=${out.rc[0]}`);
check("日本語テキストが出力される", out.rc[1] > 150, `n=${out.rc[1]}`);
check("寸法の数値(3600)が出力される", out.rc[2] > 30, `n=${out.rc[2]}`);
check("矢印が出力される", out.rc[3] > 40, `n=${out.rc[3]}`);
check("ペンの線が出力される", out.rc[4] > 60, `n=${out.rc[4]}`);

// 画面表示と同じ位置に出ているか(エディタ上の四角の座標と同じ)
await page.screenshot({ path: "/tmp/claude-0/shot-doc.png" });

/* ---------- 最適化(⑫): 大きな写真を入れてレベル別サイズ比較 ---------- */
await page.evaluate(() => {
  const S = window.__apdf;
  const c = document.createElement("canvas"); c.width = 1800; c.height = 1350;
  const g = c.getContext("2d");
  const id = g.createImageData(c.width, c.height);
  let seed = 12345;
  for (let i = 0; i < id.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = (seed >> 16) & 255;
    id.data[i] = (v * 3) & 255; id.data[i + 1] = (v * 7 + 40) & 255; id.data[i + 2] = (v * 5 + 90) & 255; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
  const url = c.toDataURL("image/jpeg", 0.95);
  const m = S.model;
  const imgId = m.addImage(url);
  m.addShape(m.pages[1].id, { type: "image", kind: "photo", imgId, aspect: 4 / 3, pts: [[50, 100], [550, 475]], style: {} });
});
const sizes = {};
for (const lv of ["standard", "small", "tiny"]) sizes[lv] = (await renderExport(lv, 2, [], [])).size;
console.log("  sizes:", JSON.stringify(sizes));
check("最適化: 軽量は標準より小さい", sizes.small < sizes.standard * 0.8, JSON.stringify(sizes));
check("最適化: 最小(画像化)でも有効なPDFが出る", sizes.tiny > 1000);
const tinyPages = (await renderExport("tiny", 1, [[200, 100]], [])).px[0];
check("最小モードでも注釈が焼き込まれている(四角=赤)", near(tinyPages, [255, 0, 0], 90), JSON.stringify(tinyPages));

/* ---------- 署名(⑯): 四角で範囲指定 → 入力ボックス → 手書き ---------- */
await tool(page, "sign");
await drag(page, 0, [100, 760], [300, 820]);
await page.waitForSelector("dialog[open] #sigPad");
const pad = await page.locator("#sigPad").boundingBox();
await page.mouse.move(pad.x + 40, pad.y + 120);
await page.mouse.down();
for (let i = 0; i <= 30; i++) await page.mouse.move(pad.x + 40 + i * 8, pad.y + 120 + Math.sin(i / 3) * 40);
await page.mouse.up();
await page.click("dialog[open] .foot .btn.primary");
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.some((s) => s.kind === "signature"));
const sig = (await shapes(page)).find((s) => s.kind === "signature");
check("署名: 範囲指定→手書き→範囲内に配置", sig.pts[0][0] >= 99 && sig.pts[1][0] <= 301 && sig.pts[0][1] >= 759 && sig.pts[1][1] <= 821, JSON.stringify(sig.pts));
const savedSigs = await page.evaluate(() => window.__apdf.store.getAll("sigs").then((a) => a.length));
check("署名は保存され次回から選べる", savedSigs === 1);

/* ---------- 印影(⑥): 登録 → スタンプ ---------- */
await page.evaluate(async () => {
  const S = window.__apdf;
  const { makeHankoDataUrl } = await import("./js/raster.js");
  const url = makeHankoDataUrl("山田", "#d9261c");
  await S.store.put("stamps", { id: "s1", name: "山田(印)", url, aspect: 1, createdAt: Date.now() });
});
await tool(page, "stamp");
await page.waitForSelector("#props .st");
await click(page, 0, [450, 780]);
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.some((s) => s.kind === "stamp" && s.imgId === "st_s1"));
check("登録した印影をタップした位置にスタンプ", true);
const stamp = (await shapes(page)).find((s) => s.imgId === "st_s1");
check("スタンプは選択状態でリサイズ用ハンドルが出る", (await page.locator(".handle[data-kind=v]").count()) === 4);

/* ---------- 写真(⑨): 挿入 → その上に手書き ---------- */
await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 800; c.height = 600;
  const g = c.getContext("2d"); g.fillStyle = "#3366cc"; g.fillRect(0, 0, 800, 600);
  c.toBlob((b) => { window.__photoBlob = b; }, "image/jpeg", 0.9);
});
await page.waitForFunction(() => window.__photoBlob);
const photoBytes = await page.evaluate(async () => Array.from(new Uint8Array(await window.__photoBlob.arrayBuffer())));
await page.evaluate(() => window.__apdf.editor.setTool("select"));
await page.click('.tool[data-tool="camera"]');
{
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#menu button", { hasText: "画像ファイルを挿入" }).click()]);
  await fc.setFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photoBytes) });
}
await page.waitForFunction(() => window.__apdf.model.pages[0].shapes.some((s) => s.kind === "photo"), null, { timeout: 10000 });
check("写真を現在のページに挿入", true);
const photo = (await shapes(page)).find((s) => s.kind === "photo");
// その上にペンで書き込み
await tool(page, "pen");
const mid = [(photo.pts[0][0] + photo.pts[1][0]) / 2, (photo.pts[0][1] + photo.pts[1][1]) / 2];
const before = (await shapes(page)).length;
await drag(page, 0, [mid[0] - 40, mid[1]], [mid[0] + 40, mid[1] + 20]);
check("写真の上から手書きできる", (await shapes(page)).length === before + 1 && (await shapes(page)).at(-1).type === "pen");
// 写真を新規ページに
await page.click('.tool[data-tool="camera"]');
{
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#menu button", { hasText: "画像ファイルをページ追加" }).click()]);
  await fc.setFiles({ name: "photo2.jpg", mimeType: "image/jpeg", buffer: Buffer.from(photoBytes) });
}
await page.waitForFunction(() => window.__apdf.model.pages.length === 4, null, { timeout: 10000 });
check("写真を新規ページとして追加", true);

/* ---------- 自動保存 → 再読み込みで復元(⑮⑰) ---------- */
await page.waitForTimeout(1800);
const nShapes = (await shapes(page, 0)).length;
await page.reload();
await page.waitForFunction(() => window.__apdf?.model?.pages?.length === 4, null, { timeout: 15000 });
check("再読み込みしても編集内容が復元される(ページ数)", true);
check("再読み込みしても図形が復元される", (await shapes(page, 0)).length === nShapes, `${(await shapes(page, 0)).length} vs ${nShapes}`);
await page.waitForFunction(() => document.querySelectorAll('.page[data-rendered="1"]').length >= 1);
// 復元後も図形を移動・削除できる(編集可能なまま保存されている)
const rc = (await shapes(page))[0];
check("復元後も図形が編集可能なデータで残る", rc.type === "rect" && Array.isArray(rc.pts));

/* ---------- 履歴(⑮) ---------- */
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "履歴" }).click();
await page.waitForSelector("dialog[open] #hLocal .item");
check("履歴一覧にこの端末の作業が表示される", (await page.locator("#hLocal .item").count()) >= 1);
await page.keyboard.press("Escape");

/* ---------- 回転PDF(座標変換)の書き出し ---------- */
await openPdf(page, "tests/fixtures/rotated.pdf");
await setZoom1(page);
const rp = await page.evaluate(() => { const p = window.__apdf.model.pages[0]; return [p.w, p.h]; });
check("回転(90°)PDFは回転後の向きで表示される", Math.abs(rp[0] - 600) < 1 && Math.abs(rp[1] - 400) < 1, JSON.stringify(rp));
await page.evaluate(() => {
  const S = window.__apdf; const m = S.model;
  m.addShape(m.pages[0].id, { type: "rect", pts: [[50, 250], [150, 300]], style: { color: "#ff0000", width: 6, fill: "none" } });
  m.addShape(m.pages[0].id, { type: "text", pts: [[300, 250]], text: "ROT", size: 40, font: "gothic", color: "#000000", style: { color: "#000", width: 1 } });
});
const r90 = await renderExport("standard", 1, [[100, 250], [50, 275]], [[300, 245, 120, 55]]);
check("回転PDFでも注釈が画面と同じ位置に出る(四角の上辺=赤)", near(r90.px[0], [255, 0, 0], 90), JSON.stringify(r90.px));
check("回転PDFでもテキストが正しい位置に出る", r90.rc[0] > 60, `n=${r90.rc[0]}`);
check("書き出し後も回転後の寸法のまま", Math.abs(r90.w - 600) < 1 && Math.abs(r90.h - 400) < 1, `${r90.w}x${r90.h}`);

console.log("\nconsole errors:", errors.length ? "\n" + errors.join("\n") : "none");
check("コンソールエラーなし", errors.length === 0, errors.join(" / "));
const { pass, fail } = summary();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await env.close();
process.exit(fail ? 1 : 0);
