import { createRequire } from "node:module";
import { startServer } from "../scripts/serve.mjs";
const require = createRequire("/opt/npm-tools/node_modules/");
export const { chromium, devices } = require("playwright");

export async function launch({ mobile = false } = {}) {
  const { server, port } = await startServer();
  const browser = await chromium.launch();
  const ctx = await browser.newContext(
    mobile
      ? { ...devices["iPhone 13"], acceptDownloads: true }
      : { viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ["notifications"] },
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(`[console.error] ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
  const base = `http://127.0.0.1:${port}/`;
  return { server, browser, ctx, page, errors, base, close: async () => { await browser.close(); server.close(); } };
}

export async function register(page, id = "tester01", pw = "password-1234") {
  await page.waitForSelector("#auth:not([hidden])");
  const reg = await page.locator("#authPw2Row").isHidden();
  if (reg) await page.click("#tabRegister");
  await page.fill("#authId", id);
  await page.fill("#authPw", pw);
  await page.fill("#authPw2", pw);
  await page.click("#authSubmit");
  await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
}

export async function openPdf(page, file) {
  await page.setInputFiles("#fileOpen", file);
  await page.waitForFunction(() => window.__apdf.model?.pages.length > 0 && document.querySelectorAll('.page[data-rendered="1"]').length >= 1, null, { timeout: 20000 });
}

/** ページ座標(pt) → 画面座標。zoom=1 に固定して使う */
export async function setZoom1(page) {
  await page.evaluate(() => window.__apdf.editor.setZoom(1));
  await page.waitForTimeout(250);
}
export async function toScreen(page, pageIndex, x, y) {
  return page.evaluate(([i, x, y]) => {
    const S = window.__apdf;
    const el = S.editor.els.get(S.model.pages[i].id);
    const v = S.editor.viewer;
    const calc = () => {
      const r = el.svg.getBoundingClientRect();
      return [r.left + x * S.editor.zoom, r.top + y * S.editor.zoom];
    };
    let [sx, sy] = calc();
    const vr = v.getBoundingClientRect();
    if (sy < vr.top + 40 || sy > vr.bottom - 40) {
      v.scrollTop += sy - (vr.top + vr.height * 0.5); // 対象点が画面中央付近に来るようにスクロール
      [sx, sy] = calc();
    }
    return [sx, sy];
  }, [pageIndex, x, y]);
}
export async function drag(page, pi, a, b, { steps = 12 } = {}) {
  const [x0, y0] = await toScreen(page, pi, a[0], a[1]);
  const [x1, y1] = await toScreen(page, pi, b[0], b[1]);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps });
  await page.mouse.up();
}
export async function click(page, pi, p, opts = {}) {
  const [x, y] = await toScreen(page, pi, p[0], p[1]);
  await page.mouse.click(x, y, opts);
}
export const tool = (page, id) => page.click(`.tool[data-tool="${id}"]`);
export const shapes = (page, pi = 0) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__apdf.model.pages[i].shapes)), pi);

let pass = 0, fail = 0;
export const results = [];
export function check(name, cond, detail = "") {
  if (cond) { pass++; results.push(`  PASS  ${name}`); }
  else { fail++; results.push(`  FAIL  ${name} ${detail}`); }
  console.log(results[results.length - 1]);
}
export const summary = () => ({ pass, fail });
