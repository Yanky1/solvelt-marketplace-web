import { data, redirect, type AppLoadContext } from "react-router";
import type { ApiRequestContext } from "./api.server";
import { ApiError, api, type ApiUser } from "./api-client.server";
import { getConfig } from "./config.server";
import { assertSameOrigin } from "./csrf.server";
import { csrfTokenFor, csrfValid, newVisitor, readSession, sessionCookie, type SessionData } from "./session.server";

export interface RequestAuth {
  /** Existing valid session cookie, if any. */
  session: SessionData | null;
}

export const apiCtx = (request: Request, context: AppLoadContext, session: SessionData | null): ApiRequestContext => ({
  request,
  socketAddress: context.socketAddress,
  sessionToken: session?.token,
});

/** Current user for a request, or null. A 401 means the token is dead (caller should clear it); other errors mean "unknown". */
export async function currentUser(request: Request, context: AppLoadContext): Promise<{ user: ApiUser | null; expired: boolean }> {
  const session = readSession(request, getConfig());
  if (!session?.token) return { user: null, expired: false };
  try {
    return { user: await api.me(apiCtx(request, context, session)), expired: false };
  } catch (e) {
    return { user: null, expired: e instanceof ApiError && e.status === 401 };
  }
}

/** Visitor session (cookie value + CSRF token) for the document: reuse the cookie or mint a new one. */
export function ensureVisitor(request: Request, expired = false): { session: SessionData; csrf: string; setCookie?: string } {
  const cfg = getConfig();
  const existing = readSession(request, cfg);
  if (existing && !expired) return { session: existing, csrf: csrfTokenFor(existing.sid, cfg.sessionCookieSecret) };
  const fresh = newVisitor();
  return { session: fresh, csrf: csrfTokenFor(fresh.sid, cfg.sessionCookieSecret), setCookie: sessionCookie(fresh, cfg) };
}

/** Every mutating action: Origin check plus the per-session CSRF token from the form. Throws a 403 Response. */
export function assertCsrf(request: Request, form: FormData): SessionData {
  const cfg = getConfig();
  assertSameOrigin(request, cfg.publicOrigin);
  const session = readSession(request, cfg);
  if (!session || !csrfValid(session.sid, form.get("csrf"), cfg.sessionCookieSecret)) throw new Response("Forbidden", { status: 403 });
  return session;
}

/** New session id after sign-in or sign-out (prevents session fixation); optionally carries the API token. */
export function rotatedCookie(token?: string): string {
  const cfg = getConfig();
  const fresh = newVisitor();
  return sessionCookie(token ? { ...fresh, token } : fresh, cfg);
}

/** Redirect to sign-in for pages that need an account, keeping a safe return path. */
export function signInRedirect(request: Request): never {
  const u = new URL(request.url);
  throw redirect(`/sign-in?next=${encodeURIComponent(u.pathname + u.search)}`);
}

export const privateHeaders = { "Cache-Control": "private, no-store" } as const;

export function formError<T extends object>(body: T, status = 400) {
  return data(body, { status, headers: privateHeaders });
}

/** Pages that need an account: a request context carrying the session token, or a redirect to sign-in. */
export function requireAccount(request: Request, context: AppLoadContext): { session: SessionData; ctx: ApiRequestContext } {
  const session = readSession(request, getConfig());
  if (!session?.token) signInRedirect(request);
  return { session, ctx: apiCtx(request, context, session) };
}

/** Maps an API failure on an account page: dead session -> sign-in, unknown/foreign resource -> 404, anything else -> 503. */
export function failAccount(e: unknown, request: Request): never {
  if (e instanceof Response) throw e;
  if (e instanceof ApiError) {
    if (e.status === 401) signInRedirect(request);
    if (e.status === 404) throw new Response("Not found", { status: 404 });
  }
  throw new Response("Service unavailable", { status: 503 });
}
