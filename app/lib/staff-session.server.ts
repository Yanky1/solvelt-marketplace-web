import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config.server";
import { newSid, type PasskeyBinding } from "./session.server";

/**
 * The staff area has its OWN session cookie (decision M7W-01). It is sealed under a key derived with a label of its own (`staff-session-cookie`), so a buyer cookie can never be opened as a
 * staff one nor the reverse (AES-GCM refuses it), and its CSRF token is derived under another label (`staff-csrf`) so a buyer's CSRF token is worthless on a staff form. The API token inside is a
 * staff token (`stf_…`), which the API refuses on every buyer endpoint. The cookie is `SameSite=Strict`, HttpOnly, Secure, lives at most 8 hours (the API's own absolute limit), and is never read
 * outside `/staff`.
 */
export interface StaffSession {
  sid: string;
  /** Opaque staff API token (only after sign-in or enrolment). */
  token?: string;
  iat: number;
  /** The last passkey check the API accepted for this session, unix seconds (the API is the authority; this only decides whether to ask). */
  authAt?: number;
  /** The one passkey challenge this browser session may complete. */
  pk?: PasskeyBinding;
}

export const STAFF_MAX_AGE_SECONDS = 60 * 60 * 8;

const derive = (secret: string, label: string) => Buffer.from(hkdfSync("sha256", secret, "solvelt-web-v1", label, 32));
const b64 = (b: Buffer) => b.toString("base64url");

export function sealStaff(data: StaffSession, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derive(secret, "staff-session-cookie"), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
  return b64(Buffer.concat([iv, cipher.getAuthTag(), ct]));
}

export function openStaff(value: string, secret: string, now = Date.now() / 1000): StaffSession | null {
  try {
    const raw = Buffer.from(value, "base64url");
    if (raw.length < 12 + 16 + 2) return null;
    const decipher = createDecipheriv("aes-256-gcm", derive(secret, "staff-session-cookie"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const d = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Partial<StaffSession>;
    if (typeof d.sid !== "string" || d.sid.length < 16 || typeof d.iat !== "number") return null;
    if (d.token !== undefined && (typeof d.token !== "string" || !d.token.startsWith("stf_"))) return null;   // only a staff token ever lives here
    if (d.authAt !== undefined && typeof d.authAt !== "number") return null;
    const pk = d.pk;
    if (pk !== undefined && (typeof pk !== "object" || pk === null || typeof pk.cid !== "string" || typeof pk.exp !== "number" || (pk.kind !== "create" && pk.kind !== "get"))) return null;
    if (now - d.iat > STAFF_MAX_AGE_SECONDS) return null;
    const out: StaffSession = { sid: d.sid, iat: d.iat };
    if (d.token !== undefined) out.token = d.token;
    if (d.authAt !== undefined) out.authAt = d.authAt;
    if (pk !== undefined) out.pk = { cid: pk.cid, kind: pk.kind, exp: pk.exp };
    return out;
  } catch {
    return null;
  }
}

export const newStaffVisitor = (now = Date.now() / 1000): StaffSession => ({ sid: newSid(), iat: Math.floor(now) });

export function staffCsrfTokenFor(sid: string, secret: string): string {
  return b64(createHmac("sha256", derive(secret, "staff-csrf")).update(`staff-csrf|${sid}`).digest());
}

export function staffCsrfValid(sid: string, token: unknown, secret: string): boolean {
  if (typeof token !== "string" || token.length > 200) return false;
  const expected = Buffer.from(staffCsrfTokenFor(sid, secret));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const staffCookieName = (cfg: Pick<AppConfig, "publicOrigin">) => (cfg.publicOrigin.startsWith("https://") ? "__Host-solvelt_staff" : "solvelt_staff");

export function readStaffSession(request: Request, cfg: Pick<AppConfig, "publicOrigin" | "sessionCookieSecret">): StaffSession | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  const name = staffCookieName(cfg);
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return openStaff(part.slice(i + 1).trim(), cfg.sessionCookieSecret);
  }
  return null;
}

export function staffCookie(data: StaffSession, cfg: Pick<AppConfig, "publicOrigin" | "sessionCookieSecret">): string {
  const secure = cfg.publicOrigin.startsWith("https://");
  return `${staffCookieName(cfg)}=${sealStaff(data, cfg.sessionCookieSecret)}; Path=/; Max-Age=${STAFF_MAX_AGE_SECONDS}; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** Ends the staff cookie (sign-out, a dead token). */
export function clearStaffCookie(cfg: Pick<AppConfig, "publicOrigin">): string {
  const secure = cfg.publicOrigin.startsWith("https://");
  return `${staffCookieName(cfg)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

/** A path inside the staff area, or `/staff`: nothing else is ever a redirect target after sign-in. */
export function safeStaffNext(next: unknown): string {
  if (typeof next !== "string" || next.length > 300) return "/staff";
  if (!next.startsWith("/staff") || next.startsWith("//") || /[\\\r\n]/.test(next)) return "/staff";
  if (next.length > 6 && next[6] !== "/" && next[6] !== "?") return "/staff";
  return next;
}
