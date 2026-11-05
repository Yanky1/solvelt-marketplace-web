import type { Route } from "./+types/error-ref";
import { clearRefCookie, refFromCookieHeader } from "~/lib/error-ref.server";
import { getConfig } from "~/lib/config.server";

/**
 * The error page asks here, once, after it has hydrated: it returns the reference the failed request left in the HttpOnly `sl_ref` cookie and clears the cookie (decision M8W-03).
 * GET only, no data of the buyer, never cached. A request with no cookie gets `{ ref: null }`.
 */
export function loader({ request }: Route.LoaderArgs) {
  const ref = refFromCookieHeader(request.headers.get("cookie")) ?? null;
  const headers = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
  if (ref) headers.append("Set-Cookie", clearRefCookie(getConfig().publicOrigin.startsWith("https://")));
  return new Response(JSON.stringify({ ref }), { headers });
}
