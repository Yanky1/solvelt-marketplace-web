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
  /** When the user last proved who they are (password or passkey sign-in), unix seconds. Missing = never in this session. */
  authAt?: number;
  /** The one passkey challenge this session may complete: binds the API's challenge to this browser session. */
  pk?: PasskeyBinding;
  /** Wrong passwords entered on the confirm page in this session. At MAX_CONFIRM_FAILURES the session is ended. */
  rf?: number;
}

export interface PasskeyBinding {
  /** The API's challenge id. */
  cid: string;
  kind: "create" | "get";
  /** Expiry, unix seconds. */
  exp: number;
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
    if (d.authAt !== undefined && typeof d.authAt !== "number") return null;
    if (d.rf !== undefined && (typeof d.rf !== "number" || !Number.isInteger(d.rf) || d.rf < 0 || d.rf > 1000)) return null;
    const pk = d.pk;
    if (pk !== undefined && (typeof pk !== "object" || pk === null || typeof pk.cid !== "string" || typeof pk.exp !== "number" || (pk.kind !== "create" && pk.kind !== "get"))) return null;
    if (now - d.iat > MAX_AGE_SECONDS) return null;
    const out: SessionData = { sid: d.sid, iat: d.iat };
    if (d.token !== undefined) out.token = d.token;
    if (d.authAt !== undefined) out.authAt = d.authAt;
    if (pk !== undefined) out.pk = { cid: pk.cid, kind: pk.kind, exp: pk.exp };
    if (d.rf !== undefined) out.rf = d.rf;
    return out;
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

/** Passkey options are issued for exactly one challenge per session; a newer one replaces an older one. */
export function bindPasskeyChallenge(session: SessionData, cid: string, kind: PasskeyBinding["kind"], timeoutMs: unknown, now = Date.now() / 1000): SessionData {
  const ms = typeof timeoutMs === "number" && timeoutMs > 0 ? Math.min(timeoutMs, 300_000) : 60_000;
  return { ...session, pk: { cid, kind, exp: Math.floor(now + ms / 1000) + 5 } };
}

export type ChallengeCheck = { ok: true } | { ok: false; reason: "none" | "mismatch" | "kind" | "expired" };

/** Does this session own that challenge, for that ceremony, and is it still fresh? (Single use: callers then drop `pk`.) */
export function checkPasskeyChallenge(session: SessionData, cid: unknown, kind: PasskeyBinding["kind"], now = Date.now() / 1000): ChallengeCheck {
  const b = session.pk;
  if (!b) return { ok: false, reason: "none" };
  if (typeof cid !== "string" || cid.length === 0 || cid.length > 200 || b.cid.length !== cid.length || !timingSafeEqual(Buffer.from(b.cid), Buffer.from(cid))) return { ok: false, reason: "mismatch" };
  if (b.kind !== kind) return { ok: false, reason: "kind" };
  if (now >= b.exp) return { ok: false, reason: "expired" };
  return { ok: true };
}

export const withoutPasskeyChallenge = (session: SessionData): SessionData => {
  const { pk: _pk, ...rest } = session;
  void _pk;
  return rest;
};

/** Signed in recently enough for sensitive changes (removing a passkey, changing the password)? */
export const RECENT_AUTH_SECONDS = 600;
export const hasRecentAuth = (session: SessionData, now = Date.now() / 1000, windowSeconds = RECENT_AUTH_SECONDS): boolean =>
  !!session.token && typeof session.authAt === "number" && now - session.authAt >= 0 && now - session.authAt < windowSeconds;

/** Wrong passwords tolerated on the confirm page before the session is ended (the API also limits per account). */
export const MAX_CONFIRM_FAILURES = 5;
