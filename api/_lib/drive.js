// 共有ドライブ(サービスアカウント)への読み書き。外部ライブラリなし。
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/drive";
const FILES = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

export function normalizePrivateKey(raw) {
  let k = String(raw ?? "").trim();
  if ((k.startsWith('"') && k.endsWith('"')) || (k.startsWith("'") && k.endsWith("'"))) k = k.slice(1, -1);
  return k.replace(/\\n/g, "\n").trim();
}

export function readConfig(env = process.env) {
  const emailEnv = (env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "").trim();
  const keyEnv = (env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").trim();
  const jsonEnv = (env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "").trim();
  const blob = jsonEnv || (keyEnv.startsWith("{") ? keyEnv : "");
  let email = emailEnv;
  let privateKey = normalizePrivateKey(keyEnv);
  if (blob) {
    try {
      const j = JSON.parse(blob);
      email = emailEnv || (j.client_email ?? "").trim();
      privateKey = normalizePrivateKey(j.private_key ?? "");
    } catch {
      /* 個別の環境変数を使う */
    }
  }
  return { email, privateKey, rootFolderId: (env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "").trim() };
}

export const isShared = (cfg) => Boolean(cfg.email && cfg.privateKey && cfg.rootFolderId);

let cache = null;
export function clearTokenCache() {
  cache = null;
}

export function createAssertion(email, privateKey, nowSec = Math.floor(Date.now() / 1000)) {
  const b64 = (v) => Buffer.from(v).toString("base64url");
  const unsigned = `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(
    JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }),
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey).toString("base64url")}`;
}

export async function getAccessToken(cfg, fetchFn = fetch) {
  const now = Date.now();
  if (cache && cache.email === cfg.email && cache.expiresAt > now + 60_000) return cache.token;
  const res = await fetchFn(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: createAssertion(cfg.email, cfg.privateKey),
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`共有Driveのサービスアカウント認証に失敗しました: ${res.status} ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error("共有Driveのサービスアカウント認証に失敗しました: access_token がありません");
  cache = { email: cfg.email, token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 - 30_000 };
  return json.access_token;
}

const withShared = (url, listing = false) => {
  const u = new URL(url);
  u.searchParams.set("supportsAllDrives", "true");
  if (listing) {
    u.searchParams.set("includeItemsFromAllDrives", "true");
    u.searchParams.set("corpora", "allDrives");
  }
  return u.toString();
};

export function createDriveClient(token, fetchFn = fetch) {
  const call = (url, init = {}) => fetchFn(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });

  async function findOrCreateFolder(name, parentId) {
    const q = [`name = '${name.replace(/'/g, "\\'")}'`, "mimeType = 'application/vnd.google-apps.folder'", "trashed = false", `'${parentId}' in parents`].join(" and ");
    const list = await call(withShared(`${FILES}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10`, true));
    if (list.ok) {
      const d = await list.json();
      if (d.files?.[0]?.id) return d.files[0].id;
    }
    const created = await call(withShared(`${FILES}?fields=id`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    });
    if (!created.ok) throw new Error(`フォルダを作成できません: ${(await created.text()).slice(0, 200)}`);
    return (await created.json()).id;
  }

  async function listFiles(folderId) {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const res = await call(withShared(`${FILES}?q=${q}&fields=files(id,name,modifiedTime)&pageSize=100`, true));
    if (!res.ok) throw new Error(`一覧を取得できません: ${(await res.text()).slice(0, 200)}`);
    const files = (await res.json()).files ?? [];
    return files.sort((a, b) => (a.modifiedTime ?? "").localeCompare(b.modifiedTime ?? ""));
  }

  async function downloadJson(fileId) {
    const res = await call(withShared(`${FILES}/${encodeURIComponent(fileId)}?alt=media`));
    if (!res.ok) throw new Error(`ダウンロードできません: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  async function updateJson(fileId, payload) {
    const res = await call(withShared(`${UPLOAD}/${encodeURIComponent(fileId)}?uploadType=media`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json; charset=UTF-8" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`更新できません: ${(await res.text()).slice(0, 200)}`);
  }

  async function uploadJson(parentId, name, payload) {
    const boundary = `pdff_${Date.now()}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parentId], mimeType: "application/json" })}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(payload)}\r\n--${boundary}--`;
    const res = await call(withShared(`${UPLOAD}?uploadType=multipart&fields=id`), {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`アップロードできません: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  }

  return { findOrCreateFolder, listFiles, downloadJson, updateJson, uploadJson };
}
