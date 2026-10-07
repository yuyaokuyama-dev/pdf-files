// E2E: アプリ内のドライブ一覧(iPhone/iPad向け。Googleの選択画面を使わない)
import { readFileSync } from "node:fs";
import { launch, register, check, summary } from "./e2e-lib.mjs";

const env = await launch({ mobile: true }); // iPhone相当(UAにiPhone)→ 自動でアプリ内の一覧になる
const { page, ctx, errors } = env;
const pdf = readFileSync("tests/fixtures/sample.pdf");
const calls = { upload: [], scopes: [] };

await page.addInitScript(() => localStorage.setItem("apdf_google_cfg_v1", JSON.stringify({ clientId: "test-client", apiKey: "k" })));
await ctx.route("https://accounts.google.com/gsi/client", (r) =>
  r.fulfill({ contentType: "text/javascript", body: `window.__scopes=[];window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>{window.__scopes.push(c.scope);setTimeout(()=>c.callback({access_token:'tok',expires_in:3600}),10)}}),revoke:(t,cb)=>cb&&cb()}}};` }),
);
// Pickerのスクリプトは読まれないはず(読まれたらテスト失敗)
let pickerLoaded = false;
await ctx.route("https://apis.google.com/**", (r) => { pickerLoaded = true; r.fulfill({ contentType: "text/javascript", body: "" }); });
const json = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
await ctx.route("https://www.googleapis.com/drive/v3/drives**", (r) => json(r, { drives: [{ id: "sd1", name: "設計部(共有)" }] }));
await ctx.route("https://www.googleapis.com/drive/v3/files?**", (r) => {
  const q = decodeURIComponent(new URL(r.request().url()).searchParams.get("q") || "");
  if (q.includes("'root' in parents")) return json(r, { files: [{ id: "F1", name: "現場A", mimeType: "application/vnd.google-apps.folder" }, { id: "P1", name: "ルート.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-01T00:00:00Z" }] });
  if (q.includes("'F1' in parents")) return json(r, { files: [{ id: "P2", name: "現場図面.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-02T00:00:00Z" }] });
  if (q.includes("'sd1' in parents")) return json(r, { files: [{ id: "P3", name: "共有図面.pdf", mimeType: "application/pdf" }] });
  if (q.includes("name contains '図面'")) return json(r, { files: [{ id: "P2", name: "現場図面.pdf", mimeType: "application/pdf" }] });
  json(r, { files: [] });
});
await ctx.route("https://www.googleapis.com/drive/v3/files/P*", (r) => {
  const u = new URL(r.request().url());
  if (u.searchParams.get("alt") === "media") return r.fulfill({ contentType: "application/pdf", body: pdf });
  json(r, { id: u.pathname.split("/").pop(), name: "現場図面.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-02T00:00:00Z", parents: ["F1"] });
});
await ctx.route("https://www.googleapis.com/upload/drive/v3/files**", (r) => {
  const body = r.request().postData() || "";
  calls.upload.push(body.includes('"parents"'));
  if (body.includes('"parents"')) return r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { message: "File not found" } }) });
  json(r, { id: "new1", name: "x.pdf", modifiedTime: new Date().toISOString() });
});

await page.goto(env.base);
await register(page, "drive01");
check("iPhoneでは自動でアプリ内の一覧を使う", await page.evaluate(async () => (await import("/js/google.js")).useOwnPicker()));

await page.click("#btnFile");
await page.locator("#menu button", { hasText: "Googleドライブから開く" }).click();
await page.waitForSelector("dialog[open] #dbList .item");
const names = await page.locator("dialog[open] #dbList .name").allTextContents();
check("マイドライブ直下のフォルダとPDFが並ぶ", names.join() === "現場A,ルート.pdf", names.join());
const sc = await page.evaluate(() => window.__scopes.at(-1));
check("閲覧用の権限(drive.readonly)を求める", sc.includes("drive.readonly") && sc.includes("drive.file"), sc);
await page.locator('dialog[open] .item[data-k="d"]').click();
await page.waitForSelector('dialog[open] .item[data-id="P2"]');
check("フォルダの中に入れる", true);
await page.locator('dialog[open] [data-p="0"]').click();
await page.waitForSelector('dialog[open] .item[data-id="P1"]');
check("パンくずで戻れる", true);
await page.fill("#dbQ", "図面");
await page.click("#dbGo");
await page.waitForSelector('dialog[open] .item[data-id="P2"]');
check("名前で検索できる", (await page.locator("dialog[open] #dbList .item").count()) === 1);
await page.locator("dialog[open] [data-v=shared]").click();
await page.waitForSelector('dialog[open] .item[data-id="sd1"]');
await page.locator('dialog[open] .item[data-id="sd1"]').click();
await page.waitForSelector('dialog[open] .item[data-id="P3"]');
check("共有ドライブの中身も見える", true);
await page.locator("dialog[open] [data-v=drive]").click();
await page.waitForSelector('dialog[open] .item[data-id="F1"]');
await page.locator('dialog[open] .item[data-id="F1"]').click();
await page.waitForSelector('dialog[open] .item[data-id="P2"]');
await page.locator('dialog[open] .item[data-id="P2"]').click();
await page.waitForFunction(() => window.__apdf.model.pages.length > 0 && window.__apdf.model.meta.driveId === "P2", null, { timeout: 20000 });
check("選んだPDFが開く", true);
check("保存先の既定は開いたフォルダ", (await page.evaluate(() => window.__apdf.model.meta.driveFolder)) === "F1");

// フォルダ選択(保存先)
const picked = page.evaluate(async () => (await import("/js/drivebrowse.js")).browseDrive({ mode: "folder" }));
await page.waitForSelector("dialog[open] #dbPickHere");
await page.locator('dialog[open] .item[data-id="F1"]').click();
await page.waitForSelector('dialog[open] [data-p="1"]');
await page.click("#dbPickHere");
const f = await picked;
check("フォルダを選べる(いま開いているフォルダが返る)", f?.id === "F1" && f.name === "現場A", JSON.stringify(f));

// 権限外のフォルダに保存→マイドライブ直下へ切り替わる
const up = await page.evaluate(async () => (await import("/js/google.js")).uploadPdf({ name: "t.pdf", bytes: new Uint8Array([1, 2, 3]), folderId: "F1" }));
check("選んだフォルダに作れないときはマイドライブ直下に保存", up.fellBack === true && calls.upload.join() === "true,false", JSON.stringify(calls.upload));
check("Googleの選択画面(Picker)は読み込まれない", !pickerLoaded);
check("コンソールエラーなし", errors.filter((e) => !/404/.test(e)).length === 0, errors.join("\n"));
await env.close();
const s = summary();
console.log(`drive: ${s.pass} pass / ${s.fail} fail`);
process.exit(s.fail ? 1 : 0);
