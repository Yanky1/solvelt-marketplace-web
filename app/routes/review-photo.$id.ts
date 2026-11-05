import type { Route } from "./+types/review-photo.$id";
import { api } from "~/lib/api-client.server";
import { apiCtx } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";

/**
 * `/review-photo/:id`: a picture of a published review, streamed from the API (which re-encoded it and serves it only while the review is published). The id is checked, no session reaches the API,
 * the answer is typed as the API said for the three image types only and never sniffed. The cache headers are the API's own (public, five minutes, must revalidate, plus its ETag), never longer: a review that is hidden or
 * removed must stop showing its pictures soon. Every request, a revalidation included, asks the API first (it answers 404 once the review is not published), and only then is a matching If-None-Match answered 304 here.
 */
const FALLBACK_CACHE = "public, max-age=300, must-revalidate";
/** The API's header when it is the short revalidating kind we expect; anything else (a longer or missing lifetime) is replaced by the fallback, so this proxy never lengthens what the API allows. */
function cacheControl(upstream: string | null): string {
  const m = /max-age=(\d+)/i.exec(upstream ?? "");
  return upstream && /must-revalidate/i.test(upstream) && m && Number(m[1]) <= 300 && /^[\w=, -]+$/.test(upstream) ? upstream : FALLBACK_CACHE;
}

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function loader({ params, request, context }: Route.LoaderArgs) {
  if (!isSafeId(params.id)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  let res: Response;
  try { res = await api.reviewPhoto(apiCtx(request, context, null), params.id); }
  catch { return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } }); }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
  if (res.status === 404 || !res.ok || !ALLOWED.has(type)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const etag = res.headers.get("etag");
  const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": cacheControl(res.headers.get("cache-control")), "Content-Disposition": "inline" };
  if (etag && /^"[\w-]{1,64}"$/.test(etag)) {
    headers.ETag = etag;
    if (request.headers.get("if-none-match")?.split(",").some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": headers["Cache-Control"]! } });
  }
  return new Response(await res.arrayBuffer(), { status: 200, headers });
}
