import { isIP } from "node:net";

/**
 * The relying-party id must be the site's own hostname or a parent domain of it (that is what browsers allow).
 * We never forward options whose rp id points elsewhere: a mismatch means a misconfigured or hostile API.
 * Limitation: without the public-suffix list we only refuse single-label ids (`com`) and IPs, not `co.uk`.
 */
export function rpIdAllowed(rpId: string, publicOrigin: string): boolean {
  let host: string;
  try { host = new URL(publicOrigin).hostname.toLowerCase(); } catch { return false; }
  const rp = rpId.toLowerCase();
  if (!rp || rp !== rpId.trim().toLowerCase()) return false;
  if (rp === host) return true;
  if (isIP(rp) || isIP(host.replace(/^\[|\]$/g, ""))) return false;
  return rp.includes(".") && /^[a-z0-9.-]+$/.test(rp) && host.endsWith(`.${rp}`);
}

export type Ceremony = "create" | "get";

/**
 * Checks and normalises WebAuthn options before they are forwarded to the browser.
 * The browser reads `rp.id` for registration (creation options) and `rpId` for sign-in (request options), so the
 * check applies to the field the ceremony actually uses. If BOTH are present and differ the options are refused,
 * and the field the ceremony does not use is removed, so nothing unchecked reaches the browser.
 * Returns null (refuse) when the used id is not our own hostname or a parent domain of it. An absent id is fine
 * (the browser then uses the page's host).
 */
export function sanitizePasskeyOptions(kind: Ceremony, options: Record<string, unknown>, publicOrigin: string): Record<string, unknown> | null {
  if (typeof options !== "object" || options === null || Array.isArray(options)) return null;
  const rp = options.rp;
  if (rp !== undefined && (typeof rp !== "object" || rp === null || Array.isArray(rp))) return null;
  const creationId = rp === undefined ? undefined : (rp as { id?: unknown }).id;
  const requestId = options.rpId;
  const lower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : v);
  // Host names are case-insensitive: compare in lower case, and forward the lower-case form.
  if (creationId !== undefined && requestId !== undefined && lower(creationId) !== lower(requestId)) return null;
  const used = kind === "create" ? creationId : requestId;
  if (used !== undefined && (typeof used !== "string" || !rpIdAllowed(used, publicOrigin))) return null;
  const out: Record<string, unknown> = { ...options };
  if (kind === "create") {
    delete out.rpId;
    if (typeof used === "string") out.rp = { ...(rp as object), id: used.toLowerCase() };
  } else {
    delete out.rp;
    if (typeof used === "string") out.rpId = used.toLowerCase();
  }
  return out;
}

/** Only ids shaped like our API's opaque ids ever reach an API path (".." and "." would be normalised by fetch). */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isSafeId = (id: unknown): id is string => typeof id === "string" && SAFE_ID.test(id);
