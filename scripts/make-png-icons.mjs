// icons/*.svg → PNG (Playwright の Chromium で描画)
//   node scripts/make-png-icons.mjs   (NODE_PATH に playwright がある環境で実行)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { chromium } = require("playwright");

const jobs = [
  ["icons/app-icon.svg", "icons/apple-touch-icon.png", 180],
  ["icons/app-icon.svg", "icons/icon-192.png", 192],
  ["icons/app-icon.svg", "icons/icon-512.png", 512],
  ["icons/app-icon-maskable.svg", "icons/icon-maskable-512.png", 512],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, dst, size] of jobs) {
  const svg = readFileSync(src, "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:#e8eaed}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  writeFileSync(dst, await page.screenshot({ type: "png" }));
  console.log("wrote", dst);
}
await browser.close();
