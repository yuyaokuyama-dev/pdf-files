// E2E ③: オフライン・保存待ち→オンライン復帰・Drive/Gmail連携(モック)・認証・スマホ(タッチ)
import { launch, register, openPdf, setZoom1, drag, tool, shapes, toScreen, check, summary } from "./e2e-lib.mjs";

const env = await launch();
const { page, ctx, errors } = env;

/* ---- Google 通信のモック ---- */
const calls = { upload: [], gmail: [], list: 0, download: 0 };
await ctx.route("https://accounts.google.com/gsi/client", (r) =>
  r.fulfill({ contentType: "text/javascript", body: `window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>setTimeout(()=>c.callback({access_token:'tok',expires_in:3600}),10)}),revoke:(t,cb)=>cb&&cb()}}};` }),
);
await ctx.route("https://www.googleapis.com/upload/drive/v3/files**", async (r) => {
  const req = r.request();
  calls.upload.push({ method: req.method(), url: req.url(), auth: req.headers()["authorization"], size: req.postDataBuffer()?.length || 0, body: req.postDataBuffer() });
  r.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "drive-file-1", name: "x.pdf", modifiedTime: new Date().toISOString() }) });
});
await ctx.route("https://www.googleapis.com/drive/v3/files?**", (r) => { calls.list++; r.fulfill({ contentType: "application/json", body: JSON.stringify({ files: [{ id: "d9", name: "図面A.pdf", modifiedTime: "2026-10-01T00:00:00Z", size: "1234" }] }) }); });
await ctx.route("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", (r) => { calls.gmail.push(JSON.parse(r.request().postData())); r.fulfill({ contentType: "application/json", body: JSON.stringify({ id: "m1" }) }); });

await page.goto(env.base);

/* ---------- 認証(⑱) ---------- */
await page.waitForSelector("#auth:not([hidden])");
check("初回は新規登録画面が出る", await page.locator("#authPw2Row").isVisible());
await page.fill("#authId", "ab"); await page.fill("#authPw", "password-1234"); await page.fill("#authPw2", "password-1234");
await page.click("#authSubmit");
check("短すぎるIDは拒否される", /IDは/.test(await page.textContent("#authMsg")));
await page.fill("#authId", "user_a"); await page.fill("#authPw2", "different-pass");
await page.click("#authSubmit");
check("確認用パスワードの不一致を検出", /一致しません/.test(await page.textContent("#authMsg")));
await page.fill("#authPw2", "password-1234");
await page.click("#authSubmit");
await page.waitForSelector("#app:not([hidden])");
check("登録→そのままログインできる", true);
await page.reload();
await page.waitForSelector("#app:not([hidden])");
check("ログイン状態が保持される", true);
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "ログアウト" }).click();
await page.waitForSelector("#auth:not([hidden])");
await page.click("#tabLogin");
await page.fill("#authId", "user_a"); await page.fill("#authPw", "bad-password-1");
await page.click("#authSubmit");
await page.waitForFunction(() => document.querySelector("#authMsg")?.textContent.trim().length > 0);
check("誤ったパスワードではログインできない", /違います/.test(await page.textContent("#authMsg")));
await page.fill("#authPw", "password-1234");
await page.click("#authSubmit");
await page.waitForSelector("#app:not([hidden])");
check("正しいID・パスワードでログイン", true);

/* ---------- Google設定(クライアントID) ---------- */
await page.evaluate(() => localStorage.setItem("apdf_google_cfg_v1", JSON.stringify({ clientId: "test.apps.googleusercontent.com", apiKey: "k", appId: "" })));

/* ---------- ファイルを開く → オフライン化 ---------- */
await openPdf(page, "tests/fixtures/sample.pdf");
await setZoom1(page);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith("apdf-core")), null, { timeout: 15000 });
const cached = await page.evaluate(async () => (await (await caches.open((await caches.keys()).find((k) => k.startsWith("apdf-core")))).keys()).length);
check("アプリ本体がキャッシュされた(オフライン用)", cached >= 20, `cached=${cached}`);
await page.waitForTimeout(1500); // 自動保存
await ctx.setOffline(true);
await page.reload();
await page.waitForFunction(() => window.__apdf?.model?.pages?.length === 3, null, { timeout: 20000 });
check("オフラインで再起動してもアプリが開き、作業中のPDFが復元される", true);
check("オフライン表示が出る", await page.locator("#netBadge").isVisible());
await page.waitForFunction(() => document.querySelectorAll('.page[data-rendered="1"]').length >= 1, null, { timeout: 15000 });
await setZoom1(page);

