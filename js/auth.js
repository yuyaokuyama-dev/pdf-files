// ID・パスワード管理(サーバー不要・無料運用)。
// アカウントはこの端末内に保存し、パスワードは PBKDF2-SHA256(ソルト+高反復)でハッシュ化する。
// ※ 端末をまたいだログイン共有はできない(別端末では別アカウントとして登録する)。

const USERS_KEY = "apdf_users_v1";
const SESSION_KEY = "apdf_session_v1";
const ITER = 210000;
const MAX_FAILS = 5;
const LOCK_MS = 30_000;

let storage = typeof localStorage !== "undefined" ? localStorage : null;
let sessionStore = typeof sessionStorage !== "undefined" ? sessionStorage : null;
export function _setStorage(local, session) {
  storage = local;
  sessionStore = session || local;
}

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
}

function readUsers() {
  try {
    return JSON.parse(storage.getItem(USERS_KEY) || "{}");
  } catch {
    return {};
  }
}
const writeUsers = (u) => storage.setItem(USERS_KEY, JSON.stringify(u));

export const validId = (id) => /^[A-Za-z0-9_.@+-]{3,64}$/.test(id);
export const validPassword = (pw) => typeof pw === "string" && pw.length >= 8;

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

export async function register(id, password) {
  id = (id || "").trim();
  if (!validId(id)) throw new Error("IDは英数字と . _ @ + - の3〜64文字で入力してください");
  if (!validPassword(password)) throw new Error("パスワードは8文字以上にしてください");
  const users = readUsers();
  const key = id.toLowerCase();
  if (users[key]) throw new Error("このIDは既に使われています");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITER);
  users[key] = { id, salt: b64(salt), hash: b64(hash), iter: ITER, created: Date.now(), fails: 0, lockUntil: 0 };
  writeUsers(users);
  return id;
}

export async function login(id, password, { remember = true } = {}) {
  const key = (id || "").trim().toLowerCase();
  const users = readUsers();
  const u = users[key];
  if (u && u.lockUntil > Date.now()) {
    throw new Error(`ログインに続けて失敗したため、${Math.ceil((u.lockUntil - Date.now()) / 1000)}秒後に再試行してください`);
  }
  // 存在しないIDでも同程度の時間を使う(IDの有無を推測されにくくする)
  const salt = u ? unb64(u.salt) : new Uint8Array(16);
  const hash = new Uint8Array(await derive(password || "", salt, u?.iter || ITER));
  const ok = u && timingSafeEqual(hash, unb64(u.hash));
  if (!ok) {
    if (u) {
      u.fails = (u.fails || 0) + 1;
      if (u.fails >= MAX_FAILS) {
        u.fails = 0;
        u.lockUntil = Date.now() + LOCK_MS;
      }
      writeUsers(users);
    }
    throw new Error("IDまたはパスワードが違います");
  }
  u.fails = 0;
  u.lockUntil = 0;
  writeUsers(users);
  const session = JSON.stringify({ id: u.id, at: Date.now() });
  (remember ? storage : sessionStore).setItem(SESSION_KEY, session);
  (remember ? sessionStore : storage).removeItem(SESSION_KEY);
  return u.id;
}

export function currentUser() {
  const raw = storage?.getItem(SESSION_KEY) || sessionStore?.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const { id } = JSON.parse(raw);
    return readUsers()[id.toLowerCase()] ? id : null;
  } catch {
    return null;
  }
}

export function logout() {
  storage?.removeItem(SESSION_KEY);
  sessionStore?.removeItem(SESSION_KEY);
}

export async function changePassword(id, oldPassword, newPassword) {
  if (!validPassword(newPassword)) throw new Error("新しいパスワードは8文字以上にしてください");
  await login(id, oldPassword, { remember: !!storage.getItem(SESSION_KEY) });
  const users = readUsers();
  const key = id.toLowerCase();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  users[key].salt = b64(salt);
  users[key].hash = b64(await derive(newPassword, salt, ITER));
  users[key].iter = ITER;
  writeUsers(users);
}

export function hasAnyUser() {
  return Object.keys(readUsers()).length > 0;
}
