// E2E: 複数選択(範囲選択・投げ縄・Shift追加・まとめて移動/編集/削除)・レイヤー・用紙+縮尺
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "multi01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const ed = (fn, arg) => page.evaluate(fn, arg);
const multiIds = () => ed(() => window.__apdf.editor.multi?.ids.length ?? 0);
const selIds = () => ed(() => window.__apdf.editor.selectedIds().length);
const layerShapes = (id) => ed((id) => window.__apdf.model.pages[0].shapes.filter((s) => (s.layer || "0") === id).length, id);
const domShapes = () => page.locator(".page").first().locator(".layer .shape").count();

/* ---- 準備: 離れた3本の線(A:左上, B:左下, C:右) ---- */
for (const [a, b] of [[[100, 100], [180, 100]], [[100, 200], [180, 200]], [[400, 150], [480, 150]]]) {
  await tool(page, "line");
  await drag(page, 0, a, b);
}
let sh = await shapes(page);
check("3本の線を作成", sh.length === 3, String(sh.length));
await tool(page, "select");

/* ---- 窓選択(左→右): 完全に入る図形だけ ---- */
await drag(page, 0, [60, 60], [220, 260]);
check("窓選択でA・Bが選ばれる(Cは入らない)", (await multiIds()) === 2);
const ids2 = await ed(() => window.__apdf.editor.multi.ids);
check("選ばれたのはA・B", JSON.stringify(ids2) === JSON.stringify([sh[0].id, sh[1].id]), JSON.stringify(ids2));
check("複数選択のパネルが出る", (await page.locator("#props h3").textContent()).includes("複数選択(2個)"));

/* ---- 交差選択(右→左): 触れた図形も ---- */
await drag(page, 0, [520, 180], [130, 90]);
check("交差選択(右→左)でA・Cに触れる", (await multiIds()) === 2 && (await ed(() => window.__apdf.editor.multi.ids.includes(window.__apdf.model.pages[0].shapes[2].id))), String(await multiIds()));

/* ---- Shiftクリックで追加・解除 ---- */
await tool(page, "select");
await page.keyboard.down("Shift");
await click(page, 0, [140, 200]); // B を追加
await page.keyboard.up("Shift");
check("Shift+クリックで追加(A・C・B)", (await multiIds()) === 3, String(await multiIds()));
await page.keyboard.down("Shift");
await click(page, 0, [140, 200]); // B を解除
await page.keyboard.up("Shift");
check("Shift+クリックで解除(A・C)", (await multiIds()) === 2, String(await multiIds()));

/* ---- Ctrl+A / Escape ---- */
await page.keyboard.press("Control+a");
check("Ctrl+Aでページの全図形を選択", (await multiIds()) === 3, String(await multiIds()));
await page.keyboard.press("Escape");
check("Escapeで選択解除", (await selIds()) === 0);

/* ---- ドラッグでまとめて移動(1回の取り消しで戻る) ---- */
await page.keyboard.press("Control+a");
const before = await shapes(page);
const undoBefore = await ed(() => window.__apdf.model.undoStack.length);
await drag(page, 0, [140, 100], [170, 130]); // A の上をドラッグ
let after = await shapes(page);
check("3本ともまとめて動く(+30,+30)", after.every((s, i) => near(s.pts[0][0], before[i].pts[0][0] + 30) && near(s.pts[0][1], before[i].pts[0][1] + 30)), JSON.stringify(after.map((s) => s.pts[0])));
check("移動は1操作として記録", (await ed(() => window.__apdf.model.undoStack.length)) === undoBefore + 1);
await ed(() => window.__apdf.model.undo());
after = await shapes(page);
check("1回の取り消しで全部戻る", after.every((s, i) => near(s.pts[0][0], before[i].pts[0][0], 0.01)));

/* ---- プロパティ: 色・太さをまとめて変更 / 複製 / 前面 / 削除 ---- */
await page.keyboard.press("Control+a");
await page.locator('#props .sw[data-c="#16a34a"]').click();
sh = await shapes(page);
check("色が全部に反映", sh.every((s) => s.style.color === "#16a34a"));
await page.locator('#props [data-act="dup"]').click();
check("複製すると6本(複製が選択される)", (await shapes(page)).length === 6 && (await multiIds()) === 3);
await page.locator('#props [data-act="del"]').click();
check("削除すると3本に戻る", (await shapes(page)).length === 3 && (await selIds()) === 0);
await ed(() => window.__apdf.model.undo());
check("削除の取り消しで6本に戻る(1回で)", (await shapes(page)).length === 6);
await ed(() => { window.__apdf.model.undo(); window.__apdf.model.undo(); });
check("複製・色の取り消しで元の3本・元の色", (await shapes(page)).length === 3 && (await shapes(page)).every((s) => s.style.color !== "#16a34a"));

