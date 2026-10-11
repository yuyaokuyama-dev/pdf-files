// E2E: ユーザーメニュー「設定」の下の「マニュアルをダウンロード(PDF)」で manual.pdf が保存される
import { readFileSync } from "node:fs";
import { launch, register, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, errors } = env;
await page.goto(env.base);
await register(page, "manual01");
await page.click("#btnUser");
const labels = await page.locator("#menu button").allInnerTexts();
const iSet = labels.findIndex((t) => t.includes("設定"));
check("「設定」のすぐ下に「マニュアルをダウンロード(PDF)」がある", iSet >= 0 && labels[iSet + 1]?.includes("マニュアルをダウンロード"), labels.join(" / "));
const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("#menu button", { hasText: "マニュアルをダウンロード" }).click()]);
const { APP_VERSION } = await import("../js/version.js");
check("ファイル名にバージョンが入る", dl.suggestedFilename() === `PDF Files manual ${APP_VERSION}.pdf`, dl.suggestedFilename());
const head = readFileSync(await dl.path()).subarray(0, 5);
check("中身がPDF", String(head) === "%PDF-", String(head));
check("コンソールエラーなし", errors.length === 0, errors.join("\n"));
await env.close();
summary();
