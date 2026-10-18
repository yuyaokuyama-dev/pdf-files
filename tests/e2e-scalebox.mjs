// E2E: 元に戻す・やり直しの隣の「1/○○」(表示中のページの縮尺を常に表示・変更)
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "scalebox01");
await openPdf(page, "tests/fixtures/sample.pdf");
const sc = () => page.evaluate(() => window.__apdf.model.pages[0].scale);

check("ファイルを開くと「1/」の入力欄が出る", await page.locator("#scaleBox").isVisible());
const pos = await page.evaluate(() => {
  const r = (id) => document.querySelector(id).getBoundingClientRect();
  return { redo: r("#btnRedo").right, box: r("#scaleBox").left, zoom: r("#btnZoomOut").left };
});
check("やり直しの隣にある", pos.box >= pos.redo - 1 && pos.box < pos.zoom + 40, JSON.stringify(pos));
check("縮尺が未設定のあいだは空", (await page.inputValue("#scaleDen")) === "" && (await sc()) == null);

await page.fill("#scaleDen", "100");
await page.keyboard.press("Enter");
let s = await sc();
check("数字を入れて Enter で縮尺が設定される", s?.denom === 100 && s.unit === "mm" && s.ptsPerUnit > 0, JSON.stringify(s));
const k100 = s.ptsPerUnit;
await page.fill("#scaleDen", "50");
await page.locator("#scaleDen").blur();
s = await sc();
check("1/50 にすると 1mm あたりのptが2倍になる", s.denom === 50 && Math.abs(s.ptsPerUnit - k100 * 2) < 1e-6, JSON.stringify(s));

await page.fill("#scaleDen", "0");
await page.keyboard.press("Enter");
check("0以下は受け付けず、元の数字に戻る", (await sc()).denom === 50 && (await page.inputValue("#scaleDen")) === "50");

await page.evaluate(() => window.__apdf.model.undo());
check("元に戻すと欄の数字も戻る", (await page.inputValue("#scaleDen")) === "100", await page.inputValue("#scaleDen"));
await page.evaluate(() => window.__apdf.model.undo());
check("さらに戻すと空になる", (await page.inputValue("#scaleDen")) === "");

// 用紙と縮尺のダイアログで設定したときも欄に出る
await page.evaluate(() => {
  const m = window.__apdf.model;
  m.mutate(() => (m.pages[0].scale = { ptsPerUnit: 0.5, unit: "mm", paper: null, denom: 200 }));
});
check("ほかの方法で設定した縮尺も表示される", (await page.inputValue("#scaleDen")) === "200");
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`scalebox: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
