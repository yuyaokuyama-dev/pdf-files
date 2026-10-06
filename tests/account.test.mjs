import test from "node:test";
import assert from "node:assert/strict";
import * as account from "../js/account.js";
import * as local from "../js/auth.js";

const memStore = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

// 偽サーバー(api/auth/* の応答を模す)
function fakeServer() {
  const users = new Map();
  const state = { online: true, calls: [], shared: true };
  const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  const fetchFn = async (url, init = {}) => {
    if (!state.online) throw new TypeError("offline");
    const p = String(url).replace(/^api\/auth\//, "");
    state.calls.push(p);
    const b = init.body ? JSON.parse(init.body) : {};
    const user = (u) => ({ id: u.email, email: u.email, displayName: u.name, role: u.role, company: "", department: "" });
    if (p === "config") return json({ ok: true, shared: state.shared, resetMode: "admin" });
    if (p === "register") {
      if (users.has(b.email)) return json({ ok: false, error: "このメールアドレスは既に登録されています。" }, 409);
      users.set(b.email, { email: b.email, pw: b.password, name: b.displayName, role: users.size ? "user" : "admin" });
      return json({ ok: true, user: user(users.get(b.email)), token: "T-" + b.email });
    }
    if (p === "login") {
      const u = users.get(b.email);
      if (!u || u.pw !== b.password) return json({ ok: false, error: "メールまたはパスワードが正しくありません。" }, 401);
      return json({ ok: true, user: user(u), token: "T-" + b.email });
    }
    if (p === "me") {
      const e = (init.headers.Authorization || "").replace("Bearer T-", "");
      return users.has(e) ? json({ ok: true, user: user(users.get(e)) }) : json({ ok: false, error: "再度ログインしてください。" }, 401);
    }
    if (p === "password") {
      const u = users.get((init.headers.Authorization || "").replace("Bearer T-", ""));
      if (u.pw !== b.currentPassword) return json({ ok: false, error: "現在のパスワードが正しくありません。" }, 401);
      u.pw = b.newPassword;
      return json({ ok: true, user: user(u) });
    }
    return json({ ok: false, error: "unexpected" }, 500);
  };
  return { fetchFn, state, users };
}

const setup = async (srv) => {
  local._setStorage(memStore(), memStore());
  account._setEnv({ storage: memStore(), session: memStore(), fetch: srv.fetchFn });
  await account.init();
};

test("共有モード: 登録→ログイン→セッション保持→ログアウト", async () => {
  const srv = fakeServer();
  await setup(srv);
  assert.equal(account.mode(), "shared");
  await account.register("A@Example.com", "password-1", "山田");
  assert.equal(await account.login("a@example.com", "password-1"), "a@example.com");
  assert.equal(account.currentUser(), "a@example.com");
  assert.equal(account.isAdmin(), true);
  assert.equal(await account.verifySession(), true);
  account.logout();
  assert.equal(account.currentUser(), null);
});

test("共有モード: 誤ったパスワード・重複登録・入力検証", async () => {
  const srv = fakeServer();
  await setup(srv);
  await account.register("a@example.com", "password-1", "山田");
  await assert.rejects(account.login("a@example.com", "wrong-pass"), /正しくありません/);
  await assert.rejects(account.register("a@example.com", "password-1", "山田"), /既に登録/);
  await assert.rejects(account.register("not-mail", "password-1", "x"), /形式/);
  await assert.rejects(account.register("c@example.com", "short", "x"), /8文字/);
  await assert.rejects(account.register("c@example.com", "password-1", " "), /名前/);
});

test("オフライン: 一度ログインした端末なら検証情報でログインできる/未ログインの端末や誤りは不可", async () => {
  const srv = fakeServer();
  await setup(srv);
  await account.register("a@example.com", "password-1", "山田");
  await account.login("a@example.com", "password-1");
  account.logout();
  srv.state.online = false;
  assert.equal(await account.login("a@example.com", "password-1"), "a@example.com");
  account.logout();
  await assert.rejects(account.login("a@example.com", "wrong-pass"), /オフライン/);
  await assert.rejects(account.login("b@example.com", "password-1"), /オフライン/);
  await assert.rejects(account.register("c@example.com", "password-1", "x"), /オンライン/);
  await account.login("a@example.com", "password-1");
  assert.equal(await account.verifySession(), true, "オフラインではセッションを失効させない");
});

test("セッションがサーバーで無効(401)なら false", async () => {
  const srv = fakeServer();
  await setup(srv);
  await account.register("a@example.com", "password-1", "山田");
  await account.login("a@example.com", "password-1");
  srv.users.clear();
  assert.equal(await account.verifySession(), false);
});

test("パスワード変更はサーバーと端末内の検証情報の両方に反映される", async () => {
  const srv = fakeServer();
  await setup(srv);
  await account.register("a@example.com", "password-1", "山田");
  await account.login("a@example.com", "password-1");
  await assert.rejects(account.changePassword("a@example.com", "wrong-pass", "new-password"), /現在のパスワード/);
  await account.changePassword("a@example.com", "password-1", "new-password");
  account.logout();
  srv.state.online = false;
  await assert.rejects(account.login("a@example.com", "password-1"), /オフライン/);
  assert.equal(await account.login("a@example.com", "new-password"), "a@example.com");
});

test("共有APIが無い環境(静的ホスティング)では端末内モードに切り替わる", async () => {
  const srv = fakeServer();
  const html404 = async () => new Response("<html>Not found</html>", { status: 404 });
  local._setStorage(memStore(), memStore());
  account._setEnv({ storage: memStore(), session: memStore(), fetch: html404 });
  await account.init();
  assert.equal(account.mode(), "local");
  await account.register("taro@example.com", "password-1");
  assert.equal(await account.login("taro@example.com", "password-1"), "taro@example.com");
  assert.equal(account.currentUser(), "taro@example.com");
  await assert.rejects(account.requestReset("taro@example.com"), /端末内/);
});
