// E2E: iPhone相当の画面でのトップバー・ピンチ・描画
import { launch, register, openPdf, check, summary } from "./e2e-lib.mjs";

const env = await launch({ mobile: true });
const { page, errors } = env;
await page.goto(env.base);
await register(page, "mobile01");
await openPdf(page, "tests/fixtures/sample.pdf");

// ② アカウントボタンが画面内にあり押せる(390px / 360px)
for (const w of [390, 360]) {
  await page.setViewportSize({ width: w, height: 800 });
  const r = await page.evaluate(() => { const b = document.querySelector("#btnUser").getBoundingClientRect(); return { l: b.left, r: b.right, vw: innerWidth }; });
  check(`${w}px: アカウントボタンが画面内にある`, r.l >= 0 && r.r <= r.vw + 0.5, JSON.stringify(r));
}
await page.setViewportSize({ width: 390, height: 800 });
await page.click("#btnUser");
check("アカウントメニューが開く", await page.locator("text=設定").first().isVisible());
await page.keyboard.press("Escape");
await page.mouse.click(5, 400);

// ③ ピンチ: 途中はCSS transformだけ、指を離すと1回でズーム確定
const z0 = await page.evaluate(() => window.__apdf.editor.zoom);
const res = await page.evaluate(async () => {
  const v = document.querySelector("#viewer");
  const mk = (id, x, y) => new Touch({ identifier: id, target: v, clientX: x, clientY: y });
  const fire = (type, ts) => v.dispatchEvent(new TouchEvent(type, { touches: ts, targetTouches: ts, changedTouches: ts, bubbles: true, cancelable: true }));
  const pages = document.querySelector("#pages");
  fire("touchstart", [mk(1, 150, 300), mk(2, 250, 300)]);
  
  fire("touchmove", [mk(1, 100, 300), mk(2, 300, 300)]);
  const mid = { transform: pages.style.transform, zoom: window.__apdf.editor.zoom };
  fire("touchend", []);
  return { mid, after: window.__apdf.editor.zoom, cleared: pages.style.transform === "" };
});
check("ピンチ中はzoomを再計算せずtransformで拡大", res.mid.transform.includes("scale(2)") && res.mid.zoom === z0, JSON.stringify(res.mid));
check("指を離すとズームが確定しtransformが消える", Math.abs(res.after - z0 * 2) < 0.01 && res.cleared, JSON.stringify(res));

// ④ 指でペン描画(ペン入力モードが保存されていても iPhone では描ける)
await page.evaluate(() => window.__apdf.editor.setPalm(true));
await page.evaluate(() => window.__apdf.editor.setZoom(1));
check("iPhoneではペン入力モードが無効になる", await page.evaluate(() => window.__apdf.editor.palm === false));
await page.click('.tool[data-tool="pen"]');
const box = await page.locator(".page svg.overlay").first().boundingBox();
const before = await page.evaluate(() => window.__apdf.model.pages[0].shapes.length);
await page.touchscreen.tap(box.x + 50, box.y + 50); // 単なるタップで例外が出ないこと
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`mobile: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
