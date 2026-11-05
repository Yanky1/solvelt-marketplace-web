import { randomBytes } from "node:crypto";

/**
 * A reference the buyer can read out when something goes wrong ("Reference: ..."), so a report can be found in the logs (decision M8W-03).
 * It is the API's own `X-Correlation-Id` when the API answered with a server fault (the API logs the same id), and an id made here (`W-` + 10 hex) for failures with no API
 * answer (the API is unreachable, a proxy page, a bug in this server). It is opaque and holds nothing about the buyer. One holder per request lives in the load context.
 */
export interface ErrorRefHolder { id?: string }

/** The short-lived cookie that carries the reference to the browser for a failed client-side (single-fetch) request. Not a secret, but HttpOnly all the same (nothing in the page can read or forge it): the error page gets the id from the `/error-ref` resource route, which reads the cookie on the server and clears it. */
export const REF_COOKIE = "sl_ref";
export const REF_COOKIE_SECONDS = 120;

const SAFE = /^[A-Za-z0-9._:-]{4,64}$/;
/** An id from outside (the API's header) is used only when it is plain and short: it ends up in a page and a cookie. */
export const cleanRef = (value: string | null | undefined): string | undefined => (value && SAFE.test(value.trim()) ? value.trim() : undefined);
export const newRef = (): string => `W-${randomBytes(5).toString("hex")}`;

/** A route or API path for a log line: no origin, no query, and every id-like or numeric segment masked, so nothing about a buyer or an order reaches the log. */
export function routePattern(urlOrPath: string): string {
  let path = urlOrPath;
  try { if (/^https?:\/\//i.test(path)) path = new URL(path).pathname; } catch { /* keep as is */ }
  path = path.split("?")[0]!.split("#")[0]!;
  return path.split("/").map((seg) => (/^[0-9a-f-]{8,}$/i.test(seg) || (/\d/.test(seg) && seg.length > 5) ? ":id" : seg)).join("/").slice(0, 120);
}

export interface FailureInfo { source: "api" | "bff"; status: number; code?: string | undefined; route: string; apiRef?: string | undefined; kind?: string | undefined }

/**
 * Records a failure of this request: keeps (or makes) the reference and writes ONE log line with the reference, where the failure came from, the status, a code, the route pattern
 * and, when the API had one, its correlation id. Never a URL with a query string, a header, a body or a name. Returns the reference.
 */
export function noteFailure(holder: ErrorRefHolder | undefined, info: FailureInfo): string {
  const id = holder?.id ?? info.apiRef ?? newRef();
  if (holder && !holder.id) holder.id = id;
  console.error("request failed:", JSON.stringify({ ref: id, source: info.source, status: info.status, code: info.code ?? null, route: info.route, ...(info.apiRef && info.apiRef !== id ? { apiRef: info.apiRef } : {}), ...(info.kind ? { kind: info.kind } : {}) }));
  return id;
}

export const refCookie = (id: string, secure: boolean): string => `${REF_COOKIE}=${id}; Path=/; Max-Age=${REF_COOKIE_SECONDS}; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`;
export const clearRefCookie = (secure: boolean): string => `${REF_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly${secure ? "; Secure" : ""}`;
/** The reference in a Cookie header, if any (cleaned). */
export const refFromCookieHeader = (header: string | null): string | undefined => cleanRef(new RegExp(`(?:^|;\\s*)${REF_COOKIE}=([^;]*)`).exec(header ?? "")?.[1]);
