// 共有アカウントファイル(Builds の Builds/_auth/users.json と同じ形式)の検証・整形。
// パスワードはソルトと PBKDF2 ハッシュのみ。平文は保存しない。

export const SEED_ADMIN_EMAIL = "admin@builds.local";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_SALT_RE = /^[0-9a-f]{32}$/i;
const HEX_HASH_RE = /^[0-9a-f]{64}$/i;

export const normalizeEmail = (e) => String(e ?? "").trim().toLowerCase();
export const isSeedAdminEmail = (e) => normalizeEmail(e) === SEED_ADMIN_EMAIL;
export const validateEmail = (e) => (EMAIL_RE.test(e) ? null : "メールアドレスの形式が正しくありません。");
export const validatePassword = (p) => (typeof p === "string" && p.length >= 8 ? null : "パスワードは8文字以上にしてください。");
export const validateDisplayName = (n) => (String(n ?? "").trim().length >= 1 ? null : "名前を入力してください。");

export function toPublicAccount(u) {
  return { id: u.email, email: u.email, displayName: u.displayName, company: u.company, department: u.department, role: u.role };
}

const isIso = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function parseUser(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.email !== "string") return null;
  const email = normalizeEmail(raw.email);
  if (validateEmail(email)) return null;
  if (typeof raw.passwordSalt !== "string" || !HEX_SALT_RE.test(raw.passwordSalt)) return null;
  if (typeof raw.passwordHash !== "string" || !HEX_HASH_RE.test(raw.passwordHash)) return null;
  if (typeof raw.displayName !== "string" || raw.displayName.trim().length < 1) return null;
  const createdAt = isIso(raw.createdAt) ? raw.createdAt : new Date(0).toISOString();
  const updatedAt = isIso(raw.updatedAt) ? raw.updatedAt : createdAt;
  return {
    id: email,
    email,
    displayName: raw.displayName.trim().slice(0, 80),
    company: typeof raw.company === "string" ? raw.company.trim().slice(0, 80) : "",
    department: typeof raw.department === "string" ? raw.department.trim().slice(0, 80) : "",
    role: raw.role === "admin" ? "admin" : "user",
    passwordSalt: raw.passwordSalt.toLowerCase(),
    passwordHash: raw.passwordHash.toLowerCase(),
    createdAt,
    updatedAt,
  };
}

function parseReset(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.email !== "string") return null;
  const email = normalizeEmail(raw.email);
  if (validateEmail(email)) return null;
  if (typeof raw.tokenHash !== "string" || !HEX_HASH_RE.test(raw.tokenHash)) return null;
  if (!isIso(raw.expiresAt) || !isIso(raw.createdAt)) return null;
  const attempts = Number.isInteger(raw.attempts) && raw.attempts > 0 ? raw.attempts : 0;
  return { email, tokenHash: raw.tokenHash.toLowerCase(), expiresAt: raw.expiresAt, createdAt: raw.createdAt, ...(attempts ? { attempts } : {}) };
}

export const emptyDirectory = () => ({ users: [], resets: [] });

/** 書き換えてはいけないファイル(未知のスキーマ・壊れた行)なら null */
export function parseSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.users)) return null;
  const users = [];
  const seen = new Set();
  for (const item of raw.users) {
    const p = parseUser(item);
    if (!p) return null;
    if (isSeedAdminEmail(p.email) || seen.has(p.email)) continue;
    users.push(p);
    seen.add(p.email);
  }
  const resets = [];
  if (raw.resets !== undefined) {
    if (!Array.isArray(raw.resets)) return null;
    for (const item of raw.resets) {
      const p = parseReset(item);
      if (p) resets.push(p);
    }
  }
  return { users, resets };
}

export function serialize(snapshot, updatedAt) {
  return {
    schemaVersion: 1,
    updatedAt,
    users: snapshot.users
      .filter((u) => !isSeedAdminEmail(u.email))
      .map((u) => ({ ...u, id: u.email, role: u.role === "admin" ? "admin" : "user" })),
    resets: snapshot.resets,
  };
}

/** 重複ファイルができた場合は更新が新しい行を採用 */
export function mergeSnapshots(snapshots) {
  const users = new Map();
  const resets = new Map();
  for (const s of snapshots) {
    for (const u of s.users) {
      if (isSeedAdminEmail(u.email)) continue;
      const prev = users.get(u.email);
      if (!prev || u.updatedAt >= prev.updatedAt) users.set(u.email, u);
    }
    for (const r of s.resets) {
      const prev = resets.get(r.email);
      if (!prev || r.createdAt >= prev.createdAt) resets.set(r.email, r);
    }
  }
  return { users: [...users.values()], resets: [...resets.values()] };
}
