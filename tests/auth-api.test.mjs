import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createService } from "../api/_lib/service.js";
import { createMemoryStore, createDriveStore } from "../api/_lib/store.js";
import { hashPassword, verifyPassword, signAuthToken, verifyAuthToken } from "../api/_lib/crypto.js";
import { parseSnapshot, serialize } from "../api/_lib/directory.js";
import { clearTokenCache } from "../api/_lib/drive.js";

const mk = (opts = {}) => {
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const store = createMemoryStore();
  return { svc: createService({ store, secret: "secret", now: clock.now, ...opts }), store, clock };
};
const reg = (svc, email = "a@example.com", pw = "password-1") => svc.register({ email, password: pw, displayName: "山田" });

test("登録→ログイン→me。最初のアカウントは管理者", async () => {
  const { svc } = mk();
  const r = await reg(svc);
  assert.equal(r.ok, true);
  assert.equal(r.user.role, "admin");
  const l = await svc.login({ email: "A@Example.com", password: "password-1" });
  assert.equal(l.ok, true);
  const me = await svc.me(`Bearer ${l.token}`);
  assert.equal(me.user.email, "a@example.com");
  assert.equal((await reg(svc, "b@example.com")).user.role, "user");
});

test("入力検証と重複", async () => {
  const { svc } = mk();
  assert.equal((await svc.register({ email: "bad", password: "password-1", displayName: "x" })).status, 400);
  assert.equal((await svc.register({ email: "a@example.com", password: "short", displayName: "x" })).status, 400);
  assert.equal((await svc.register({ email: "a@example.com", password: "password-1", displayName: " " })).status, 400);
  assert.equal((await svc.register({ email: "admin@builds.local", password: "password-1", displayName: "x" })).status, 400);
  await reg(svc);
  assert.equal((await reg(svc)).status, 409);
});

test("誤ったパスワードは拒否され、続けて失敗すると制限される", async () => {
  const { svc } = mk();
  await reg(svc);
  assert.equal((await svc.login({ email: "a@example.com", password: "wrong-pass" })).status, 401);
  assert.equal((await svc.login({ email: "none@example.com", password: "wrong-pass" })).status, 401);
  for (let i = 0; i < 12; i++) await svc.login({ email: "a@example.com", password: "wrong-pass" });
  assert.equal((await svc.login({ email: "a@example.com", password: "password-1" })).status, 429);
});

test("パスワード変更", async () => {
  const { svc } = mk();
  const { token } = await reg(svc);
  const auth = `Bearer ${token}`;
  assert.equal((await svc.changePassword(auth, { currentPassword: "xxxxxxxx", newPassword: "new-password" })).status, 401);
  assert.equal((await svc.changePassword(auth, { currentPassword: "password-1", newPassword: "short" })).status, 400);
  assert.equal((await svc.changePassword(auth, { currentPassword: "password-1", newPassword: "new-password" })).ok, true);
  assert.equal((await svc.login({ email: "a@example.com", password: "password-1" })).status, 401);
  assert.equal((await svc.login({ email: "a@example.com", password: "new-password" })).ok, true);
});

test("不正・期限切れのトークンは拒否", async () => {
  const { svc, clock } = mk();
  await reg(svc);
  await assert.rejects(svc.me("Bearer abc.def"), { status: 401 });
  await assert.rejects(svc.me(""), { status: 401 });
  const old = signAuthToken("a@example.com", "secret", clock.now());
  clock.advance(31 * 24 * 3600 * 1000);
  await assert.rejects(svc.me(`Bearer ${old}`), { status: 401 });
  assert.equal(verifyAuthToken(signAuthToken("a@example.com", "s1"), "s2"), null);
});

