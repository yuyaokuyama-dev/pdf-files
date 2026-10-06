// アカウント(共有サーバー版 / 端末内版の切り替え)。
// 共有モード: /api/auth/* (Vercel)。Builds と同じ共有ドライブのアカウントでログインできる。
// 端末内モード: API が無い環境(GitHub Pages / ローカル確認)。従来どおり端末内のみ。
// オフライン: 一度ログインした端末では、端末内に保存した検証情報でログインできる(PBKDF2)。

import * as local from "./auth.js";

const MODE_KEY = "apdf_mode_v1";
const SESSION_KEY = "apdf_acct_v1";
const CRED_KEY = "apdf_cred_v1";
const ITER = 210000;

let env = {
  storage: typeof localStorage !== "undefined" ? localStorage : null,
  session: typeof sessionStorage !== "undefined" ? sessionStorage : null,
  fetch: (...a) => globalThis.fetch(...a),
};
export function _setEnv(e) {
  env = { ...env, ...e };
  cfg = null;
}

let cfg = null; // { shared, resetMode }
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const emailOf = (s) => String(s || "").trim().toLowerCase();
export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());

class NetworkError extends Error {}

const readJson = (store, key, dflt) => {
  try {
    return JSON.parse(store?.getItem(key) || "null") ?? dflt;
  } catch {
    return dflt;
  }
};

async function api(path, { method = "POST", body, token, timeout = 15000 } = {}) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  let res;
  try {
    res = await env.fetch(`api/auth/${path}`, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl?.signal,
      cache: "no-store",
    });
  } catch {
    throw new NetworkError("サーバーに接続できません");
  } finally {
    if (timer) clearTimeout(timer);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    // JSON でない(静的ホスティングの 404 など) → 共有APIなし/障害として扱う
    throw new NetworkError("サーバーの応答が不正です");
  }
  if (!res.ok || !json?.ok) {
    const e = new Error(json?.error || "処理に失敗しました");
    e.status = res.status;
    throw e;
  }
  return json;
}

/** 起動時に呼ぶ。共有APIが使えるかを調べる(オフラインなら前回の結果を使う) */
export async function init() {
  const cached = readJson(env.storage, MODE_KEY, null);
  try {
    const j = await api("config", { method: "GET", timeout: 4000 });
    cfg = { shared: !!j.shared, resetMode: j.resetMode || "admin" };
    env.storage?.setItem(MODE_KEY, JSON.stringify(cfg));
    // サーバー配布のGoogle連携設定(オフライン時は前回の値を使う)
    if (j.google?.clientId) env.storage?.setItem("apdf_google_srv_v1", JSON.stringify(j.google));
  } catch {
    cfg = cached || { shared: false, resetMode: "admin" };
  }
  return cfg;
}
export const mode = () => (cfg?.shared ? "shared" : "local");
export const resetMode = () => cfg?.resetMode || "admin";

// ---- 端末内の検証情報(オフラインログイン用) ----
async function derive(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
}
async function saveCred(user, password, token) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const all = readJson(env.storage, CRED_KEY, {});
  all[emailOf(user.email)] = { salt: b64(salt), hash: b64(await derive(password, salt)), user, token };
  env.storage?.setItem(CRED_KEY, JSON.stringify(all));
}
async function checkCred(email, password) {
  const c = readJson(env.storage, CRED_KEY, {})[emailOf(email)];
  if (!c) return null;
  const h = new Uint8Array(await derive(password, unb64(c.salt)));
  const exp = unb64(c.hash);
  let diff = h.length ^ exp.length;
  for (let i = 0; i < Math.min(h.length, exp.length); i++) diff |= h[i] ^ exp[i];
  return diff === 0 ? c : null;
}

function setSession(user, token, remember) {
  const v = JSON.stringify({ user, token, at: Date.now() });
  (remember ? env.storage : env.session)?.setItem(SESSION_KEY, v);
  (remember ? env.session : env.storage)?.removeItem(SESSION_KEY);
}
const getSession = () => readJson(env.storage, SESSION_KEY, null) || readJson(env.session, SESSION_KEY, null);

