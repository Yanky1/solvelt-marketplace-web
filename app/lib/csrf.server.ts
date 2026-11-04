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

/** Only relative, same-site paths are allowed as `?next=` targets. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n\\]/.test(next)) {
    return fallback;
  }
  return next;
}
