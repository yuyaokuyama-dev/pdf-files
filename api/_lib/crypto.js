// Builds と同じ方式: PBKDF2-SHA256 / 120,000回 / 32バイト / ソルト16バイト(16進)。
import { pbkdf2, randomBytes, randomInt, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2p = promisify(pbkdf2);
const ITERATIONS = 120_000;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await pbkdf2p(password, salt, ITERATIONS, 32, "sha256");
  return { salt: salt.toString("hex"), hash: hash.toString("hex") };
}

export async function verifyPassword(password, saltHex, hashHex) {
  try {
    const derived = await pbkdf2p(password, Buffer.from(saltHex, "hex"), ITERATIONS, 32, "sha256");
    const expected = Buffer.from(String(hashHex).toLowerCase(), "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export const generateResetCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const hashResetToken = (t) => createHash("sha256").update(t).digest("hex");

// ログイン用トークン(Builds と同形式: base64url(JSON).HMAC-SHA256)
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function signAuthToken(email, secret, now = Date.now()) {
  const payload = { v: 1, email: String(email).trim().toLowerCase(), exp: now + TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyAuthToken(token, secret, now = Date.now()) {
  const parts = String(token).split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (p.v !== 1 || typeof p.email !== "string" || typeof p.exp !== "number" || p.exp < now) return null;
    return p.email.trim().toLowerCase();
  } catch {
    return null;
  }
}