/* ---------- オフラインで全機能(描画・寸法・計測・署名・ページ操作・書き出し) ---------- */
await tool(page, "rect");
await drag(page, 0, [100, 100], [300, 200]);
await tool(page, "pen");
await drag(page, 0, [320, 100], [450, 180]);
await tool(page, "dim");
await drag(page, 0, [100, 300], [400, 300]);
await page.waitForSelector("dialog[open] #pdIn");
await page.fill("#pdIn", "1200"); await page.keyboard.press("Enter");
await tool(page, "calib");
await drag(page, 0, [100, 400], [300, 400]);
await page.waitForSelector("dialog[open] #clVal");
await page.fill("#clVal", "2000"); await page.click("dialog[open] .foot .btn.primary");
await drag(page, 0, [100, 450], [200, 450]);
const offShapes = await shapes(page);
check("オフラインで描画・寸法・縮尺・計測が使える", ["rect", "pen", "dim", "measure"].every((t) => offShapes.some((s) => s.type === t)), offShapes.map((s) => s.type).join(","));
const exp = await page.evaluate(async () => (await window.__apdf.exportPdf(window.__apdf.model, { level: "small" })).bytes.length);
check("オフラインでもPDF書き出しができる", exp > 1000, `bytes=${exp}`);

/* ---------- オフラインで保存/メール → 待ちキュー(⑰) ---------- */
await page.click("#btnSave");
await page.locator("#menu button", { hasText: "Googleドライブに保存" }).click();
await page.waitForSelector("dialog[open] #exName");
await page.click("dialog[open] .foot .btn.primary");
await page.waitForFunction(() => document.querySelector("#queueBadge") && !document.querySelector("#queueBadge").hidden, null, { timeout: 15000 });
check("オフライン中のDrive保存は『保存待ち』に入る", /1件/.test(await page.textContent("#queueBadge")));
await page.click("#btnSave");
await page.locator("#menu button", { hasText: "Gmailでメール送信" }).click();
await page.waitForSelector("dialog[open] #mlTo");
await page.fill("#mlTo", "boss@example.com");
await page.fill("#mlSub", "図面送付");
await page.click("dialog[open] .foot .btn.primary");
await page.waitForFunction(() => /2件/.test(document.querySelector("#queueBadge")?.textContent || ""), null, { timeout: 15000 });
check("オフライン中のメール送信は『送信待ち』に入る", true);
check("オフライン中はGoogleへ通信していない", calls.upload.length === 0 && calls.gmail.length === 0);

/* ---------- オンライン復帰 → 提案バナー → 実行 ---------- */
await ctx.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
await page.waitForSelector("#banner:not([hidden])", { timeout: 8000 });
check("オンライン復帰時に実行を提案するバナーが出る", /2件/.test(await page.textContent("#banner")));
await page.locator("#banner button", { hasText: "今すぐ実行" }).click();
await page.waitForFunction(() => document.querySelector("#queueBadge")?.hidden === true, null, { timeout: 20000 });
check("待ち作業が実行され、キューが空になる", true);
check("共有ドライブにも保存できる(supportsAllDrives=true)", calls.upload.every((c) => /supportsAllDrives=true/.test(c.url)), JSON.stringify(calls.upload.map((c) => c.url.slice(0, 120))));
check("Driveへアップロードされた(Bearer認証・PDF本体付き)", calls.upload.length === 1 && calls.upload[0].auth === "Bearer tok" && calls.upload[0].size > 1000, JSON.stringify(calls.upload.map((c) => [c.method, c.auth, c.size])));
const upBody = calls.upload[0].body.toString("latin1");
check("アップロード本体が%PDFで始まるPDF", /%PDF-1\./.test(upBody) && /"name":"sample\.pdf"/.test(upBody));
check("Gmail送信APIが呼ばれた", calls.gmail.length === 1);
{
  const raw = Buffer.from(calls.gmail[0].raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
  check("メールの宛先・添付PDFが正しい", /To: boss@example\.com/.test(raw) && /Content-Disposition: attachment; filename="sample\.pdf"/.test(raw) && /Content-Type: application\/pdf/.test(raw));
  const subj = raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)?.[1];
  check("件名(日本語)がエンコードされている", Buffer.from(subj || "", "base64").toString("utf8") === "図面送付");
}
const driveId = await page.evaluate(() => window.__apdf.model.meta.driveId);
check("保存後はDriveのファイルIDが記録される(次回は上書き保存)", driveId === "drive-file-1", String(driveId));

/* ---------- オンラインのDrive保存(上書き)・履歴(Drive) ---------- */
await page.click("#btnSave");
await page.locator("#menu button", { hasText: "Googleドライブに保存" }).click();
await page.waitForSelector("dialog[open] #exName");
check("既存ファイルは上書き/別名を選べる", (await page.locator('input[name="exMode"]').count()) === 2);
check("保存先フォルダの選択欄がある(既定はマイドライブ)", (await page.textContent("dialog[open] #dfName")) === "マイドライブ" && (await page.locator("dialog[open] #dfPick").count()) === 1);
await page.click("dialog[open] .foot .btn.primary");
await page.waitForFunction(() => document.querySelector("#toast") && /Googleドライブに保存しました/.test(document.querySelector("#toast").textContent), null, { timeout: 15000 });
check("オンラインならその場でDriveへ上書き保存(PATCH)", calls.upload.length === 2 && calls.upload[1].method === "PATCH" && /files\/drive-file-1/.test(calls.upload[1].url), JSON.stringify(calls.upload.map((c) => [c.method, c.url.slice(0, 90)])));
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "履歴" }).click();
await page.waitForSelector('dialog[open] [data-tab="drive"]');
await page.click('dialog[open] [data-tab="drive"]');
await page.waitForSelector("dialog[open] #hLoad", { state: "visible" });
await page.click("#hLoad");
await page.waitForSelector("#hDrive [data-drive]");
check("履歴(Googleドライブ)の一覧が表示される", (await page.textContent("#hDrive")).includes("図面A.pdf") && calls.list === 1);
await page.keyboard.press("Escape");

