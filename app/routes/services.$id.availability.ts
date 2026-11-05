import { data } from "react-router";
import type { Route } from "./+types/services.$id.availability";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import { readSession } from "~/lib/session.server";
import { getConfig } from "~/lib/config.server";

/** The query the availability API understands: nothing else is forwarded. */
const ALLOWED = ["location", "from", "to", "postalCode", "lat", "lng", "providerId", "minutes", "addOns"] as const;

/**
 * Times a service can be booked, for the widget on the service page (a browser GET; public data, so no session is needed and none is required). The API's own cache header is kept on a
 * good answer (15 s); every failure is `no-store` and carries only a short code the widget can show, never the API's text.
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  if (!isSafeId(params.id)) throw data("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const src = new URL(request.url).searchParams;
  const q = new URLSearchParams();
  for (const k of ALLOWED) { const v = src.get(k); if (v !== null && v.length <= 200) q.set(k, v); }
  try {
    const session = readSession(request, getConfig());
    const result = await api.serviceAvailability(apiCtx(request, context, session), params.id, q.toString());
    return data(result, { headers: { "Cache-Control": "public, max-age=15" } });
  } catch (e) {
    const status = e instanceof ApiError && (e.status === 404 || e.status === 422) ? e.status : 503;
    const code = e instanceof ApiError && /^[a-z_]{3,40}$/.test(e.code) ? e.code : "availability_unavailable";
    return data({ code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
