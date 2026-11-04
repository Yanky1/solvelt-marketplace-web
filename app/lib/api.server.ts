import { resolveClientIp } from "./client-ip.server";
import type { AppConfig } from "./config.server";

/**
 * PLACEHOLDER header name until M1 documents the real one in the API repo's docs/API.md (see DESIGN W1-13).
 * The API must authenticate it (e.g. only accept it together with a server credential).
 */
export const FORWARDED_CLIENT_IP_HEADER = "X-Solvelt-Client-Ip";

export interface ApiRequestContext {
  /** Remote address of the TCP peer, from the server's load context. */
  socketAddress?: string | undefined;
  /** The incoming browser request, used only to read X-Forwarded-For (when the peer is a trusted proxy). */
  request: Request;
  /** Opaque session token from our own cookie; sent as a Bearer header, never to the browser. */
  sessionToken?: string | undefined;
}

export interface ApiCallOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

/** The ONLY function that talks to the marketplace API. Client-supplied forwarding headers are never passed through. */
export async function apiFetch(cfg: Pick<AppConfig, "apiBaseUrl" | "trustedProxies">, ctx: ApiRequestContext, path: string, opts: ApiCallOptions = {}): Promise<Response> {
  const headers = new Headers({ Accept: "application/json" });
  if (opts.body !== undefined) headers.set("Content-Type", "application/json");
  if (ctx.sessionToken) headers.set("Authorization", `Bearer ${ctx.sessionToken}`);
  const ip = resolveClientIp(ctx.socketAddress, ctx.request.headers.get("x-forwarded-for"), cfg.trustedProxies);
  if (ip) headers.set(FORWARDED_CLIENT_IP_HEADER, ip);
  const init: RequestInit = { method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"), headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  if (opts.signal) init.signal = opts.signal;
  return fetch(`${cfg.apiBaseUrl}${path}`, init);
}