test("再設定(既定=管理者が発行): 本人の要求ではコードを返さない", async () => {
  const { svc } = mk();
  const admin = await reg(svc);
  await reg(svc, "b@example.com");
  const req = await svc.requestReset({ email: "b@example.com" });
  assert.equal(req.ok, true);
  assert.equal(req.resetCode, undefined);
  // 管理者以外は発行できない
  const bTok = (await svc.login({ email: "b@example.com", password: "password-1" })).token;
  assert.equal((await svc.issueReset(`Bearer ${bTok}`, { email: "a@example.com" })).status, 403);
  // 管理者が発行
  const issued = await svc.issueReset(`Bearer ${admin.token}`, { email: "b@example.com" });
  assert.equal(issued.ok, true);
  assert.match(issued.resetCode, /^\d{6}$/);
  const done = await svc.confirmReset({ email: "b@example.com", code: issued.resetCode, newPassword: "brand-new-pw" });
  assert.equal(done.ok, true);
  assert.equal((await svc.login({ email: "b@example.com", password: "brand-new-pw" })).ok, true);
  // コードは1回きり
  assert.equal((await svc.confirmReset({ email: "b@example.com", code: issued.resetCode, newPassword: "another-pw-1" })).status, 400);
});

test("確認コードを5回間違えると無効、期限切れも拒否", async () => {
  const { svc, clock } = mk();
  const admin = await reg(svc);
  await reg(svc, "b@example.com");
  const a = `Bearer ${admin.token}`;
  let c = (await svc.issueReset(a, { email: "b@example.com" })).resetCode;
  const wrong = c === "000000" ? "111111" : "000000";
  for (let i = 0; i < 4; i++) assert.equal((await svc.confirmReset({ email: "b@example.com", code: wrong, newPassword: "brand-new-pw" })).status, 401);
  assert.equal((await svc.confirmReset({ email: "b@example.com", code: wrong, newPassword: "brand-new-pw" })).status, 401);
  assert.equal((await svc.confirmReset({ email: "b@example.com", code: c, newPassword: "brand-new-pw" })).status, 400, "5回失敗後は正しいコードでも無効");
  c = (await svc.issueReset(a, { email: "b@example.com" })).resetCode;
  clock.advance(31 * 60 * 1000);
  assert.equal((await svc.confirmReset({ email: "b@example.com", code: c, newPassword: "brand-new-pw" })).status, 400);
});

test("display モード(Builds互換)ではコードが返る", async () => {
  const { svc } = mk({ resetMode: "display" });
  await reg(svc);
  const r = await svc.requestReset({ email: "a@example.com" });
  assert.match(r.resetCode, /^\d{6}$/);
  assert.equal((await svc.requestReset({ email: "none@example.com" })).status, 404);
});

test("Builds とハッシュ・トークン形式が互換", async () => {
  // Builds: PBKDF2-SHA256 / 120000回 / 32バイト / 16進。固定ベクトルで確認
  const salt = "000102030405060708090a0b0c0d0e0f";
  const { createHash, pbkdf2Sync } = await import("node:crypto");
  const hash = pbkdf2Sync("password-1", Buffer.from(salt, "hex"), 120000, 32, "sha256").toString("hex");
  assert.equal(await verifyPassword("password-1", salt, hash), true);
  const h = await hashPassword("pw-12345678");
  assert.match(h.salt, /^[0-9a-f]{32}$/);
  assert.match(h.hash, /^[0-9a-f]{64}$/);
  // 再設定トークンは sha256("email:code")
  assert.equal(createHash("sha256").update("a@example.com:123456").digest("hex").length, 64);
  // users.json の往復(Builds の schemaVersion 1)
  const snap = parseSnapshot(serialize({ users: [], resets: [] }, new Date().toISOString()));
  assert.deepEqual(snap, { users: [], resets: [] });
  assert.equal(parseSnapshot({ schemaVersion: 2, users: [] }), null);
});

