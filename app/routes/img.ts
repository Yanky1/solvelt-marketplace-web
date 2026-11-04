import type { Route } from "./+types/img";
import { IMAGE_WIDTHS } from "~/components/Img";
import { apiCtx } from "~/lib/auth.server";
import { catalog, GUID } from "~/lib/catalog.server";
import { ImageError, negotiateFormat, resizeCache, resizeImage, resizeLimiter, type Resized } from "~/lib/img.server";

/**
 * `/img/:id?w=&h=`: a resized copy of a catalog image.
 *
 * What it accepts (O-12): the id must be a GUID, the width one of the fixed IMAGE_WIDTHS, the height (optional) a whole number up to 4000. Nothing else from the
 * address reaches anything: the original is fetched from the API by a typed call whose path is made of the checked id only (`catalog.image`), never from a URL
 * the visitor gave. The browser never sees a portal address.
 *
 * What it answers: WebP for browsers that accept it and JPEG for the rest (`Vary: Accept`), the picture's own shape inside the box and never larger than the
 * original, no metadata. An unknown or hidden image is a 404, an original we cannot use a 502, a busy or unavailable service a 503 with `Retry-After`. Copies are
 * kept in memory for an hour (and shared by identical requests), and sent with `Cache-Control: public, max-age=3600` and a validator, so an image of a listing that
 * has just been unlisted can be seen for up to about an hour more (decision W2-24).
 */
const MAX_HEIGHT = 4000;
const CACHE = "public, max-age=3600";
const noStore = { "Cache-Control": "no-store" } as const;

class Missing extends Error {}
class Down extends Error {}

const text = (status: number, message: string, extra: Record<string, string> = {}) => new Response(message, { status, headers: { ...noStore, ...extra } });
const matches = (header: string | null, etag: string) => (header ?? "").split(",").some((t) => t.trim().replace(/^W\//, "") === etag);

function headersFor(r: Resized): Record<string, string> {
  return { "Content-Type": r.contentType, "Cache-Control": CACHE, ETag: r.etag, Vary: "Accept", "Content-Disposition": "inline" };      // nosniff and the CSP come from server.js for every response
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = (params.id ?? "").toLowerCase();
  if (!GUID.test(id)) return text(404, "Not found");
  const url = new URL(request.url);
  const wParam = url.searchParams.get("w"), hParam = url.searchParams.get("h");
  // plain digits only: "1e3", "0320", "3.2e2" or " 320" are not spellings of a size, so one picture has one address
  if (wParam === null || !/^[1-9]\d{0,4}$/.test(wParam) || (hParam !== null && !/^[1-9]\d{0,3}$/.test(hParam))) return text(400, "Bad request");
  const w = Number(wParam), h = hParam === null ? undefined : Number(hParam);
  if (!(IMAGE_WIDTHS as readonly number[]).includes(w) || (h !== undefined && h > MAX_HEIGHT)) return text(400, "Bad request");
  const format = negotiateFormat(request.headers.get("accept"));
  const key = `${id}:${w}:${h ?? ""}:${format}`;

  const cached = resizeCache.peek(key);
  if (cached && matches(request.headers.get("if-none-match"), cached.etag)) return new Response(null, { status: 304, headers: headersFor(cached) });

  try {
    const resized = await resizeCache.get(key, async () => {
      const original = await catalog.image(apiCtx(request, context, null), id);
      if (original.kind === "notFound") throw new Missing();
      if (original.kind === "unavailable") throw new Down();
      if (original.kind === "bad") throw new ImageError("invalid");
      return resizeLimiter.run(() => resizeImage(original.bytes, { width: w, height: h }, format));
    });
    if (matches(request.headers.get("if-none-match"), resized.etag)) return new Response(null, { status: 304, headers: headersFor(resized) });
    return new Response(new Uint8Array(resized.body), { headers: headersFor(resized) });
  } catch (e) {
    if (e instanceof Missing) return text(404, "Not found");
    if (e instanceof Down || (e instanceof ImageError && e.reason === "busy")) return text(503, "Images are temporarily unavailable", { "Retry-After": "30" });
    if (e instanceof ImageError) return text(502, "This image cannot be shown");
    throw e;
  }
}
