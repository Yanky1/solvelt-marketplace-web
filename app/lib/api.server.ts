import { ALLOWED_API_HEADERS } from "./api-headers";
import { createHmac } from "node:crypto";
import { resolveClientIp } from "./client-ip.server";
import type { AppConfig } from "./config.server";

/** Contract: API repo docs/API.md (M1, API main 3b48083). All three headers are always sent together. */
export const FORWARDED_CLIENT_IP_HEADER = "X-Solvelt-Client-Ip";
export const FORWARDED_CLIENT_TIMESTAMP_HEADER = "X-Solvelt-Client-Timestamp";
export const FORWARDED_CLIENT_SIGNATURE_HEADER = "X-Solvelt-Client-Signature";

/** `v1=` + lower-hex HMAC-SHA256(key, "<unix seconds>\n<ip>"). */
export function signClientIp(key: string, timestamp: number, ip: string): string {
  return `v1=${createHmac("sha256", key).update(`${timestamp}\n${ip}`).digest("hex")}`;
}

export interface ApiRequestContext {
  /** Remote address of the TCP peer, from the server's load context. Required: without it no forwarding headers can be sent. */
  socketAddress: string;
  /** The incoming browser request, used only to read X-Forwarded-For (when the peer is a trusted proxy). */
  request: Request;
  /** Opaque session token from our own cookie; sent as a Bearer header, never to the browser. */
  sessionToken?: string | undefined;
}

export interface ApiCallOptions {
  method?: string;
  body?: unknown;
  /** A multipart body (a photo upload): sent as it is, with the boundary header the runtime makes. Mutually exclusive with `body`. */
  form?: FormData;
  signal?: AbortSignal;
  /** Extra request headers (for example an idempotency key). Never a client-forwarding or Authorization header: those are set here only. */
  headers?: Record<string, string>;
  /** Unix-seconds clock, injectable for tests. */
  now?: () => number;
}

/** The ONLY function that talks to the marketplace API. Client-supplied forwarding headers are never passed through. */
export async function apiFetch(cfg: Pick<AppConfig, "apiBaseUrl" | "trustedProxies" | "webForwardingKey" | "production">, ctx: ApiRequestContext, path: string, opts: ApiCallOptions = {}): Promise<Response> {
  const headers = new Headers({ Accept: "application/json" });
  for (const [k, v] of Object.entries(opts.headers ?? {})) if (ALLOWED_API_HEADERS.has(k.toLowerCase())) headers.set(k, v);   // an allow-list: nothing else can be injected (the guest cart token is ours, from the sealed cookie)
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  if (ctx.sessionToken) headers.set("Authorization", `Bearer ${ctx.sessionToken}`);
  if (!ctx.socketAddress && !cfg.production) {
    // A route that forgot the load context would silently put every user into one shared API rate-limit bucket.
    throw new Error("apiFetch: socketAddress is missing from the request context (pass context.socketAddress from the loader/action)");
  }
  const ip = resolveClientIp(ctx.socketAddress, ctx.request.headers.get("x-forwarded-for"), cfg.trustedProxies);
  if (ip) {
    const ts = Math.floor((opts.now ?? (() => Date.now() / 1000))());
    headers.set(FORWARDED_CLIENT_IP_HEADER, ip);
    headers.set(FORWARDED_CLIENT_TIMESTAMP_HEADER, String(ts));
    headers.set(FORWARDED_CLIENT_SIGNATURE_HEADER, signClientIp(cfg.webForwardingKey, ts, ip));
  }
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined || opts.form !== undefined ? "POST" : "GET"), headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  else if (opts.form !== undefined) init.body = opts.form;
  if (opts.signal) init.signal = opts.signal;
  return fetch(`${cfg.apiBaseUrl}${path}`, init);
}
