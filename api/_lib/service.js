// 認証の業務ロジック(Builds の user-directory.ts と同じ挙動)。
// store: { read(): {snapshot, handle}, write(handle, snapshot) } を差し替えられる(テスト用)。
import {
  isSeedAdminEmail, normalizeEmail, toPublicAccount, validateDisplayName, validateEmail, validatePassword,
} from "./directory.js";
import { generateResetCode, hashPassword, hashResetToken, signAuthToken, verifyAuthToken, verifyPassword } from "./crypto.js";

const ACCOUNT_LIMIT = 500;
const BAD_LOGIN = "メールまたはパスワードが正しくありません。";
const fail = (status, error) => ({ ok: false, status, error });

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let queue = Promise.resolve();
const locked = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.then(() => undefined, () => undefined);
  return run;
};

const str = (v) => (typeof v === "string" ? v : "");

const MAX_RESET_ATTEMPTS = 5;
const MAX_LOGIN_FAILS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

/** resetMode: "admin"(既定・管理者が発行) | "display"(Builds互換・要求した画面にコードを表示。誰でも再設定できるため非推奨) */
export function createService({ store, secret, now = () => Date.now(), resetMode = "admin" }) {
  const fails = new Map(); // メールごとの失敗回数(サーバーレスの同一インスタンス内で有効な簡易制限)
  const tooMany = (email) => {
    const f = fails.get(email);
    return f && f.until > now() && f.n >= MAX_LOGIN_FAILS;
  };
  const noteFail = (email) => {
    const f = fails.get(email);
    if (!f || f.until <= now()) fails.set(email, { n: 1, until: now() + LOGIN_WINDOW_MS });
    else f.n += 1;
  };
  const issue = (email) => signAuthToken(email, secret, now());
  const persist = (cur, snapshot) => store.write(cur.handle, snapshot);

  async function requireAccount(authorization) {
    const m = /^Bearer\s+(\S+)$/i.exec(String(authorization ?? "").trim());
    const email = m ? verifyAuthToken(m[1], secret, now()) : null;
    if (!email) throw new AuthError(401, "再度ログインしてください。");
    return email;
  }

  async function createReset(email) {
    const cur = await store.read();
    if (!cur.snapshot.users.some((u) => u.email === email)) return null;
    const resetCode = generateResetCode();
    const createdAt = new Date(now()).toISOString();
    const expiresAt = new Date(now() + 30 * 60 * 1000).toISOString();
    const resets = cur.snapshot.resets.filter((r) => r.email !== email);
    resets.push({ email, tokenHash: hashResetToken(`${email}:${resetCode}`), expiresAt, createdAt });
    await persist(cur, { users: cur.snapshot.users, resets });
    return { resetCode, expiresAt, email };
  }

  return {
    async register(input) {
      const email = normalizeEmail(input.email);
      const password = str(input.password);
      const displayName = str(input.displayName).trim();
      const e = validateEmail(email) || (isSeedAdminEmail(email) ? "このメールアドレスは使えません。" : null) ||
        validateDisplayName(displayName) || validatePassword(password);
      if (e) return fail(400, e);
      return locked(async () => {
        const cur = await store.read();
        if (cur.snapshot.users.some((u) => u.email === email)) return fail(409, "このメールアドレスは既に登録されています。");
        if (cur.snapshot.users.length >= ACCOUNT_LIMIT) return fail(403, "登録できるアカウント数の上限に達しました。");
        const { salt, hash } = await hashPassword(password);
        const t = new Date(now()).toISOString();
        const user = {
          id: email, email, displayName: displayName.slice(0, 80),
          company: str(input.company).trim().slice(0, 80), department: str(input.department).trim().slice(0, 80),
          role: cur.snapshot.users.length === 0 ? "admin" : "user",
          passwordSalt: salt, passwordHash: hash, createdAt: t, updatedAt: t,
        };
        await persist(cur, { users: [...cur.snapshot.users, user], resets: cur.snapshot.resets });
        return { ok: true, user: toPublicAccount(user), token: issue(email) };
      });
    },

    async login(input) {
      const email = normalizeEmail(input.email);
      const password = str(input.password);
      const e = validateEmail(email);
      if (e) return fail(400, e);
      if (isSeedAdminEmail(email)) return fail(401, BAD_LOGIN);
      if (tooMany(email)) return fail(429, "ログインに続けて失敗したため、しばらくしてから再試行してください。");
      return locked(async () => {
        const { snapshot } = await store.read();
        const u = snapshot.users.find((x) => x.email === email);
        // 存在しないメールでも同程度の時間を使う
        const ok = u ? await verifyPassword(password, u.passwordSalt, u.passwordHash) : (await hashPassword(password), false);
        if (!ok) {
          noteFail(email);
          return fail(401, BAD_LOGIN);
        }
        fails.delete(email);
        return { ok: true, user: toPublicAccount(u), token: issue(email) };
      });
    },

    async me(authorization) {
      const email = await requireAccount(authorization);
      const { snapshot } = await store.read();
      const u = snapshot.users.find((x) => x.email === email);
      return u ? { ok: true, user: toPublicAccount(u) } : fail(401, "再度ログインしてください。");
    },

    async changePassword(authorization, input) {
      const newPassword = str(input.newPassword);
      if (newPassword.length < 8) return fail(400, "新しいパスワードは8文字以上にしてください。");
      const email = await requireAccount(authorization);
      return locked(async () => {
        const cur = await store.read();
        const i = cur.snapshot.users.findIndex((x) => x.email === email);
        if (i < 0) return fail(401, "再度ログインしてください。");
        const prev = cur.snapshot.users[i];
        if (!(await verifyPassword(str(input.currentPassword), prev.passwordSalt, prev.passwordHash))) {
          return fail(401, "現在のパスワードが正しくありません。");
        }
        const { salt, hash } = await hashPassword(newPassword);
        const users = cur.snapshot.users.slice();
        users[i] = { ...prev, passwordSalt: salt, passwordHash: hash, updatedAt: new Date(now()).toISOString() };
        await persist(cur, { users, resets: cur.snapshot.resets });
        return { ok: true, user: toPublicAccount(users[i]) };
      });
    },

    /** 本人からの再設定要求。admin モードではコードを返さない(管理者が issueReset で発行して本人に伝える)。 */
    async requestReset(input) {
      const email = normalizeEmail(input.email);
      const e = validateEmail(email);
      if (e) return fail(400, e);
      if (resetMode !== "display") {
        return { ok: true, email, notice: "再設定は管理者が確認コードを発行します。管理者に連絡してください。" };
      }
      if (isSeedAdminEmail(email)) return fail(404, "このメールアドレスのアカウントが見つかりません。");
      return locked(async () => {
        const r = await createReset(email);
        return r ? { ok: true, ...r } : fail(404, "このメールアドレスのアカウントが見つかりません。");
      });
    },

    /** 管理者が、指定アカウントの確認コードを発行する */
    async issueReset(authorization, input) {
      const adminEmail = await requireAccount(authorization);
      const email = normalizeEmail(input.email);
      const e = validateEmail(email);
      if (e) return fail(400, e);
      return locked(async () => {
        const { snapshot } = await store.read();
        const admin = snapshot.users.find((u) => u.email === adminEmail);
        if (!admin || admin.role !== "admin") return fail(403, "管理者のみ実行できます。");
        const r = await createReset(email);
        return r ? { ok: true, ...r } : fail(404, "このメールアドレスのアカウントが見つかりません。");
      });
    },

    async confirmReset(input) {
      const email = normalizeEmail(input.email);
      const code = str(input.code).trim();
      const newPassword = str(input.newPassword);
      const e = validateEmail(email);
      if (e) return fail(400, e);
      if (!/^\d{6}$/.test(code)) return fail(400, "確認コードは6桁の数字です。");
      if (newPassword.length < 8) return fail(400, "新しいパスワードは8文字以上にしてください。");
      return locked(async () => {
        const cur = await store.read();
        const rec = cur.snapshot.resets.find((r) => r.email === email);
        if (!rec) return fail(400, "有効なリセット要求がありません。最初からやり直してください。");
        const others = cur.snapshot.resets.filter((r) => r.email !== email);
        if (Date.parse(rec.expiresAt) < now()) {
          await persist(cur, { users: cur.snapshot.users, resets: others });
          return fail(400, "確認コードの有効期限が切れています。再発行してください。");
        }
        if (hashResetToken(`${email}:${code}`) !== rec.tokenHash) {
          const attempts = (rec.attempts || 0) + 1;
          const resets = attempts >= MAX_RESET_ATTEMPTS ? others : [...others, { ...rec, attempts }];
          await persist(cur, { users: cur.snapshot.users, resets });
          return fail(401, attempts >= MAX_RESET_ATTEMPTS ? "確認コードを続けて間違えたため無効になりました。再発行してください。" : "確認コードが正しくありません。");
        }
        const i = cur.snapshot.users.findIndex((u) => u.email === email);
        if (i < 0) return fail(404, "アカウントが見つかりません。");
        const { salt, hash } = await hashPassword(newPassword);
        const users = cur.snapshot.users.slice();
        users[i] = { ...users[i], passwordSalt: salt, passwordHash: hash, updatedAt: new Date(now()).toISOString() };
        await persist(cur, { users, resets: others });
        return { ok: true, user: toPublicAccount(users[i]), token: issue(email) };
      });
    },
  };
}