/* ---- 範囲選択ツール: タップで追加、空きをタップで解除 ---- */
await tool(page, "marquee");
await click(page, 0, [140, 100]);
await click(page, 0, [440, 150]);
check("範囲選択ツールのタップで追加", (await multiIds()) === 2, String(await multiIds()));
await click(page, 0, [300, 400]);
check("空きをタップで解除", (await selIds()) === 0);
await drag(page, 0, [60, 60], [220, 260]);
check("範囲選択ツールでもドラッグで窓選択", (await multiIds()) === 2);

/* ---- 投げ縄 ---- */
await tool(page, "lasso");
const lasso = [[60, 60], [230, 70], [230, 250], [60, 250], [60, 70]];
const [lx, ly] = await toScreen(page, 0, lasso[0][0], lasso[0][1]);
await page.mouse.move(lx, ly);
await page.mouse.down();
for (const q of lasso.slice(1)) {
  const [x, y] = await toScreen(page, 0, q[0], q[1]);
  await page.mouse.move(x, y, { steps: 6 });
}
await page.mouse.up();
check("投げ縄で囲んだA・Bが選ばれる", (await multiIds()) === 2, String(await multiIds()));
await tool(page, "select");
await page.keyboard.press("Escape");

/* ---- レイヤー ---- */
await page.click("#btnLayers");
check("レイヤーパネルが開く", await page.locator("#layers").isVisible());
check("最初は基本レイヤー(0)だけ", (await page.locator("#layers .lp-row").count()) === 1);
await page.locator('#layers [data-act="add"]').click();
check("追加すると2つになり、新しいほうが描く先", (await page.locator("#layers .lp-row").count()) === 2 && (await ed(() => window.__apdf.model.curLayer)) === "L1");
// 名前と色
await page.locator('#layers .lp-row[data-id="L1"] [data-k="name"]').fill("壁");
await page.locator('#layers .lp-row[data-id="L1"] [data-k="name"]').press("Enter");
await page.locator('#layers .lp-row[data-id="L1"] [data-k="color"]').evaluate((el) => { el.value = "#ff0000"; el.dispatchEvent(new Event("change", { bubbles: true })); });
check("名前と色を変更できる", await ed(() => { const l = window.__apdf.model.layer("L1"); return l.name === "壁" && l.color === "#ff0000"; }));
// 壁レイヤーに描く
await tool(page, "line");
await drag(page, 0, [100, 320], [200, 320]);
await tool(page, "select");
await page.keyboard.press("Escape");
sh = await shapes(page);
const wall = sh.at(-1);
check("新しい線は壁レイヤーで、色などをレイヤーに従う", wall.layer === "L1" && wall.bl?.length === 3, JSON.stringify(wall));
let stroke = await page.locator(`.layer .shape[data-id="${wall.id}"] path:not(.hit)`).first().getAttribute("stroke");
check("画面にはレイヤーの色(赤)で描かれる", stroke === "#ff0000", stroke);
// 個別に色を変えるとその項目だけ従わなくなる
await click(page, 0, [150, 320]);
await page.locator('#props .sw[data-c="#2563eb"]').click();
const w2 = (await shapes(page)).at(-1);
check("色を個別指定すると、色だけレイヤーに従わなくなる", w2.style.color === "#2563eb" && !w2.bl.includes("color") && w2.bl.includes("width"), JSON.stringify(w2));
await page.locator('#props [data-k="bl"]').check();
check("「レイヤーに従う」で戻る", (await ed(() => { const s = window.__apdf.model.pages[0].shapes.at(-1); return s.bl.length === 3; })));
// レイヤー移動
await page.locator('#props [data-k="layer"]').selectOption("0");
check("プロパティからレイヤーを移せる", (await shapes(page)).at(-1).layer === "0");
await ed(() => window.__apdf.model.undo());
check("レイヤー移動も取り消せる", (await shapes(page)).at(-1).layer === "L1");
await page.keyboard.press("Escape");

