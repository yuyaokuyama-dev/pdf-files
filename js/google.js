// Google Drive / Gmail 連携(ブラウザから直接。サーバー不要=無料)。
// OAuth クライアントID等は「設定」画面で入力し、この端末の localStorage に保存する。
export const SCOPES = [
  "https://www.googleapis.com/auth/drive.file", // このアプリで開いた/作ったファイルのみ(最小権限)
  "https://www.googleapis.com/auth/gmail.send", // メール送信のみ(受信箱は読めない)
].join(" ");

const CFG_KEY = "apdf_google_cfg_v1";
const SRV_KEY = "apdf_google_srv_v1"; // サーバー(Vercel環境変数)から配布された値
const nonEmpty = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v));
const readLS = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || "{}");
  } catch {
    return {};
  }
};
// 優先順位: 端末の手入力 > サーバー配布 > 埋め込み設定
export const getConfig = () => ({ clientId: "", apiKey: "", appId: "", ...nonEmpty(globalThis.APDF_CONFIG), ...nonEmpty(readLS(SRV_KEY)), ...nonEmpty(readLS(CFG_KEY)) });
export const serverProvided = () => !!readLS(SRV_KEY).clientId;
export const setConfig = (c) => localStorage.setItem(CFG_KEY, JSON.stringify(c));
export const isConfigured = () => !!getConfig().clientId;

export class OfflineError extends Error {
  constructor() {
    super("オフラインです。オンラインになってから実行してください");
    this.name = "OfflineError";
  }
}
const needOnline = () => {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new OfflineError();
};

const loaded = new Map();
function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = res;
        s.onerror = () => {
          loaded.delete(src);
          rej(new Error("Googleのスクリプトを読み込めません(ネットワークを確認してください)"));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src);
}

/** 設定済みなら先に GIS を読み込んでおく(ポップアップ表示を即時にするため) */
export function preload() {
  if (isConfigured() && (typeof navigator === "undefined" || navigator.onLine)) loadScript("https://accounts.google.com/gsi/client").catch(() => {});
}

/* ---------- 認証(Google Identity Services のトークン方式) ---------- */
const TOK_KEY = "apdf_google_tok_v1"; // タブを開いている間だけ保持(閉じると消える)
const GRANT_KEY = "apdf_google_granted_v1"; // 一度許可済みなら次回から同意画面を省く
const ss = (fn) => {
  try {
    return fn(sessionStorage);
  } catch {
    return null;
  }
};
const ls = (fn) => {
  try {
    return fn(localStorage);
  } catch {
    return null;
  }
};
let token = ss((s) => JSON.parse(s.getItem(TOK_KEY) || "null")); // { access_token, expiresAt }
let tokenClient = null;

export async function getToken({ prompt } = {}) {
  needOnline();
  const cfg = getConfig();
  if (!cfg.clientId) throw new Error("Google連携が未設定です。「設定」でクライアントIDを入力してください");
  if (token && token.expiresAt > Date.now() + 60_000 && !prompt) return token.access_token;
  await loadScript("https://accounts.google.com/gsi/client");
  return new Promise((resolve, reject) => {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.clientId,
      scope: SCOPES,
      callback: (r) => {
        if (r.error) return reject(new Error(`Googleログインに失敗しました: ${r.error_description || r.error}`));
        token = { access_token: r.access_token, expiresAt: Date.now() + (r.expires_in || 3600) * 1000 };
        ss((s) => s.setItem(TOK_KEY, JSON.stringify(token)));
        ls((l) => l.setItem(GRANT_KEY, "1"));
        resolve(token.access_token);
      },
      error_callback: (e) => reject(new Error(`Googleログインが完了しませんでした: ${e.type || e.message || "cancel"}`)),
    });
    // 初回だけ同意画面を出す。許可済みなら "" にして、アカウント選択も省く(前回と同じアカウントを自動選択)
    tokenClient.requestAccessToken({ prompt: prompt ?? (ls((l) => l.getItem(GRANT_KEY)) ? "" : "consent") });
  });
}
export const isSignedIn = () => !!(token && token.expiresAt > Date.now());
export function signOut() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  token = null;
  ss((s) => s.removeItem(TOK_KEY));
  ls((l) => l.removeItem(GRANT_KEY));
}

async function api(url, opts = {}, retry = true) {
  const t = await getToken();
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
  if (r.status === 401 && retry) {
    token = null;
    ss((s) => s.removeItem(TOK_KEY));
    return api(url, opts, false);
  }
  if (!r.ok) {
    let msg = "";
    try {
      msg = (await r.json()).error?.message || "";
    } catch {
      /* ignore */
    }
    throw new Error(`Google API エラー (${r.status}) ${msg}`);
  }
  return r;
}

/* ---------- Drive ---------- */
async function loadPicker() {
  await loadScript("https://apis.google.com/js/api.js");
  await new Promise((res) => gapi.load("picker", res));
}

