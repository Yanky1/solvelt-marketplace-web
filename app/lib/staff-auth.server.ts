import { data, redirect, type AppLoadContext } from "react-router";
import type { ApiRequestContext } from "./api.server";
import { ApiError } from "./api-client.server";
import { getConfig } from "./config.server";
import { assertSameOrigin, logRefusal, refusal } from "./csrf.server";
import { staffApi, type StaffMe } from "./staff-api.server";
import { clearStaffCookie, newStaffVisitor, readStaffSession, safeStaffNext, staffCookie, staffCsrfTokenFor, staffCsrfValid, type StaffSession } from "./staff-session.server";

/** Every staff response: never stored, never indexed (decision M7W-02). */
export const staffHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

export const staffCtx = (request: Request, context: AppLoadContext, session: StaffSession | null): ApiRequestContext => ({ request, socketAddress: context.socketAddress, sessionToken: session?.token });

/** A staff cookie for a browser that has none yet (it carries the CSRF binding and the passkey challenge of the sign-in page). */
export function ensureStaffVisitor(request: Request): { session: StaffSession; csrf: string; setCookie?: string } {
  const cfg = getConfig();
  const existing = readStaffSession(request, cfg);
  if (existing) return { session: existing, csrf: staffCsrfTokenFor(existing.sid, cfg.sessionCookieSecret) };
  const fresh = newStaffVisitor();
  return { session: fresh, csrf: staffCsrfTokenFor(fresh.sid, cfg.sessionCookieSecret), setCookie: staffCookie(fresh, cfg) };
}

/** Every staff action: the Origin check plus the staff CSRF token of THIS session (a buyer's token does not fit). Throws a 403 Response. */
export function assertStaffCsrf(request: Request, form: FormData): StaffSession {
  const cfg = getConfig();
  assertSameOrigin(request, cfg.publicOrigin);
  const session = readStaffSession(request, cfg);
  if (!session) { logRefusal("no_session", request.headers.get("origin"), cfg.publicOrigin); throw refusal("no_session"); }
  if (!staffCsrfValid(session.sid, form.get("csrf"), cfg.sessionCookieSecret)) { logRefusal("bad_token", request.headers.get("origin"), cfg.publicOrigin); throw refusal("bad_token"); }
  return session;
}

/** A new session id (no fixation) carrying the API's staff token, made right after the passkey was accepted. */
export function signedInCookie(token: string, now = Date.now() / 1000): string {
  return staffCookie({ ...newStaffVisitor(now), token, authAt: Math.floor(now) }, getConfig());
}

export function staffSignInRedirect(request: Request, extra: Record<string, string> = {}): never {
  const u = new URL(request.url);
  throw redirect(`/staff/sign-in?next=${encodeURIComponent(safeStaffNext(u.pathname + u.search))}`, { headers: { ...staffHeaders, ...extra } });
}

/** The signed-in staff member, or a redirect to sign-in (a dead token also clears the cookie). */
export async function requireStaff(request: Request, context: AppLoadContext): Promise<{ session: StaffSession; ctx: ApiRequestContext; me: StaffMe }> {
  const cfg = getConfig();
  const session = readStaffSession(request, cfg);
  if (!session?.token) return staffSignInRedirect(request);
  const ctx = staffCtx(request, context, session);
  try {
    return { session, ctx, me: await staffApi.me(ctx) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return staffSignInRedirect(request, { "Set-Cookie": clearStaffCookie(cfg) });
    throw failStaff(e, request);
  }
}

export const can = (me: StaffMe, permission: string): boolean => me.permissions.includes(permission);

/** 403 when the role lacks the permission (the API would refuse too: this keeps the page from rendering for nothing). */
export function requirePermission(me: StaffMe, permission: string): void {
  if (!can(me, permission)) throw new Response("Your role cannot open this page.", { status: 403, headers: staffHeaders });
}

/** The API refused: a dead token goes to sign-in, a stale passkey check to the confirm page, anything else to an error page. Always throws. */
export function failStaff(e: unknown, request: Request, extra: Record<string, string> = {}): never {
  if (e instanceof Response) throw e;
  if (e instanceof ApiError) {
    if (e.status === 401) return staffSignInRedirect(request, { ...extra, "Set-Cookie": clearStaffCookie(getConfig()) });
    if (e.status === 403 && e.code === "reauthentication_required") throw redirect(`/staff/confirm?next=${encodeURIComponent(safeStaffNext(new URL(request.url).pathname))}`, { headers: { ...staffHeaders, ...extra } });
    if (e.status === 403) throw new Response("Your role cannot do this.", { status: 403, headers: { ...staffHeaders, ...extra } });
    if (e.status === 404) throw new Response("Not found", { status: 404, headers: { ...staffHeaders, ...extra } });
  }
  throw new Response("Service unavailable", { status: 503, headers: { ...staffHeaders, ...extra } });
}

/** A form-level answer: shown on the page, never cached. */
export function staffForm<T extends object>(body: T, status = 200, extra: Record<string, string> = {}) {
  return data(body, { status, headers: { ...staffHeaders, ...extra } });
}

/** What an action tells the person when the API said no (422 fields, 409 conflicts, 429), without echoing anything the API did not say. */
export function apiMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.status === 422 && e.fieldErrors) return Object.values(e.fieldErrors).join(" ");
  if (e.status === 409 || e.status === 429 || e.status === 400) return e.message;
  return null;
}
