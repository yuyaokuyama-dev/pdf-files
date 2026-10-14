// E2E: 保存・出力 → DXFで書き出す(ダウンロードしたDXFの中身を確認)
import { launch, register, openPdf, setZoom1, shapes, check, summary } from "./e2e-lib.mjs";
import fs from "node:fs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "dxf01");
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
const ed = (fn, arg) => page.evaluate(fn, arg);

await ed(() => {
  const m = window.__apdf.model;
  const id = m.pages[0].id;
  m.addShape(id, { type: "rect", pts: [[100, 100], [300, 200]], style: { color: "#e11d48", width: 2, fill: "none" } });
  m.addShape(id, { type: "ellipse", pts: [[350, 100], [450, 200]], style: { color: "#2563eb", width: 1, fill: "none" } });
  m.addShape(id, { type: "text", pts: [[100, 300]], text: "図面 A-1", size: 16, style: { color: "#111827" } });
  m.addShape(id, { type: "dim", pts: [[100, 250], [300, 250]], off: 24, size: 12, text: "200", endStyle: "arrow", endSize: 6, style: { color: "#e11d48", width: 1 } });
});

await page.click("#btnSave, button:has-text('保存・出力')");
await page.locator("#menu button", { hasText: "DXFで書き出す" }).click();
await page.waitForSelector("dialog[open] #dxPage");
const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("dialog[open] .btn.primary").click()]);
const name = dl.suggestedFilename();
const text = fs.readFileSync(await dl.path(), "utf8");
check("ファイル名は .dxf", /\.dxf$/.test(name) && name.includes("-1"), name);
check("AutoCAD 2007形式のヘッダ", text.includes("AC1021") && text.trimEnd().endsWith("EOF"));
check("四角(ポリライン)・円・文字・寸法が入る", /LWPOLYLINE/.test(text) && /\nCIRCLE\n/.test(text) && text.includes("図面 A-1") && text.includes("\n200\n") && /\nSOLID\n/.test(text));
check("完了のお知らせが出る", await page.locator("#toast, .toast").first().textContent().then((t) => t.includes("書き出しました")).catch(() => false));

check("コンソールエラーなし", errors.length === 0, errors.join("|"));
await env.close();
summary();
