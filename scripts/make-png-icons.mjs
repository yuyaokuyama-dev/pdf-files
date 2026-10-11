// icons/*.svg → PNG (Playwright の Chromium で描画)
//   node scripts/make-png-icons.mjs   (NODE_PATH に playwright がある環境で実行)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { chromium } = require("playwright");

// ファイル名を変えるとインストール済みアプリ(Windows/Android)やブラウザのキャッシュに古い画像が残りにくい
const jobs = [
  ["icons/app-icon.svg", "icons/pdf-favicon-32.png", 32],
  ["icons/app-icon-ios.svg", "icons/apple-touch-icon.png", 180], // iPhone のホーム画面は従来の「PDF Files」デザイン
  ["icons/app-icon.svg", "icons/pdf-icon-192.png", 192],
  ["icons/app-icon.svg", "icons/pdf-icon-256.png", 256],
  ["icons/app-icon.svg", "icons/pdf-icon-512.png", 512],
  ["icons/app-icon-maskable.svg", "icons/pdf-icon-maskable-512.png", 512],
  ["icons/app-icon.svg", "icons/icon-192.png", 192], // アプリ内の既定サムネイル・通知用
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [src, dst, size] of jobs) {
  const svg = readFileSync(src, "utf8");
  await page.setViewportSize({ width: size, height: size });
  const bg = svg.match(/<rect[^>]*fill="([^"]+)"/)[1];
  await page.setContent(
    `<style>html,body{margin:0;background:${bg}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
  );
  writeFileSync(dst, await page.screenshot({ type: "png" }));
  console.log("wrote", dst);
}
await browser.close();
