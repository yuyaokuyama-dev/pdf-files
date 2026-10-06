// Drive(共有ドライブ)上の Builds/_auth/users.json を読み書きするストア。Builds と同じ場所・形式。
import { emptyDirectory, mergeSnapshots, parseSnapshot, serialize } from "./directory.js";
import { AuthError } from "./service.js";
import { createDriveClient, getAccessToken, isShared, readConfig } from "./drive.js";

const USERS_FILE = "users.json";

export function createDriveStore({ env = process.env, fetchFn = fetch } = {}) {
  const cfg = readConfig(env);
  if (!isShared(cfg)) throw new AuthError(503, "共有Driveが未設定です。");
  let client = null;
  let folderId = null;

  async function ready() {
    if (!client) client = createDriveClient(await getAccessToken(cfg, fetchFn), fetchFn);
    if (!folderId) {
      const builds = await client.findOrCreateFolder("Builds", cfg.rootFolderId);
      folderId = await client.findOrCreateFolder("_auth", builds);
    }
    return client;
  }

  return {
    secret: cfg.privateKey, // Builds と同じ署名鍵(トークンが相互に有効)
    async read() {
      const c = await ready();
      const files = (await c.listFiles(folderId)).filter((f) => f.name === USERS_FILE);
      if (files.length === 0) return { snapshot: emptyDirectory(), handle: { fileId: null } };
      const snaps = [];
      for (const f of files) {
        const s = parseSnapshot(await c.downloadJson(f.id));
        if (!s) throw new AuthError(500, "共有アカウントファイルを読めないため、上書きを中止しました。");
        snaps.push(s);
      }
      return { snapshot: mergeSnapshots(snaps), handle: { fileId: files[files.length - 1].id } };
    },
    async write(handle, snapshot) {
      const c = await ready();
      const t = Date.now();
      const payload = serialize({ users: snapshot.users, resets: snapshot.resets.filter((r) => Date.parse(r.expiresAt) >= t) }, new Date(t).toISOString());
      if (handle.fileId) await c.updateJson(handle.fileId, payload);
      else await c.uploadJson(folderId, USERS_FILE, payload);
    },
  };
}

/** テスト用のメモリ上ストア */
export function createMemoryStore(initial = emptyDirectory()) {
  let snap = { users: [...initial.users], resets: [...initial.resets] };
  return {
    async read() {
      return { snapshot: { users: [...snap.users], resets: [...snap.resets] }, handle: {} };
    },
    async write(_h, s) {
      snap = { users: [...s.users], resets: [...s.resets] };
    },
  };
}
