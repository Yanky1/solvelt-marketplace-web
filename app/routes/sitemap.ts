import { createHash } from "node:crypto";
import type { Route } from "./+types/sitemap";
import { apiCtx } from "~/lib/auth.server";
import { catalog } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { buildSitemapIndex, childSitemaps, SITEMAP_KINDS, type SitemapKind } from "~/lib/sitemap";

export { buildSitemap } from "~/lib/sitemap";

/** XML with a validator of its own (a hash of the body) so crawlers can ask "has it changed?" and get a 304. Sitemaps carry no visitor data and no cookie. */
export function xmlResponse(request: Request, body: string, lastModified?: string | null): Response {
  const etag = `"${createHash("sha256").update(body).digest("base64url").slice(0, 22)}"`;
  const headers: Record<string, string> = { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=300", ETag: etag };
  if (lastModified) headers["Last-Modified"] = new Date(lastModified).toUTCString();
  const sent = (request.headers.get("if-none-match") ?? "").split(",").map((t) => t.trim().replace(/^W\//, ""));
  if (sent.includes(etag)) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : body, { headers });
}

const unavailable = () => new Response("Service unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });

/** `/sitemap.xml`: the index of the child sitemaps (`/sitemaps/:kind/:n.xml`). It needs only each kind's total, so it asks for one entry. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const origin = getConfig().publicOrigin;
  const ctx = apiCtx(request, context, null);
  try {
    const totals = {} as Record<SitemapKind, number>;
    for (const kind of SITEMAP_KINDS) totals[kind] = (await catalog.sitemap(ctx, kind, 1, 1))?.total ?? 0;
    return xmlResponse(request, buildSitemapIndex(origin, childSitemaps(totals)));
  } catch {
    return unavailable();
  }
}
