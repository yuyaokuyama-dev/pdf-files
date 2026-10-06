// 共有アカウント(メールアドレスID・再設定)の画面操作テスト。/api/auth/* は偽サーバーで応答する。
import { launch } from "./e2e-lib.mjs";

let fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : " " + extra}`);
  if (!ok) fail++;
};

const users = new Map();
let resetCode = null;
const json = (route, o, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
const pub = (u) => ({ id: u.email, email: u.email, displayName: u.name, role: u.role, company: "", department: "" });
async function handle(route) {
  const req = route.request();
  const p = new URL(req.url()).pathname.replace(/^.*\/api\/auth\//, "");
  const b = req.postDataJSON?.() || {};
  const who = () => users.get((req.headers().authorization || "").replace("Bearer T-", ""));
  if (p === "config") return json(route, { ok: true, shared: true, resetMode: "admin" });
  if (p === "register") {
    if (users.has(b.email)) return json(route, { ok: false, error: "このメールアドレスは既に登録されています。" }, 409);
    users.set(b.email, { email: b.email, pw: b.password, name: b.displayName, role: users.size ? "user" : "admin" });
    return json(route, { ok: true, user: pub(users.get(b.email)), token: "T-" + b.email });
  }
  if (p === "login") {
    const u = users.get(b.email);
    if (!u || u.pw !== b.password) return json(route, { ok: false, error: "メールまたはパスワードが正しくありません。" }, 401);
    return json(route, { ok: true, user: pub(u), token: "T-" + b.email });
  }
  if (p === "me") return who() ? json(route, { ok: true, user: pub(who()) }) : json(route, { ok: false, error: "再度ログインしてください。" }, 401);
  if (p === "reset") {
    if (b.step === "issue") {
      if (who()?.role !== "admin") return json(route, { ok: false, error: "管理者のみ実行できます。" }, 403);
      resetCode = "482913";
      return json(route, { ok: true, resetCode, email: b.email, expiresAt: "x" });
    }
    if (b.step === "confirm") {
      const u = users.get(b.email);
      if (!u || b.code !== resetCode) return json(route, { ok: false, error: "確認コードが正しくありません。" }, 401);
      u.pw = b.newPassword;
      resetCode = null;
      return json(route, { ok: true, user: pub(u), token: "T-" + b.email });
    }
    return json(route, { ok: true, email: b.email, notice: "再設定は管理者が確認コードを発行します。管理者に連絡してください。" });
  }
  return json(route, { ok: false, error: "unexpected" }, 500);
}

const env = await launch();
const { page, ctx } = env;
await ctx.route("**/api/auth/**", handle);
await page.goto(env.base);
await page.waitForSelector("#auth:not([hidden])");

check("共有モードではメールアドレス入力・名前欄(登録時)・再設定リンクが出る", (await page.textContent("#authIdLabel")) === "メールアドレス" && (await page.locator("#authForgot").isVisible()));
await page.click("#tabRegister");
check("登録タブで名前欄が表示される", await page.locator("#authNameRow").isVisible());
await page.fill("#authId", "admin@example.com");
await page.fill("#authName", "管理者 太郎");
await page.fill("#authPw", "password-1234");
await page.fill("#authPw2", "password-1234");
await page.click("#authSubmit");
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
check("メールアドレスで登録→ログインできる", (await page.evaluate(() => window.__apdf.user)) === "admin@example.com");

await page.click("#btnUser");
const menu = await page.textContent("#menu");
check("メニューに名前とメールが表示され、管理者メニューがある", menu.includes("管理者 太郎") && menu.includes("再設定コードの発行"), menu.slice(0, 120));
await page.keyboard.press("Escape");
await page.mouse.click(5, 5);

await page.reload();
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
check("再読み込みしてもログイン状態が保持される", (await page.evaluate(() => window.__apdf.user)) === "admin@example.com");

// 一般ユーザーを作って、再設定を管理者コードで行う
users.set("user@example.com", { email: "user@example.com", pw: "old-password-1", name: "一般 花子", role: "user" });
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "再設定コードの発行" }).click();
await page.waitForSelector("dialog[open] input");
await page.fill("dialog[open] input", "user@example.com");
await page.locator("dialog[open] .btn.primary").click();
await page.waitForSelector("dialog[open] b");
check("管理者が6桁の確認コードを発行できる", (await page.textContent("dialog[open] b")).trim() === "482913");
await page.locator("dialog[open] .btn.primary").click();

// ログアウト → 誤ったパスワード
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "ログアウト" }).click();
await page.waitForSelector("#auth:not([hidden])");
await page.fill("#authId", "user@example.com");
await page.fill("#authPw", "wrong-password");
await page.click("#authSubmit");
await page.waitForFunction(() => document.querySelector("#authMsg")?.textContent.trim().length > 0);
check("誤ったパスワードではログインできない", /正しくありません/.test(await page.textContent("#authMsg")));

// 再設定
await page.click("#authForgot");
await page.waitForSelector("dialog[open] #fpCode");
check("再設定ダイアログに入力済みのメールが引き継がれる", (await page.inputValue("#fpEmail")) === "user@example.com");
await page.fill("#fpCode", "000000");
await page.fill("#fpPw", "brand-new-pass-1");
await page.locator("dialog[open] .btn.primary").click();
await page.waitForFunction(() => document.querySelector("#fpMsg")?.textContent.trim().length > 0);
check("確認コードが違うと再設定できない", /正しくありません/.test(await page.textContent("#fpMsg")));
await page.fill("#fpCode", "482913");
await page.locator("dialog[open] .btn.primary").click();
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
check("正しい確認コードで再設定→そのままログインできる", (await page.evaluate(() => window.__apdf.user)) === "user@example.com" && users.get("user@example.com").pw === "brand-new-pass-1");

// オフライン再ログイン: ログアウト後、ネットワーク断でも一度ログイン済みのこの端末なら入れる
await page.click("#btnUser");
await page.locator("#menu button", { hasText: "ログアウト" }).click();
await page.waitForSelector("#auth:not([hidden])");
await ctx.setOffline(true);
await page.fill("#authId", "user@example.com");
await page.fill("#authPw", "brand-new-pass-1");
await page.click("#authSubmit");
await page.waitForSelector("#app:not([hidden])", { timeout: 15000 });
check("オフラインでも、ログイン済みの端末ならログインできる", (await page.evaluate(() => window.__apdf.user)) === "user@example.com");
await ctx.setOffline(false);

const bad = env.errors.filter((e) => !/Failed to load resource/.test(e));
console.log("console errors:", bad.join(" | ") || "none");
check("コンソールエラーなし", bad.length === 0, bad.join(" | "));
await env.close();
console.log(`\nRESULT: ${fail ? "FAIL" : "ALL PASS"}`);
process.exit(fail ? 1 : 0);
