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
    throw new Response("Forbidden", { status: 403 });
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