export function currentUser() {
  if (cfg?.shared) {
    const s = getSession();
    return s?.user?.email || null;
  }
  return local.currentUser();
}
export const currentProfile = () => (cfg?.shared ? getSession()?.user || null : null);
export const isAdmin = () => cfg?.shared && getSession()?.user?.role === "admin";
export const hasAnyUser = () => (cfg?.shared ? true : local.hasAnyUser());

export function logout() {
  local.logout();
  env.storage?.removeItem(SESSION_KEY);
  env.session?.removeItem(SESSION_KEY);
}

export async function register(email, password, displayName) {
  if (!cfg?.shared) return local.register(email, password);
  email = emailOf(email);
  if (!validEmail(email)) throw new Error("メールアドレスの形式が正しくありません");
  if (!(displayName || "").trim()) throw new Error("名前を入力してください");
  if ((password || "").length < 8) throw new Error("パスワードは8文字以上にしてください");
  const j = await api("register", { body: { email, password, displayName: displayName.trim() } }).catch((e) => {
    throw e instanceof NetworkError ? new Error("登録にはオンライン接続が必要です") : e;
  });
  return j;
}

/** 戻り値: ログインしたID(メールアドレス) */
export async function login(email, password, { remember = true } = {}) {
  if (!cfg?.shared) return local.login(email, password, { remember });
  email = emailOf(email);
  try {
    const j = await api("login", { body: { email, password } });
    await saveCred(j.user, password, j.token);
    setSession(j.user, j.token, remember);
    return j.user.email;
  } catch (e) {
    if (!(e instanceof NetworkError)) throw e;
    // オフライン: この端末で一度ログインしていれば、端末内の検証情報で入れる
    const c = await checkCred(email, password);
    if (!c) throw new Error("オフラインのためログインできません。初回のログインはオンラインで行ってください(またはパスワードが違います)");
    setSession(c.user, c.token, remember);
    return c.user.email;
  }
}

/** 起動時: 保存済みセッションをサーバーで確認(オンライン時のみ)。無効なら false */
export async function verifySession() {
  if (!cfg?.shared) return true;
  const s = getSession();
  if (!s) return false;
  try {
    const j = await api("me", { method: "GET", token: s.token, timeout: 6000 });
    setSession(j.user, s.token, !!env.storage?.getItem(SESSION_KEY));
    return true;
  } catch (e) {
    if (e instanceof NetworkError) return true; // オフライン等: 続行
    if (e.status === 401) return false;
    return true;
  }
}

export async function changePassword(email, oldPassword, newPassword) {
  if (!cfg?.shared) return local.changePassword(email, oldPassword, newPassword);
  const s = getSession();
  if (!s) throw new Error("再度ログインしてください");
  if ((newPassword || "").length < 8) throw new Error("新しいパスワードは8文字以上にしてください");
  await api("password", { token: s.token, body: { currentPassword: oldPassword, newPassword } }).catch((e) => {
    throw e instanceof NetworkError ? new Error("パスワードの変更にはオンライン接続が必要です") : e;
  });
  await saveCred(s.user, newPassword, s.token);
}

/** 本人の再設定要求。戻り値: { notice } または { resetCode, expiresAt }(display モード) */
export async function requestReset(email) {
  if (!cfg?.shared) throw new Error("この環境ではパスワードの再設定を使えません(アカウントはこの端末内のみです)");
  return api("reset", { body: { step: "request", email: emailOf(email) } }).catch((e) => {
    throw e instanceof NetworkError ? new Error("再設定にはオンライン接続が必要です") : e;
  });
}

export async function confirmReset(email, code, newPassword) {
  if (!cfg?.shared) throw new Error("この環境ではパスワードの再設定を使えません");
  const j = await api("reset", { body: { step: "confirm", email: emailOf(email), code: String(code).trim(), newPassword } }).catch((e) => {
    throw e instanceof NetworkError ? new Error("再設定にはオンライン接続が必要です") : e;
  });
  await saveCred(j.user, newPassword, j.token);
  setSession(j.user, j.token, true);
  return j.user.email;
}

/** 管理者: 指定アカウントの確認コードを発行 */
export async function issueReset(email) {
  const s = getSession();
  if (!cfg?.shared || !s) throw new Error("再度ログインしてください");
  return api("reset", { token: s.token, body: { step: "issue", email: emailOf(email) } });
}