// 表示/非表示
const nAll = await domShapes();
await page.locator('#layers .lp-row[data-id="L1"] [data-act="vis"]').click();
check("非表示にすると図形が画面から消える", (await domShapes()) === nAll - 1, `${nAll} → ${await domShapes()}`);
const hiddenPdf = await ed(async () => { const S = window.__apdf; const r = await S.exportPdf(S.model, { level: "none" }); return r.bytes.length; });
check("非表示レイヤーがあってもPDFを書き出せる", hiddenPdf > 1000);
await page.keyboard.press("Control+a");
check("非表示の図形は全選択に入らない", (await multiIds()) === 3, String(await multiIds()));
await page.keyboard.press("Escape");
await page.locator('#layers .lp-row[data-id="L1"] [data-act="vis"]').click();
check("表示に戻すと見える", (await domShapes()) === nAll);

// ロック
await page.locator('#layers .lp-row[data-id="L1"] [data-act="lock"]').click();
await click(page, 0, [150, 320]);
check("ロックしたレイヤーの図形は選べない", (await selIds()) === 0);
await page.keyboard.press("Control+a");
check("ロック中のレイヤーは全選択に入らない", (await multiIds()) === 3, String(await multiIds()));
await page.keyboard.press("Escape");
await page.locator('#layers .lp-row[data-id="L1"] [data-act="lock"]').click();
await click(page, 0, [150, 320]);
check("ロックを解除すると選べる", (await selIds()) === 1);
await page.keyboard.press("Escape");

// レイヤーの図形を選択
await page.locator('#layers .lp-row[data-id="L1"] [data-act="sel"]').click();
check("「図形を選択」でレイヤーの図形を選ぶ", (await selIds()) === 1);
await page.keyboard.press("Escape");

// 基本レイヤーは削除できない
check("基本レイヤー(0)の削除ボタンは押せない", await page.locator('#layers .lp-row[data-id="0"] [data-act="del"]').isDisabled());

// 保存データにレイヤーが入る・復元できる
const restored = await ed(async () => {
  const S = window.__apdf;
  const data = JSON.parse(JSON.stringify(S.model.serialize()));
  data.images = [];
  const { DocModel } = await import("./js/model.js");
  const m = await DocModel.restore({ ...data, sources: [] }, async () => null);
  return { names: m.layers.map((l) => l.name), color: m.layer("L1").color };
});
check("保存・復元でレイヤーが残る", restored.names.join() === "0,壁" && restored.color === "#ff0000", JSON.stringify(restored));

// 削除(確認ダイアログ → 図形も消える → 取り消しで戻る)
await page.locator('#layers .lp-row[data-id="L1"] [data-act="del"]').click();
await page.locator("dialog .btn.danger").click();
check("レイヤーを削除すると図形も消える", (await layerShapes("L1")) === 0 && !(await ed(() => !!window.__apdf.model.layer("L1"))) && (await shapes(page)).length === 3);
check("描く先が基本レイヤーに戻る", (await ed(() => window.__apdf.model.curLayer)) === "0");
await ed(() => window.__apdf.model.undo());
check("削除は取り消しで戻る(レイヤーも図形も)", (await layerShapes("L1")) === 1 && (await ed(() => !!window.__apdf.model.layer("L1"))));

/* ---- 用紙 + 縮尺 ---- */
await tool(page, "calib");
await page.locator('#props [data-act="scale-preset"]').click();
await page.waitForSelector("dialog #spDen");
check("用紙はページの大きさから推定(A4)", (await page.locator("#spPaper").inputValue()) === "A4");
await page.locator("#spPaper").selectOption("A3");
await page.locator('dialog [data-den="100"]').click();
check("実寸の目安が表示される", (await page.locator("#spInfo").textContent()).includes("実寸"));
await page.locator("dialog .btn.primary").click();
const sc = await ed(() => window.__apdf.model.pages[0].scale);
check("A3 1/100 に設定(A4のページを A3 の縮小とみなす)", sc && sc.paper === "A3" && sc.denom === 100 && near(sc.ptsPerUnit, 841.89 / 420 / 100, 0.001), JSON.stringify(sc));
check("パネルに縮尺が表示される", (await page.locator("#props").textContent()).includes("A3 1/100"));
await tool(page, "measure");
await drag(page, 0, [100, 500], [100 + 841.89 / 420 / 100 * 5000, 500]); // 実寸5000mm
const m1 = (await shapes(page)).at(-1);
const label = await ed((id) => { const S = window.__apdf; const f = S.model.findShape(id); return S.editor.labelOf(f.shape, f.page); }, m1.id);
check("計測が縮尺どおり(約5000 mm)", /^(49\d\d|50\d\d)(\.\d)? mm$/.test(label), label);

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
const { pass, fail } = summary();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await env.close();
process.exit(fail ? 1 : 0);
