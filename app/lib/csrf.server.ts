/**
 * Why a mutating request was refused. `no_origin` and `origin_mismatch` mean the browser reached us by an address other than PUBLIC_ORIGIN (a second host name,
 * http instead of https, a proxy that rewrites the Host); `no_session` means the session cookie never came back (blocked, or a Secure cookie dropped over http);
 * `bad_token` is the ordinary stale form (another tab signed in or out). The page says what to do for the first three; the log says which one it was.
 */
export type RefusalReason = "no_origin" | "origin_mismatch" | "no_session" | "bad_token";

const lastLogged = new Map<RefusalReason, { at: number; suppressed: number }>();
const LOG_EVERY_MS = 10_000;
/** For tests: forget what was logged, so one test's refusals do not hold back another's. */
export const resetRefusalLog = (): void => lastLogged.clear();

/** One line of JSON per reason per 10 seconds (a flood of refused posts must not flood the log); only the origin the browser sent and the one we expect, never a cookie or a token. */
export function logRefusal(reason: RefusalReason, seen: string | null, expected: string, now = Date.now()): void {
  const last = lastLogged.get(reason);
  if (last && now - last.at < LOG_EVERY_MS) { last.suppressed++; return; }
  // eslint-disable-next-line no-control-regex -- control characters are removed from a value the browser chose, before it goes into a log
  const shown = seen === null ? null : seen.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120);
  console.warn(JSON.stringify({ event: "request_refused", reason, seenOrigin: shown, expectedOrigin: expected, suppressed: last?.suppressed ?? 0 }));
  lastLogged.set(reason, { at: now, suppressed: 0 });
}

/** The 403 for a reason. The body is the reason code for the causes the visitor can act on (the error page reads it), "Forbidden" for a stale form. */
export function refusal(reason: RefusalReason): Response {
  return new Response(reason === "bad_token" ? "Forbidden" : reason, { status: 403, headers: { "Cache-Control": "no-store" } });
}

/**
 * Same-origin check for every mutating request (POST/PUT/PATCH/DELETE).
 * The per-session CSRF token is added in the auth slice and checked here as well.
 * Rejects when Origin (or, absent that, Referer) does not match the public origin.
 */
export function assertSameOrigin(request: Request, publicOrigin: string): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const origin = request.headers.get("origin");
  let actual: string | null = origin;
  if (!actual) {
    const referer = request.headers.get("referer");
    try {
      actual = referer ? new URL(referer).origin : null;
    } catch {
      actual = null;
    }
  }
  if (!actual || actual !== publicOrigin) {
    const reason: RefusalReason = actual ? "origin_mismatch" : "no_origin";
    logRefusal(reason, actual, publicOrigin);
    throw refusal(reason);
  }
}

const SAFE_BASE = "http://safe-next.invalid";

/**
 * Only same-site, relative paths are allowed as `?next=` / `redirectTo` targets.
 * Rejects any control character, space or backslash anywhere (browsers strip tabs/newlines and treat `\` as `/`,
 * so "/\t/evil.example" would become "//evil.example"), and double-checks by resolving the value:
 * it must stay on the same origin and is returned as pathname+search+hash.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  // eslint-disable-next-line no-control-regex -- matching control characters is the point of this check
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\u0000-\u0020\u007f-\u00a0\\]|\s/.test(next)) return fallback;
  try {
    const u = new URL(next, SAFE_BASE);
    if (u.origin !== SAFE_BASE) return fallback;
    const out = u.pathname + u.search + u.hash;
    return out.startsWith("//") ? fallback : out;
  } catch {
    return fallback;
  }
}
