import type { Route } from "./+types/wishlists.shared.$key";
import { ListingGrid } from "~/components/ListingGrid";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";

/**
 * A wishlist someone shared with a link (M6). Read-only, anonymous (no session reaches the API), never cached or indexed, and the link is not passed on in a Referer header. A wrong or
 * revoked key is a plain 404: it says nothing about whether the list ever existed.
 */
const hdrs = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
export function headers() {
  return hdrs;
}
export function meta() {
  return [{ title: "Shared wishlist | Solvelt" }, { name: "robots", content: "noindex, nofollow" }, { name: "referrer", content: "no-referrer" }];
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isSafeId(params.key)) throw new Response("Not found", { status: 404, headers: hdrs });
  try {
    return await api.sharedWishlist(apiCtx(request, context, null), params.key);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new Response("Not found", { status: 404, headers: hdrs });
    throw new Response("Service unavailable", { status: 503, headers: hdrs });
  }
}

export default function SharedWishlist({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack">
      <h1>{loaderData.name || "Shared wishlist"}</h1>
      <p className="muted">A list someone shared with you.</p>
      {loaderData.items.length === 0 ? <p>Nothing on this list is available right now.</p> : <ListingGrid items={loaderData.items.map((i) => i.listing)} label={`Items in ${loaderData.name}`} />}
    </div>
  );
}
