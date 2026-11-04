import { isIP } from "node:net";

/** WebAuthn options as the API sends them: creation options carry `rp.id`, request options `rpId`. */
export function rpIdOf(options: Record<string, unknown>): string | undefined | null {
  const rp = options.rp as { id?: unknown } | undefined;
  const raw = rp && typeof rp === "object" && "id" in rp ? rp.id : options.rpId;
  if (raw === undefined) return undefined;
  return typeof raw === "string" ? raw : null; // null = present but not a string
}

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

/** True when the options may be forwarded to the browser. An absent id is fine (the browser then uses the page's host). */
export function optionsRpIdOk(options: Record<string, unknown>, publicOrigin: string): boolean {
  const id = rpIdOf(options);
  if (id === undefined) return true;
  return id !== null && rpIdAllowed(id, publicOrigin);
}

/** Only ids shaped like our API's opaque ids ever reach an API path (".." and "." would be normalised by fetch). */
export const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isSafeId = (id: unknown): id is string => typeof id === "string" && SAFE_ID.test(id);
