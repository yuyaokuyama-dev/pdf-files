// manual.html から manual.pdf(アプリの「マニュアルをダウンロード」で配る版)を作る。
// manual.html を直したら必ず実行する。tests/manual.test.mjs が、PDFが最新の manual.html から作られたかを確認する。
//   node scripts/make-manual-pdf.mjs
// 必要: playwright と pdf-lib(TOOLS_DIR 以下。CI と同じ)。ブラウザの場所を指定するときは PW_CHROMIUM=/path/to/chrome
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { chromium } = require("playwright");
const { PDFDocument } = require("pdf-lib");

const root = fileURLToPath(new URL("..", import.meta.url));
export const manualHash = (html) => createHash("sha256").update(html).digest("hex");
const html = readFileSync(root + "manual.html");

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ colorScheme: "light" });
await page.goto(pathToFileURL(root + "manual.html").href);
await page.emulateMedia({ media: "print", colorScheme: "light" });
await page.evaluate(() => document.fonts.ready);
const raw = await page.pdf({
  format: "A4",
  printBackground: true,
  margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate: '<div style="width:100%;text-align:center;font-size:8px;color:#888"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();

const doc = await PDFDocument.load(raw);
const ver = String(html).match(/対象バージョン (v[\d.]+)/)?.[1] || "";
doc.setTitle(`PDF Files 使い方マニュアル ${ver}`.trim());
doc.setAuthor("PDF Files");
doc.setCreator("scripts/make-manual-pdf.mjs");
doc.setKeywords([`manual-sha256:${manualHash(html)}`]);
writeFileSync(root + "manual.pdf", await doc.save());
console.log(`manual.pdf ok (${doc.getPageCount()} pages)`);