/** Pickerを開く場所の設定: home(マイドライブ直下) / last(前回保存したフォルダ) / fixed(指定フォルダ) */
const START_KEY = "apdf_drive_start_v1";
export const getStart = () => ({ mode: "home", id: "", name: "", ...(ls((l) => JSON.parse(l.getItem(START_KEY) || "null")) || {}) });
export const setStart = (v) => ls((l) => l.setItem(START_KEY, JSON.stringify(v)));
function startParent() {
  const st = getStart();
  if (st.mode === "fixed" && st.id) return st.id;
  if (st.mode === "last") {
    const last = ls((l) => JSON.parse(l.getItem("apdf_drive_folder_v1") || "null"));
    if (last?.id) return last.id;
  }
  return "root";
}

function openPicker(buildView, { title }) {
  return new Promise(async (resolve, reject) => {
    try {
      const cfg = getConfig();
      if (!cfg.apiKey) throw new Error("ファイル選択には「設定」でAPIキーの入力が必要です");
      const t = await getToken();
      await loadPicker();
      const b = new google.picker.PickerBuilder()
        .setOAuthToken(t)
        .setDeveloperKey(cfg.apiKey)
        .setTitle(title)
        .setLocale("ja")
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES) // 共有ドライブも選べる
        .addView(buildView(startParent()))
        .setCallback((d) => {
          if (d.action === google.picker.Action.PICKED) resolve(d.docs[0]);
          else if (d.action === google.picker.Action.CANCEL) resolve(null);
        });
      if (cfg.appId) b.setAppId(cfg.appId);
      b.build().setVisible(true);
    } catch (e) {
      reject(e);
    }
  });
}

export const pickPdf = () =>
  openPicker((parent) => new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes("application/pdf").setIncludeFolders(true).setEnableDrives(true).setParent(parent), { title: "Google ドライブから PDF を選択" });

export const pickFolder = () =>
  openPicker(
    (parent) => new google.picker.DocsView(google.picker.ViewId.FOLDERS).setSelectFolderEnabled(true).setEnableDrives(true).setParent(parent).setMimeTypes("application/vnd.google-apps.folder"),
    { title: "保存先のフォルダを選択" },
  );

export async function downloadFile(id) {
  const meta = await (await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,modifiedTime,size,parents`)).json();
  const r = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return { id, name: meta.name, modifiedTime: meta.modifiedTime, parents: meta.parents || [], bytes: new Uint8Array(await r.arrayBuffer()) };
}

/** このアプリで開いた/保存した PDF の一覧(drive.file スコープの範囲。別端末で保存した分も出る) */
export async function listDriveFiles(pageSize = 30) {
  const q = encodeURIComponent("mimeType='application/pdf' and trashed=false");
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime%20desc&pageSize=${pageSize}&fields=files(id,name,modifiedTime,size)`);
  return (await r.json()).files || [];
}

export function multipartBody(metadata, bytes, mime, boundary = "apdf" + Math.random().toString(36).slice(2)) {
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return { body: new Blob([head, bytes, tail]), contentType: `multipart/related; boundary=${boundary}` };
}

/** 新規作成(fileId なし)または上書き(fileId あり)。戻り値: { id, name, modifiedTime } */
export async function uploadPdf({ name, bytes, fileId, folderId }) {
  const metadata = fileId ? { name } : { name, mimeType: "application/pdf", ...(folderId ? { parents: [folderId] } : {}) };
  const { body, contentType } = multipartBody(metadata, bytes, "application/pdf");
  const url = fileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,modifiedTime`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime";
  const r = await api(url, { method: fileId ? "PATCH" : "POST", headers: { "Content-Type": contentType }, body });
  return r.json();
}

/* ---------- Gmail ---------- */
const b64url = (bytes) => {
  let s = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64 = (bytes) => b64url(bytes).replace(/-/g, "+").replace(/_/g, "/");
const wrap76 = (s) => s.replace(/(.{76})/g, "$1\r\n");
const enc = (s) => new TextEncoder().encode(s);
const encHeader = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(enc(s))}?=`);
const quoteName = (s) => (/^[\x20-\x7e]*$/.test(s) ? `"${s.replace(/"/g, "")}"` : `=?UTF-8?B?${b64(enc(s))}?=`);

/** RFC 822 メッセージ(添付つき)を作る。戻り値: Uint8Array */
export function buildMime({ to, cc, subject, body, attachments = [], boundary = "apdf" + Math.random().toString(36).slice(2) }) {
  const lines = [];
  lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: ${encHeader(subject)}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push("");
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(wrap76(b64(enc(body || ""))));
  for (const a of attachments) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${a.type || "application/pdf"}; name=${quoteName(a.name)}`);
    lines.push("Content-Transfer-Encoding: base64");
    lines.push(`Content-Disposition: attachment; filename=${quoteName(a.name)}`);
    lines.push("");
    lines.push(wrap76(b64(a.bytes)));
  }
  lines.push(`--${boundary}--`);
  return enc(lines.join("\r\n"));
}

export const MAX_MAIL_BYTES = 24 * 1024 * 1024; // Gmail の上限(約25MB)に余裕を持たせる

export async function sendMail(msg) {
  const total = msg.attachments.reduce((n, a) => n + a.bytes.length, 0);
  if (total > MAX_MAIL_BYTES) throw new Error("添付が大きすぎます(上限 約24MB)。「最小」で最適化するか、Driveの共有リンクを使ってください");
  const raw = b64url(buildMime(msg));
  const r = await api("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  return r.json();
}
