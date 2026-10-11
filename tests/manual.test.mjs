import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { PDFDocument } = require("pdf-lib");

test("manual.pdf が最新の manual.html から作られている(古ければ node scripts/make-manual-pdf.mjs を実行)", async () => {
  const hash = createHash("sha256").update(readFileSync("manual.html")).digest("hex");
  const pdf = await PDFDocument.load(readFileSync("manual.pdf"), { updateMetadata: false });
  assert.match(pdf.getKeywords() || "", new RegExp(`manual-sha256:${hash}`));
});
test("sw.js が manual.pdf を事前キャッシュする(オフラインでもダウンロードできる)", () => {
  assert.ok(readFileSync("sw.js", "utf8").includes('"manual.pdf"'));
});
