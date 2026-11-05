import type { Route } from "./+types/wishlists.panel";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, privateHeaders } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { readSession } from "~/lib/session.server";
import { NAME_MAX } from "~/lib/lists";

/**
 * Data and actions behind the "Save to a list" box of a product page (the page itself is public and carries no session, so the box asks here, from the browser).
 * `GET ?listingId=` -> `{ signedIn, lists: [{ id, name, has }] }`; `POST` (csrf, intent add | remove | create) changes one list. Never cached; a dead session answers `signedIn: false`.
 */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = readSession(request, getConfig());
  const listingId = new URL(request.url).searchParams.get("listingId") ?? "";
  if (!session?.token || !isSafeId(listingId)) return json({ signedIn: false, lists: [] });
  const ctx = apiCtx(request, context, session);
  try {
    const [all, member] = await Promise.all([api.wishlists(ctx), api.wishlistMembership(ctx, listingId)]);
    return json({ signedIn: true, limit: all.limit, lists: all.wishlists.map((w) => ({ id: w.id, name: w.name, has: member.includes(w.id) })) });
  } catch (e) {
    return json({ signedIn: !(e instanceof ApiError && e.status === 401), lists: [], unavailable: true }, 200);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  if (!session.token) return json({ error: "Sign in to save items." }, 401);
  const ctx = apiCtx(request, context, session);
  const intent = String(form.get("intent") ?? "");
  const listingId = String(form.get("listingId") ?? "");
  const wishlistId = String(form.get("wishlistId") ?? "");
  if (!isSafeId(listingId)) return json({ error: "Bad request." }, 400);
  try {
    if (intent === "create") {
      const created = await api.createWishlist(ctx, String(form.get("name") ?? "").slice(0, NAME_MAX * 4));
      if (!created) return json({ error: "Try again." }, 502);
      await api.addWishlistItem(ctx, created.id, listingId);
    } else if (isSafeId(wishlistId) && intent === "add") await api.addWishlistItem(ctx, wishlistId, listingId);
    else if (isSafeId(wishlistId) && intent === "remove") await api.removeWishlistItem(ctx, wishlistId, listingId);
    else return json({ error: "Bad request." }, 400);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return json({ error: "Sign in to save items." }, 401);
      if (e.status === 404) return json({ error: "That item or list is not available." }, 404);
      if (e.status === 409) return json({ error: "You already have a list with that name." }, 409);
      if (e.status === 422) return json({ error: e.fieldErrors?.name ?? (e.code === "list_full" ? "That list is full." : e.code === "too_many_lists" ? "You have reached the limit of lists." : "Check the name and try again.") }, 422);
    }
    return json({ error: "Please try again." }, 503);
  }
}
