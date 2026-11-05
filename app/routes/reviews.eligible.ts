import type { Route } from "./+types/reviews.eligible";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, privateHeaders } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { readSession } from "~/lib/session.server";

/** What the signed-in buyer can still review for a listing (the product page is public and carries no session, so its "Write a review" prompt asks here from the browser). Never cached. */
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = readSession(request, getConfig());
  const listingId = new URL(request.url).searchParams.get("listingId") ?? "";
  if (!session?.token || !isSafeId(listingId)) return json({ signedIn: false, items: [] });
  try {
    return json({ signedIn: true, items: await api.reviewable(apiCtx(request, context, session), listingId) });
  } catch (e) {
    return json({ signedIn: !(e instanceof ApiError && e.status === 401), items: [] });
  }
}
