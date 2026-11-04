import type { Route } from "./+types/img";
import { IMAGE_WIDTHS } from "~/components/Img";
import { GUID } from "~/lib/catalog.server";

/**
 * /img/:id?w=&h= : the image resize route.
 *
 * The API has no image bytes endpoint yet (the portal serves originals through a signed internal call, CONTRACT.md C1; the Http catalog source brings it), so until
 * then this answers a deterministic placeholder picture of the requested size. It is already the final shape of the route (O-12): it validates the id (a GUID) and
 * the width (from a fixed set), it does not forward anything to the API, and the browser never sees a portal URL. When bytes exist, only the body of `render` changes.
 */
const MAX_HEIGHT = 4000;

function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function placeholderSvg(id: string, w: number, h: number): string {
  const a = hue(id), b = (a + 40) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 35% 82%)"/><stop offset="1" stop-color="hsl(${b} 40% 70%)"/></linearGradient></defs>`
    + `<rect width="${w}" height="${h}" fill="url(#g)"/>`
    + `<g fill="none" stroke="hsl(${a} 30% 30%)" stroke-opacity=".55" stroke-width="${Math.max(2, Math.round(w / 120))}"><rect x="${w * 0.3}" y="${h * 0.3}" width="${w * 0.4}" height="${h * 0.4}" rx="${w * 0.03}"/><circle cx="${w * 0.42}" cy="${h * 0.43}" r="${w * 0.04}"/><path d="M${w * 0.3} ${h * 0.62} l${w * 0.12} -${h * 0.1} l${w * 0.1} ${h * 0.07} l${w * 0.08} -${h * 0.05} l${w * 0.1} ${h * 0.08}"/></g></svg>`;
}

export function loader({ params, request }: Route.LoaderArgs) {
  const id = params.id ?? "";
  const url = new URL(request.url);
  const w = Number(url.searchParams.get("w"));
  const h = Number(url.searchParams.get("h") ?? Math.round(w));
  if (!GUID.test(id)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!(IMAGE_WIDTHS as readonly number[]).includes(w) || !Number.isInteger(h) || h < 1 || h > MAX_HEIGHT) return new Response("Bad request", { status: 400, headers: { "Cache-Control": "no-store" } });
  return new Response(placeholderSvg(id, w, h), {
    headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=3600" },        // security headers (CSP, nosniff) are set once for every response by server.js (W1-17)
  });
}