/* ---------- スマホ画面・タッチ入力(⑭) ---------- */
await env.close();
const m = await launch({ mobile: true });
await m.ctx.route("https://accounts.google.com/**", (r) => r.abort());
await m.page.goto(m.base);
await register(m.page, "mobile01");
await openPdf(m.page, "tests/fixtures/sample.pdf");
await m.page.waitForTimeout(600);
await m.page.screenshot({ path: `${process.env.SHOT_DIR || "/tmp"}/shot-mobile.png` });
const toolbarBottom = await m.page.evaluate(() => { const r = document.querySelector("#tools").getBoundingClientRect(); return [r.bottom, innerHeight]; });
check("スマホではツールバーが画面下部に表示される", Math.abs(toolbarBottom[0] - toolbarBottom[1]) < 2, JSON.stringify(toolbarBottom));
check("スマホはタッチ端末として認識(pointer: coarse)", await m.page.evaluate(() => matchMedia("(pointer: coarse)").matches));
// CDP でタッチ描画(ペン)
await m.page.evaluate(() => window.__apdf.editor.setTool("pen"));
const cdp = await m.ctx.newCDPSession(m.page);
const pe = await m.page.evaluate(() => { const S = window.__apdf; const r = S.editor.els.get(S.model.pages[0].id).svg.getBoundingClientRect(); return [r.left, r.top, r.width]; });
const touch = (type, x, y, id = 0) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id }] });
const x0 = pe[0] + 40, y0 = pe[1] + 160;
await touch("touchStart", x0, y0);
for (let i = 1; i <= 25; i++) await touch("touchMove", x0 + i * 6, y0 + Math.sin(i / 3) * 20);
await touch("touchEnd");
await m.page.waitForTimeout(150);
const ms = await shapes(m.page);
check("タッチ(指)でなめらかに手書きできる", ms.some((s) => s.type === "pen" && s.pts.length > 5), JSON.stringify(ms.map((s) => [s.type, s.pts.length])));
// ペン入力モード: 指では描かない
await m.page.evaluate(() => window.__apdf.editor.setPalm(true));
const cnt = (await shapes(m.page)).length;
await touch("touchStart", x0, y0 + 100);
for (let i = 1; i <= 10; i++) await touch("touchMove", x0 + i * 8, y0 + 100);
await touch("touchEnd");
await m.page.waitForTimeout(150);
check("ペン入力モードでは指で描画されない(スクロール用)", (await shapes(m.page)).length === cnt);
// ピンチでズーム
await m.page.evaluate(() => window.__apdf.editor.setPalm(false));
const z0 = await m.page.evaluate(() => window.__apdf.editor.zoom);
const vr = await m.page.evaluate(() => { const r = document.querySelector("#viewer").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const cx = vr[0], cy = vr[1];
const t2 = (type, a, b) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: cx - a, y: cy, id: 1 }, { x: cx + b, y: cy, id: 2 }] });
await m.page.evaluate(() => { window.__ev = []; for (const t of ["pointerdown","pointermove","pointercancel","pointerup"]) document.querySelector("#viewer").addEventListener(t, (e) => window.__ev.push(t + ":" + e.pointerId), true); });
await t2("touchStart", 30, 30);
for (let i = 1; i <= 10; i++) await t2("touchMove", 30 + i * 8, 30 + i * 8);
await t2("touchEnd");
await m.page.waitForTimeout(300);
const z1 = await m.page.evaluate(() => window.__apdf.editor.zoom);
console.log("EV", JSON.stringify(await m.page.evaluate(() => window.__ev.slice(0, 12))));
check("2本指のピンチで拡大できる", z1 > z0 * 1.4, `${z0} -> ${z1}`);
check("ピンチ中に余計な線が描かれない", (await shapes(m.page)).length === cnt);
console.log("\nconsole errors (desktop+mobile):", [...errors, ...m.errors].length ? "\n" + [...errors, ...m.errors].join("\n") : "none");
check("コンソールエラーなし", [...errors, ...m.errors].filter((e) => !/Failed to load resource|net::ERR/.test(e)).length === 0, [...errors, ...m.errors].join(" / "));
const { pass, fail } = summary();
console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
await m.close();
process.exit(fail ? 1 : 0);
