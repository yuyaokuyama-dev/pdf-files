// E2E: 修正コマンド(基点つき移動/コピー・回転・尺度・鏡像・配列複写・オフセット)とキー操作
import { launch, register, openPdf, setZoom1, click, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "modify01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const nearP = (p, q, tol = 1.5) => near(p[0], q[0], tol) && near(p[1], q[1], tol);
const ed = (fn, arg) => page.evaluate(fn, arg);
const count = async () => (await shapes(page)).length;
const openMod = () => page.evaluate(() => { const d = document.querySelector("#props details.modbox"); if (d) d.open = true; });
const setMv = async (k, v) => {
  const sel = `#props [data-k="mv:${k}"]`;
  await openMod();
  const el = page.locator(sel);
  if ((await el.getAttribute("type")) === "checkbox") (v ? await el.check() : await el.uncheck());
  else {
    await el.fill(String(v));
    await el.dispatchEvent("change");
  }
};
const cmd = async (c) => {
  await openMod();
  await page.click(`#props [data-act="cmd"][data-c="${c}"]`);
};
const newLine = async (a, b) => {
  await page.keyboard.press("Escape");
  await tool(page, "line");
  const { drag } = await import("./e2e-lib.mjs");
  await drag(page, 0, a, b);
};
const reselect = async (pt) => {
  await tool(page, "select");
  await click(page, 0, pt);
};

/* ---- 準備: 線 (100,100)-(200,100) ---- */
await newLine([100, 100], [200, 100]);
const L0 = (await shapes(page)).at(-1);
await reselect([150, 100]);
check("線を選ぶと修正コマンドの欄が出る", (await page.locator("#props details.modbox").count()) === 1);

/* ---- 移動 ---- */
await cmd("move");
await click(page, 0, [100, 100]);
await click(page, 0, [100, 200]);
let s = (await shapes(page)).at(-1);
check("基点指定の移動: 線が下へ100動く", nearP(s.pts[0], [100, 200]) && nearP(s.pts[1], [200, 200]), JSON.stringify(s.pts));
check("移動したのは同じ図形(増えない)", s.id === L0.id && (await count()) === 1);
await ed(() => window.__apdf.model.undo());
s = (await shapes(page)).at(-1);
check("取り消しで元の位置に戻る", nearP(s.pts[0], [100, 100]), JSON.stringify(s.pts));

/* ---- コピー(続けて2回) ---- */
await reselect([150, 100]);
await cmd("copy");
await click(page, 0, [100, 100]);
await click(page, 0, [100, 200]);
await click(page, 0, [100, 300]);
check("コピー: 続けて2つ増える", (await count()) === 3, String(await count()));
await page.keyboard.press("Escape");
check("Escでコピーを終える", (await ed(() => !window.__apdf.editor.cmd)));
await ed(() => { window.__apdf.model.undo(); window.__apdf.model.undo(); });
check("取り消し2回で元の1本に戻る", (await count()) === 1, String(await count()));

/* ---- 回転(90°・基点(100,100)) ---- */
await reselect([150, 100]);
await setMv("angle", 90);
await cmd("rotate");
await click(page, 0, [100, 100]);
s = (await shapes(page)).at(-1);
check("回転: 右回り90°で下向きの線になる", nearP(s.pts[0], [100, 100]) && nearP(s.pts[1], [100, 200]), JSON.stringify(s.pts));
await ed(() => window.__apdf.model.undo());

/* ---- 尺度(2倍・基点(100,100)) ---- */
await reselect([150, 100]);
await setMv("k", 2);
await cmd("scale");
await click(page, 0, [100, 100]);
s = (await shapes(page)).at(-1);
check("尺度: 基点を動かさず2倍", nearP(s.pts[0], [100, 100]) && nearP(s.pts[1], [300, 100]), JSON.stringify(s.pts));
await ed(() => window.__apdf.model.undo());

/* ---- 鏡像(縦の軸 x=300、元を残す) ---- */
await reselect([150, 100]);
await setMv("keep", true);
await cmd("mirror");
await click(page, 0, [300, 50]);
await click(page, 0, [300, 250]);
check("鏡像: 元を残して1本増える", (await count()) === 2, String(await count()));
s = (await shapes(page)).at(-1);
check("鏡像: x=300 で左右反転", nearP(s.pts[0], [500, 100]) && nearP(s.pts[1], [400, 100]), JSON.stringify(s.pts));
await ed(() => window.__apdf.model.undo());

/* ---- 矩形状配列 2行×3列 ---- */
await reselect([150, 100]);
await setMv("rows", 2);
await setMv("cols", 3);
await setMv("rowd", 40);
await setMv("cold", 150);
await openMod();
await page.click('#props [data-act="cmd-array"]');
check("矩形状配列: 2×3 で元を除く5個増える", (await count()) === 6, String(await count()));
const xs = (await shapes(page)).map((x) => Math.round(x.pts[0][0])).sort((a, b) => a - b);
check("配列の間隔が反映される", JSON.stringify(xs) === JSON.stringify([100, 100, 250, 250, 400, 400]), JSON.stringify(xs));
await ed(() => window.__apdf.model.undo());
check("配列は1回の取り消しで戻る", (await count()) === 1);

/* ---- 円形状配列 4個・360° ---- */
await reselect([150, 100]);
await setMv("count", 4);
await setMv("pang", 360);
await setMv("protate", true);
await cmd("polar");
await click(page, 0, [100, 300]);
check("円形状配列: 4個(元を除く3個増える)", (await count()) === 4, String(await count()));
await ed(() => window.__apdf.model.undo());

/* ---- オフセット(四角を外側へ10) ---- */
await tool(page, "rect");
const { drag } = await import("./e2e-lib.mjs");
await drag(page, 0, [300, 400], [400, 460]);
await reselect([300, 430]);
await setMv("dist", 10);
await cmd("offset");
await click(page, 0, [500, 520]);
const r = (await shapes(page)).at(-1);
const x0 = Math.min(r.pts[0][0], r.pts[1][0]);
const x1 = Math.max(r.pts[0][0], r.pts[1][0]);
check("オフセット: 外側へ10広がる四角が増える", r.type === "rect" && near(x0, 290) && near(x1, 410), JSON.stringify(r.pts));
await page.keyboard.press("Escape");

/* ---- キー操作 ---- */
await page.keyboard.press("Escape");
await page.keyboard.press("l");
check("Lキーで線ツール", (await ed(() => window.__apdf.editor.tool)) === "line");
await page.keyboard.press("r");
check("Rキーで四角ツール", (await ed(() => window.__apdf.editor.tool)) === "rect");
await page.keyboard.press("v");
check("Vキーで選択ツール", (await ed(() => window.__apdf.editor.tool)) === "select");

check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