test("Drive ストア: 共有ドライブ上の Builds/_auth/users.json を読み書きする(偽Google)", async () => {
  clearTokenCache();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const folders = new Map(); // key: parent/name -> id
  const files = new Map(); // id -> {name,parent,content}
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = new URL(url);
    calls.push(`${init.method || "GET"} ${u.pathname}`);
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
    if (u.hostname === "oauth2.googleapis.com") return json({ access_token: "tok", expires_in: 3600 });
    assert.equal(init.headers.Authorization, "Bearer tok");
    assert.equal(u.searchParams.get("supportsAllDrives"), "true");
    if (u.pathname === "/drive/v3/files" && (init.method || "GET") === "GET") {
      const q = u.searchParams.get("q");
      const parent = /'([^']+)' in parents/.exec(q)[1];
      const name = /name = '([^']+)'/.exec(q)?.[1];
      const list = [...files.entries()].filter(([, f]) => f.parent === parent && (!name || f.name === name)).map(([id, f]) => ({ id, name: f.name, modifiedTime: "2026-01-01T00:00:00Z" }));
      return json({ files: list });
    }
    if (u.pathname === "/drive/v3/files" && init.method === "POST") {
      const m = JSON.parse(init.body);
      const id = `id${files.size + 1}`;
      files.set(id, { name: m.name, parent: m.parents[0], content: null, folder: true });
      return json({ id });
    }
    if (u.pathname === "/upload/drive/v3/files" && init.method === "POST") {
      const meta = JSON.parse(/\r\n\r\n(\{.*?\})\r\n--/s.exec(init.body)[1]);
      const content = JSON.parse(/application\/json\r\n\r\n(.*)\r\n--pdff/s.exec(init.body)[1]);
      const id = `id${files.size + 1}`;
      files.set(id, { name: meta.name, parent: meta.parents[0], content });
      return json({ id });
    }
    if (u.pathname.startsWith("/upload/drive/v3/files/") && init.method === "PATCH") {
      files.get(decodeURIComponent(u.pathname.split("/").pop())).content = JSON.parse(init.body);
      return json({});
    }
    if (u.pathname.startsWith("/drive/v3/files/") && u.searchParams.get("alt") === "media") {
      return json(files.get(decodeURIComponent(u.pathname.split("/").pop())).content);
    }
    return json({ error: "unexpected " + u.pathname }, 500);
  };
  const env = { GOOGLE_SERVICE_ACCOUNT_EMAIL: "sa@proj.iam.gserviceaccount.com", GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"), GOOGLE_DRIVE_ROOT_FOLDER_ID: "root1" };
  const store = createDriveStore({ env, fetchFn });
  const svc = createService({ store, secret: store.secret });
  assert.equal((await reg(svc)).ok, true); // 作成(アップロード)
  assert.equal((await reg(svc, "b@example.com")).ok, true); // 更新(PATCH)
  assert.equal((await svc.login({ email: "b@example.com", password: "password-1" })).ok, true);
  const usersFile = [...files.values()].find((f) => f.name === "users.json");
  assert.equal(usersFile.content.schemaVersion, 1);
  assert.equal(usersFile.content.users.length, 2);
  assert.ok(!JSON.stringify(usersFile.content).includes("password-1"), "平文パスワードを保存しない");
  const builds = [...files.entries()].find(([, f]) => f.name === "Builds" && f.parent === "root1");
  assert.ok(builds, "Builds/ が共有ドライブのルート直下にある");
  assert.ok([...files.values()].some((f) => f.name === "_auth" && f.parent === builds[0]));
  assert.throws(() => createDriveStore({ env: {}, fetchFn }), { status: 503 });
  assert.equal(store.secret, privateKey.replace(/\\n/g, "\n").trim(), "AUTH_SECRET が無ければサービスアカウントの秘密鍵で署名");
  const withSecret = createDriveStore({ env: { ...env, AUTH_SECRET: "  shared-secret  " }, fetchFn });
  assert.equal(withSecret.secret, "shared-secret", "AUTH_SECRET があれば優先(全アプリ共通の署名鍵にできる)");
});
