// スモークテスト: 起動 → 登録 → PDFを開く、までのエラー確認
import { createRequire } from "node:module";
import { startServer } from "../scripts/serve.mjs";
const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { chromium } = require("playwright");

const { server, port } = await startServer();
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector("#auth:not([hidden])");
await page.fill("#authId", "tester01");
await page.fill("#authPw", "password-1234");
await page.fill("#authPw2", "password-1234");
await page.click("#authSubmit");
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
await page.setInputFiles("#fileOpen", "tests/fixtures/sample.pdf");
await page.waitForSelector(".page canvas", { timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll('.page[data-rendered="1"]').length >= 1, null, { timeout: 15000 });
await page.screenshot({ path: `${process.env.SHOT_DIR || "/tmp"}/shot-smoke.png` });
console.log("pages:", await page.locator(".page").count());
console.log("errors:", errors.length ? "\n" + errors.join("\n") : "none");
await browser.close();
server.close();
