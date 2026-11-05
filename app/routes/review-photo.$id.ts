import type { Route } from "./+types/review-photo.$id";
import { api } from "~/lib/api-client.server";
import { apiCtx } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";

/**
 * `/review-photo/:id`: a picture of a published review, streamed from the API (which re-encoded it and serves it only while the review is published). The id is checked, no session reaches the API,
 * the answer is typed as the API said for the three image types only and never sniffed. Cached for an hour (a photo of a review that was just hidden can be seen a little longer).
 */
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isSafeId(params.id)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  let res: Response;
  try { res = await api.reviewPhoto(apiCtx(request, context, null), params.id); }
  catch { return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } }); }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (res.status === 404 || !res.ok || !ALLOWED.has(type)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(await res.arrayBuffer(), { status: 200, headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600", "Content-Disposition": "inline" } });
}
