import test from "node:test";
import assert from "node:assert/strict";
import { buildMime, multipartBody, SCOPES } from "../js/google.js";

const dec = (u8) => new TextDecoder().decode(u8);

test("MIME: 日本語の件名・本文・添付ファイル名が正しくエンコードされる", () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); // %PDF-1.7
  const raw = dec(buildMime({ to: "a@example.com", subject: "図面の送付", body: "お世話になっております", attachments: [{ name: "現場図.pdf", bytes }], boundary: "BND" }));
  assert.match(raw, /^To: a@example\.com\r\n/);
  const subj = raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/)[1];
  assert.equal(Buffer.from(subj, "base64").toString("utf8"), "図面の送付");
  const body = raw.split("--BND")[1].split("\r\n\r\n")[1].trim();
  assert.equal(Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"), "お世話になっております");
  assert.match(raw, /Content-Disposition: attachment; filename==\?UTF-8\?B\?/);
  const att = raw.split("--BND")[2].split("\r\n\r\n")[1].trim();
  assert.equal(Buffer.from(att, "base64").toString("latin1"), "%PDF-1.7");
  assert.ok(raw.trimEnd().endsWith("--BND--"));
});

test("MIME: 英数字だけの件名はそのまま、Cc も入る", () => {
  const raw = dec(buildMime({ to: "a@b.c", cc: "d@e.f", subject: "Drawing", body: "x", attachments: [], boundary: "B" }));
  assert.match(raw, /Subject: Drawing\r\n/);
  assert.match(raw, /Cc: d@e\.f/);
});

test("MIME: 長い添付も76文字で折り返される", () => {
  const raw = dec(buildMime({ to: "a@b.c", subject: "s", body: "", attachments: [{ name: "a.pdf", bytes: new Uint8Array(5000).fill(65) }], boundary: "B" }));
  const part = raw.split("--B")[2].split("\r\n\r\n")[1];
  for (const l of part.trim().split("\r\n")) assert.ok(l.length <= 76);
});

test("Drive multipart: メタデータとPDF本体が1つのボディに入る", async () => {
  const { body, contentType } = multipartBody({ name: "x.pdf" }, new Uint8Array([1, 2, 3]), "application/pdf", "BB");
  assert.equal(contentType, "multipart/related; boundary=BB");
  const txt = Buffer.from(await body.arrayBuffer()).toString("latin1");
  assert.match(txt, /"name":"x\.pdf"/);
  assert.match(txt, /Content-Type: application\/pdf/);
  assert.ok(txt.endsWith("--BB--"));
});

test("OAuthスコープは最小権限(drive.file と gmail.send のみ)", () => {
  assert.deepEqual(SCOPES.split(" ").sort(), [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/gmail.send",
  ]);
});

test("Google設定: 手入力 > サーバー配布 > 空", async () => {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => (store[k] = v) };
  const G = await import("../js/google.js?cfg");
  assert.equal(G.isConfigured(), false);
  store.apdf_google_srv_v1 = JSON.stringify({ clientId: "srv.apps", apiKey: "K", appId: "123" });
  assert.equal(G.getConfig().clientId, "srv.apps");
  assert.equal(G.serverProvided(), true);
  G.setConfig({ clientId: "", apiKey: "", appId: "" }); // 空欄保存は配布値を消さない
  assert.equal(G.getConfig().apiKey, "K");
  G.setConfig({ clientId: "mine.apps", apiKey: "", appId: "" });
  assert.equal(G.getConfig().clientId, "mine.apps");
});
