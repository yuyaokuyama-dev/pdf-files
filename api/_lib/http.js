import { AuthError, createService } from "./service.js";
import { createDriveStore } from "./store.js";
import { isShared, readConfig } from "./drive.js";

let svc = null;
export function getService() {
  if (!svc) {
    const store = createDriveStore();
    svc = createService({ store, secret: store.secret, resetMode: process.env.AUTH_RESET_MODE === "display" ? "display" : "admin" });
  }
  return svc;
}

async function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

/** Vercel Node 関数用のラッパ。fn(service, input, authorization) -> 結果 */
export function route(method, fn) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== method) {
      res.setHeader("Allow", method);
      return res.status(405).json({ ok: false, error: "許可されていないメソッドです。" });
    }
    try {
      const result = await fn(getService(), method === "POST" ? await body(req) : {}, req.headers.authorization);
      if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
      return res.status(200).json(result);
    } catch (e) {
      const status = e instanceof AuthError ? e.status : 500;
      return res.status(status).json({ ok: false, error: e instanceof Error ? e.message : "アカウント処理に失敗しました。" });
    }
  };
}

export const sharedConfigured = () => isShared(readConfig());
