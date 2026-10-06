// E2E ⑨: インストール済みアプリで PDF を開く(File Handling API の launchQueue)
import { readFileSync } from "node:fs";
import { launch, register, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors, ctx } = env;
const pdf = readFileSync("tests/fixtures/sample.pdf");
// 起動時にファイルが渡された状況を再現(ログイン前に届く → ログイン後に開く)
await page.addInitScript((arr) => {
  Object.defineProperty(window, "launchQueue", { configurable: true, value: { setConsumer: (fn) => (window.__lq = fn) } });
  window.__fire = () => window.__lq({ files: [{ getFile: async () => new File([new Uint8Array(arr)], "from-explorer.pdf", { type: "application/pdf" }) }] });
}, Array.from(pdf));
await page.goto(env.base);
await page.waitForSelector("#auth:not([hidden])");
await page.waitForFunction(() => typeof window.__lq === "function");
await page.evaluate(() => window.__fire());
await register(page, "launch01");
await page.waitForFunction(() => window.__apdf.model?.pages.length > 0 && window.__apdf.model.meta.name === "from-explorer.pdf", null, { timeout: 20000 });
check("ログイン前に渡されたPDFが、ログイン後に開く", true);
// ログイン済みの状態で、別のPDFを開いた場合も開く
await page.evaluate(async () => {
  const buf = await (await fetch("/tests/fixtures/rotated.pdf")).arrayBuffer();
  window.__lq({ files: [{ getFile: async () => new File([buf], "second.pdf", { type: "application/pdf" }) }] });
});
await page.waitForFunction(() => window.__apdf.model.meta.name === "second.pdf", null, { timeout: 20000 });
check("起動済みでも、新しく渡されたPDFが開く", true);
const m = JSON.parse(readFileSync("manifest.webmanifest", "utf8"));
check("マニフェストに PDF のファイルハンドラがある", m.file_handlers?.[0]?.accept?.["application/pdf"]?.includes(".pdf"));
check("2回目以降は既存のウィンドウで開く設定", m.launch_handler?.client_mode?.[0] === "focus-existing");
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
