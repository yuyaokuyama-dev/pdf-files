import { sharedConfigured } from "../_lib/http.js";

// 共有アカウントが使えるか(使えない環境ではアプリが端末内ログインに切り替わる)
export default function handler(_req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, shared: sharedConfigured(), resetMode: process.env.AUTH_RESET_MODE === "display" ? "display" : "admin" });
}
