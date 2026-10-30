// E2E: プロパティパネルが出ていても、PDFの端をパネルの外までスクロールして操作できる
import { launch, register, openPdf, setZoom1, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "panm01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);

const geo = async () => { await page.waitForTimeout(250); return geo0(); };
const geo0 = () => page.evaluate(() => {
  const v = document.querySelector(".viewer");
  v.scrollLeft = v.scrollWidth;
  v.scrollTop = v.scrollHeight;
  const pg = document.querySelector(".page").getBoundingClientRect();
  const pr = document.querySelector("#props");
  const r = pr.hidden ? null : pr.getBoundingClientRect();
  const vr = v.getBoundingClientRect();
  return { pageRight: pg.right, pageBottom: pg.bottom, propsLeft: r?.left ?? null, propsTop: r?.top ?? null, viewerRight: vr.right };
});
const showProps = () => page.evaluate(() => {
  const S = window.__apdf;
  const pid = S.model.pages[0].id;
  const a = S.model.addShape(pid, { type: "rect", pts: [[40, 40], [140, 100]], style: { color: "#e11d48", width: 1 } }).id;
  S.editor.setSelection?.(pid, a);
  S.editor.setMultiSelection(pid, [a]);
});

// パネルなし
let g = await geo();
check("パネルが出ていないときは、PDFの右端が画面の中に収まる", g.pageRight <= g.viewerRight, JSON.stringify(g));

// パネルあり(広い画面)
await showProps();
await page.waitForSelector("#props:not([hidden])");
g = await geo();
check("パネルが出ていても、PDFの右端をパネルの左まで動かせる", g.propsLeft !== null && g.pageRight <= g.propsLeft, JSON.stringify(g));

// 拡大しても同じ
await page.evaluate(() => window.__apdf.editor.setZoom(3));
g = await geo();
check("拡大していても、PDFの右端がパネルの外に出せる", g.pageRight <= g.propsLeft, JSON.stringify(g));

// パネルを閉じると余白が戻る
await page.evaluate(() => { const S = window.__apdf; S.editor.clearSelection?.(); S.editor.setTool?.("select"); });
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const closed = await page.evaluate(() => document.querySelector("#props").hidden);
if (closed) {
  const padR = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector(".pages")).paddingRight));
  check("パネルを閉じると右の余白が元に戻る", padR < 40, String(padR));
}

// 狭い画面(下に出るパネル)
await page.setViewportSize({ width: 600, height: 800 });
await page.evaluate(() => window.__apdf.editor.setZoom(1));
await showProps();
await page.waitForSelector("#props:not([hidden])");
g = await geo();
check("狭い画面でも、PDFの下端をパネルの上まで動かせる", g.propsTop !== null && g.pageBottom <= g.propsTop, JSON.stringify(g));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const r = summary();
console.log(`panmargin: ${r.pass} pass / ${r.fail} fail`);
process.exit(r.fail ? 1 : 0);
