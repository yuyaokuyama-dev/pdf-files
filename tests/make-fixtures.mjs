// テスト用PDFを生成(3ページ・図面風)。 node tests/make-fixtures.mjs
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire((process.env.TOOLS_DIR || "/opt/npm-tools") + "/node_modules/");
const { PDFDocument, StandardFonts, rgb, degrees } = require("pdf-lib");

const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 3; i++) {
  const p = doc.addPage([595.28, 841.89]);
  p.drawText(`Sample page ${i}`, { x: 60, y: 780, size: 28, font, color: rgb(0.1, 0.1, 0.2) });
  p.drawRectangle({ x: 100, y: 300, width: 400, height: 300, borderColor: rgb(0, 0, 0), borderWidth: 2 });
  p.drawLine({ start: { x: 100, y: 250 }, end: { x: 500, y: 250 }, thickness: 1, color: rgb(0, 0, 0) });
  p.drawText("400 pt wide box (known width)", { x: 110, y: 620, size: 12, font });
}
writeFileSync("tests/fixtures/sample.pdf", await doc.save());

// 回転ページ(90度)のPDF
const rot = await PDFDocument.create();
const f2 = await rot.embedFont(StandardFonts.Helvetica);
const rp = rot.addPage([400, 600]);
rp.drawText("ROTATED 90", { x: 40, y: 540, size: 30, font: f2 });
rp.drawRectangle({ x: 40, y: 100, width: 200, height: 100, borderColor: rgb(0, 0, 1), borderWidth: 3 });
rp.setRotation(degrees(90));
writeFileSync("tests/fixtures/rotated.pdf", await rot.save());
console.log("fixtures ok");
