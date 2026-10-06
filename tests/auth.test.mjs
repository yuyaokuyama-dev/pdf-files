import test from "node:test";
import assert from "node:assert/strict";
import * as auth from "../js/auth.js";

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}
const fresh = () => auth._setStorage(memStore(), memStore());

test("登録→ログイン→現在のユーザー→ログアウト", async () => {
  fresh();
  assert.equal(auth.currentUser(), null);
  await auth.register("taro_01", "password123");
  await auth.login("TARO_01", "password123"); // ID は大文字小文字を区別しない
  assert.equal(auth.currentUser(), "taro_01");
  auth.logout();
  assert.equal(auth.currentUser(), null);
});

test("パスワードは平文で保存されない", async () => {
  const local = memStore();
  auth._setStorage(local, memStore());
  await auth.register("hanako", "secret-pass-1");
  const raw = local.getItem("apdf_users_v1");
  assert.ok(!raw.includes("secret-pass-1"));
  assert.match(raw, /"iter":210000/);
});

test("間違ったパスワード・存在しないIDは同じエラー", async () => {
  fresh();
  await auth.register("jiro", "password123");
  await assert.rejects(auth.login("jiro", "wrongpass1"), /IDまたはパスワードが違います/);
  await assert.rejects(auth.login("nobody", "password123"), /IDまたはパスワードが違います/);
});

test("重複ID・弱いパスワード・不正なIDは拒否", async () => {
  fresh();
  await auth.register("saburo", "password123");
  await assert.rejects(auth.register("SABURO", "password123"), /既に使われています/);
  await assert.rejects(auth.register("shiro", "short"), /8文字以上/);
  await assert.rejects(auth.register("a b", "password123"), /IDは/);
});

test("5回連続で失敗するとロックされる(正しいパスワードでも拒否)", async () => {
  fresh();
  await auth.register("goro", "password123");
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login("goro", "badbadbad"), /違います/);
  await assert.rejects(auth.login("goro", "password123"), /秒後に再試行/);
});

test("パスワード変更", async () => {
  fresh();
  await auth.register("rokuro", "oldpassword1");
  await auth.changePassword("rokuro", "oldpassword1", "newpassword2");
  await assert.rejects(auth.login("rokuro", "oldpassword1"), /違います/);
  assert.equal(await auth.login("rokuro", "newpassword2"), "rokuro");
});
