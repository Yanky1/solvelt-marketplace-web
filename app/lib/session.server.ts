import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config.server";

/**
 * The browser only ever holds a sealed (AES-256-GCM) cookie. Inside: a random session id `sid` (CSRF binding)
 * and, once signed in, the API's opaque session token. The token is never sent to browser JS or rendered in HTML.
 */
export interface SessionData {
  sid: string;
  /** Opaque API session token (only after sign-in). */
  token?: string;
  /** Issued-at, unix seconds. */
  iat: number;
}

const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const derive = (secret: string, label: string) => Buffer.from(hkdfSync("sha256", secret, "solvelt-web-v1", label, 32));
const b64 = (b: Buffer) => b.toString("base64url");

export function seal(data: SessionData, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(secret, "session-cookie"), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return b64(Buffer.concat([iv, cipher.getAuthTag(), ct]));
}

export function open(value: string, secret: string, now = Date.now() / 1000): SessionData | null {
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 12 + 16 + 2) return null;
    const decipher = createDecipheriv("aes-256-gcm", derive(secret, "session-cookie"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    const d = JSON.parse(json) as Partial<SessionData>;
    if (typeof d.sid !== "string" || d.sid.length < 16 || typeof d.iat !== "number") return null;
    if (d.token !== undefined && typeof d.token !== "string") return null;
    if (now - d.iat > MAX_AGE_SECONDS) return null;
    return d.token === undefined ? { sid: d.sid, iat: d.iat } : { sid: d.sid, token: d.token, iat: d.iat };
  } catch {
    return null;
  }
}

export const newSid = () => b64(randomBytes(24));
export const newVisitor = (now = Date.now() / 1000): SessionData => ({ sid: newSid(), iat: Math.floor(now) });

/** Per-session CSRF token: HMAC of the session id under a key derived separately from the cookie key. */
export function csrfTokenFor(sid: string, secret: string): string {
  return b64(createHmac("sha256", derive(secret, "csrf")).update(`csrf|${sid}`).digest());
}

export function csrfValid(sid: string, token: unknown, secret: string): boolean {
  if (typeof token !== "string" || token.length > 200) return false;
  const expected = Buffer.from(csrfTokenFor(sid, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const cookieName = (cfg: Pick<AppConfig, "publicOrigin">) =>
  cfg.publicOrigin.startsWith("https://") ? "__Host-solvelt_session" : "solvelt_session";

export function readSession(request: Request, cfg: Pick<AppConfig, "publicOrigin" | "sessionCookieSecret">): SessionData | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = cookieName(cfg);
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return open(part.slice(i + 1).trim(), cfg.sessionCookieSecret);
  }
  return null;
}

export function sessionCookie(data: SessionData, cfg: Pick<AppConfig, "publicOrigin" | "sessionCookieSecret">): string {
  const secure = cfg.publicOrigin.startsWith("https://");
  return `${cookieName(cfg)}=${seal(data, cfg.sessionCookieSecret)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
