// E2E: 文字つき引出線(アンダーライン/丸囲み・矢印/黒丸・文字なし・文字の移動・書き出し)
import { launch, register, openPdf, setZoom1, drag, click, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await page.evaluate(() => localStorage.removeItem("apdf_defaults_v1"));
await register(page, "leader01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
const ed = (fn, arg) => page.evaluate(fn, arg);
const last = async () => (await shapes(page)).at(-1);
const answer = async (text) => {
  await page.waitForSelector("dialog[open] #pdIn");
  await page.fill("dialog[open] #pdIn", text);
  await page.locator("dialog[open] .btn.primary").click();
  await page.waitForSelector("dialog[open]", { state: "detached" });
};

/* ---- 作成: 先端 → 文字側へドラッグし、文字を入れる ---- */
await tool(page, "leader");
await drag(page, 0, [150, 200], [250, 160]);
await answer("仕上げ材");
let s = await last();
check("引出線つき文字が作られる", s.type === "leader" && s.text === "仕上げ材", JSON.stringify(s));
check("先端と文字側の端が指定どおり", near(s.pts[0][0], 150) && near(s.pts[0][1], 200) && near(s.pts[1][0], 250) && near(s.pts[1][1], 160), JSON.stringify(s.pts));
check("初期は アンダーライン + 矢印", s.box === "underline" && s.tip === "arrow", `${s.box} ${s.tip}`);
const domText = await page.locator(".page").first().locator(".layer .shape-leader text").textContent();
check("文字が画面に描かれる", domText.includes("仕上げ材"), domText);
check("パネルに文字の入力欄が出る", (await page.locator('#props [data-k="ltext"]').inputValue()) === "仕上げ材");

/* ---- 囲み・先端の切り替え ---- */
await page.selectOption('#props [data-k="lbox"]', "circle");
await page.selectOption('#props [data-k="ltip"]', "dot");
s = await last();
check("丸で囲う・黒丸に切り替わる", s.box === "circle" && s.tip === "dot", `${s.box} ${s.tip}`);
const hasStadium = await page.locator(".page").first().locator(".layer .shape-leader path[d*='A']").count();
check("丸(長丸)の枠が描かれる", hasStadium >= 1);
check("黒丸が描かれる", (await page.locator(".page").first().locator(".layer .shape-leader circle").count()) === 1);

/* ---- 文字を動かしても先端は動かない(文字側の端の頂点をドラッグ) ---- */
const tipBefore = s.pts[0];
{
  const { toScreen } = await import("./e2e-lib.mjs");
  const [hx, hy] = await toScreen(page, 0, 250, 160);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  const [tx, ty] = await toScreen(page, 0, 300, 120);
  await page.mouse.move(tx, ty, { steps: 6 });
  await page.mouse.up();
}
s = await last();
check("文字側を動かすと先端は動かない", near(s.pts[0][0], tipBefore[0]) && near(s.pts[0][1], tipBefore[1]) && near(s.pts[1][0], 300, 3) && near(s.pts[1][1], 120, 3), JSON.stringify(s.pts));

/* ---- 文字なし(空欄) ---- */
await tool(page, "leader");
await drag(page, 0, [100, 400], [200, 400]);
await answer("");
s = await last();
check("空欄なら文字なしの引出線になる", s.type === "leader" && !s.text, JSON.stringify(s.text));
check("文字なしでは文字が描かれない", (await page.locator(".page").first().locator(".layer .shape-leader").last().locator("text").count()) === 0);

/* ---- 直前の設定を引き継ぐ ---- */
await tool(page, "leader");
await drag(page, 0, [100, 500], [200, 520]);
await answer("1");
s = await last();
check("次に描く引出線に直前の囲み・先端が引き継がれる", s.box === "circle" && s.tip === "dot", `${s.box} ${s.tip}`);

/* ---- 回転・拡大(修正コマンド)で文字の大きさも変わる ---- */
await ed(() => { const e = window.__apdf.editor; e.setTool("select"); e.setSelection({ pageId: window.__apdf.model.pages[0].id, shapeId: window.__apdf.model.pages[0].shapes.at(-1).id }); e.applyMatrices([{ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0, k: 2, rot: 0, flip: false }], {}); });
const big = await last();
check("尺度2倍で文字の大きさも2倍", near(big.size, s.size * 2, 0.01), `${s.size} -> ${big.size}`);

/* ---- PDF書き出しにも出る ---- */
const bytes = await ed(async () => {
  const { exportPdf } = await import("./js/export.js");
  const res = await exportPdf(window.__apdf.model, { level: "standard" });
  return (res.bytes || res).length;
});
check("PDFに書き出せる", bytes > 1000, String(bytes));

check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
