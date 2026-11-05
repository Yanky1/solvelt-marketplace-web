import type { Route } from "./+types/recently-viewed";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, privateHeaders } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { MAX_RECENT } from "~/lib/lists";
import { readSession } from "~/lib/session.server";

/**
 * The signed-in buyer's recently viewed list (M6), called from the browser by the product page ("record") and the shelf ("GET"), and once after sign-in ("merge": the ids the browser kept
 * as a guest; the API stamps the times). Never cached. A guest gets an empty list: guests keep theirs in the browser.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = readSession(request, getConfig());
  if (!session?.token) return json({ signedIn: false, items: [] });
  try {
    return json({ signedIn: true, items: await api.recentlyViewed(apiCtx(request, context, session)) });
  } catch (e) {
    return json({ signedIn: !(e instanceof ApiError && e.status === 401), items: [] });
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  if (!session.token) return json({ error: "Sign in first." }, 401);
  const ctx = apiCtx(request, context, session);
  const intent = String(form.get("intent") ?? "");
  try {
    if (intent === "record") {
      const id = String(form.get("listingId") ?? "");
      if (!isSafeId(id)) return json({ error: "Bad request." }, 400);
      await api.recordViewed(ctx, id);
    } else if (intent === "merge") {
      const ids = String(form.get("ids") ?? "").split(",").map((s) => s.trim()).filter(isSafeId).slice(0, MAX_RECENT);
      if (ids.length) await api.mergeViewed(ctx, ids);
    } else if (intent === "clear") await api.clearViewed(ctx);
    else return json({ error: "Bad request." }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: "Please try again." }, e instanceof ApiError && e.status === 401 ? 401 : e instanceof ApiError && e.status === 404 ? 404 : 503);
  }
}
