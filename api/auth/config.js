import { sharedConfigured } from "../_lib/http.js";

// 共有アカウントが使えるか(使えない環境ではアプリが端末内ログインに切り替わる)
export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  const e = process.env;
  // Google連携の公開値(クライアントID/APIキー/プロジェクト番号はブラウザに渡す前提の値。シークレットではない)
  const google = {
    clientId: (e.GOOGLE_CLIENT_ID ?? "").trim(),
    apiKey: (e.GOOGLE_API_KEY ?? "").trim(),
    appId: (e.GOOGLE_APP_ID ?? "").trim(),
  };
  res.status(200).json({ ok: true, shared: sharedConfigured(), resetMode: e.AUTH_RESET_MODE === "display" ? "display" : "admin", google });
}
