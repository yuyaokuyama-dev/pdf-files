// E2E: クリップボードの画像(Print Screen など)を Ctrl+V で貼り付け
import { launch, register, openPdf, setZoom1, toScreen, tool, shapes, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "paste01");

/** 画面に paste イベントを送る(w×h ピクセルの PNG を持たせる。image=false ならテキストだけ) */
const paste = (w, h, { image = true, target = "body" } = {}) =>
  page.evaluate(async ([w, h, image, target]) => {
    const dt = new DataTransfer();
    if (image) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d");
      g.fillStyle = "#c00";
      g.fillRect(0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    } else dt.setData("text/plain", "hello");
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    document.querySelector(target).dispatchEvent(ev);
    return ev.defaultPrevented;
  }, [w, h, image, target]);
const waitShapes = (n) => page.waitForFunction((n) => (window.__apdf.model.pages[0]?.shapes.length || 0) >= n, n, { timeout: 5000 }).then(() => true, () => false);

// 書類を開いていないときは、貼った画像から新しい書類を作る
await paste(800, 600);
await page.waitForFunction(() => window.__apdf.model?.pages.length > 0, null, { timeout: 10000 });
let sh = await shapes(page);
check("書類がないときは画像から新規書類を作る", sh.length === 1 && sh[0].type === "image", JSON.stringify(sh.map((s) => s.type)));

// PDFを開いてから貼り付け(マウスがページ外 → 表示中のページ中央)
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
await tool(page, "select");
const pg = await page.evaluate(() => ({ w: window.__apdf.model.pages[0].w, h: window.__apdf.model.pages[0].h }));
await page.mouse.move(5, 5);
check("画像の paste は既定動作を止める", await paste(200, 100));
check("貼り付けると画像が1つ増える", await waitShapes(1));
sh = (await shapes(page)).at(-1);
let w = sh.pts[1][0] - sh.pts[0][0];
let h = sh.pts[1][1] - sh.pts[0][1];
check("小さい画像は等倍(1px=0.75pt)", Math.abs(w - 150) < 1 && Math.abs(h - 75) < 1, `${w}x${h}`);
check("マウスがページ外ならページ中央", Math.abs((sh.pts[0][0] + sh.pts[1][0]) / 2 - pg.w / 2) < 1 && Math.abs((sh.pts[0][1] + sh.pts[1][1]) / 2 - pg.h / 2) < 1);
check("貼った画像が選択される(すぐ動かせる)", await page.evaluate(() => !!window.__apdf.editor.sel));

// 大きい画像(全画面のスクリーンショット)はページの8割に収める
await paste(1920, 1080);
check("大きい画像も貼れる", await waitShapes(2));
sh = (await shapes(page)).at(-1);
w = sh.pts[1][0] - sh.pts[0][0];
h = sh.pts[1][1] - sh.pts[0][1];
check("大きい画像はページの8割以内", w <= pg.w * 0.8 + 0.5 && h <= pg.h * 0.8 + 0.5, `${w}x${h} / ${pg.w}x${pg.h}`);
check("縦横比を保つ", Math.abs(w / h - 1920 / 1080) < 0.01);

// マウス位置に貼る
const [sx, sy] = await toScreen(page, 0, 200, 250);
await page.mouse.move(sx, sy);
await paste(100, 100);
check("マウス位置にも貼れる", await waitShapes(3));
sh = (await shapes(page)).at(-1);
check("マウス位置を中心に置く", Math.abs((sh.pts[0][0] + sh.pts[1][0]) / 2 - 200) < 2 && Math.abs((sh.pts[0][1] + sh.pts[1][1]) / 2 - 250) < 2, JSON.stringify(sh.pts));

// ページ端ではみ出さない
const [ex, ey] = await toScreen(page, 0, 3, 3);
await page.mouse.move(ex, ey);
await paste(100, 100);
check("端でも貼れる", await waitShapes(4));
sh = (await shapes(page)).at(-1);
check("ページからはみ出さない", sh.pts[0][0] >= -0.01 && sh.pts[0][1] >= -0.01, JSON.stringify(sh.pts));

// 元に戻す
await page.keyboard.press("Escape");
await page.keyboard.press("Control+z");
check("元に戻せる", (await shapes(page)).length === 3);

// テキストだけの paste や入力欄への paste は邪魔しない
check("テキストの paste はそのまま", !(await paste(0, 0, { image: false })));
check("テキストでは画像が増えない", (await shapes(page)).length === 3);

// 本物のクリップボード: Ctrl+V とメニューからの貼り付け
await env.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: env.base.replace(/\/$/, "") });
const putClipboard = () => page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 120;
  c.height = 80;
  c.getContext("2d").fillRect(0, 0, 120, 80);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
});
await putClipboard();
await page.mouse.move(5, 5);
await page.keyboard.press("Control+v");
check("Ctrl+V でクリップボードの画像を貼れる", await waitShapes(4));
await putClipboard();
await page.evaluate(() => window.__apdf.editor.setSelection(null));
await tool(page, "camera");
await page.getByRole("button", { name: /クリップボードの画像を貼り付け/ }).click();
check("メニューの「クリップボードの画像を貼り付け」でも貼れる", await waitShapes(5));

check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
