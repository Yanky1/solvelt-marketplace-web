import type { Route } from "./+types/sitemaps.child";
import { xmlResponse } from "./sitemap";
import { apiCtx } from "~/lib/auth.server";
import { catalog } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { buildSitemap, lastmod, pageFromFile, pathFor, SITEMAP_KINDS, SITEMAP_PAGE_SIZE, type SitemapKind } from "~/lib/sitemap";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** `/sitemaps/static/1.xml` (the pages that are not catalog data) and `/sitemaps/{listings|categories|brands}/{n}.xml` (one page of the API's list, newest change first as the API gives it). */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const origin = getConfig().publicOrigin;
  const kind = params.kind ?? "", page = pageFromFile(params.file ?? "");
  if (page === null) return notFound();
  if (kind === "static") return page === 1 ? xmlResponse(request, buildSitemap(origin, ["/", "/categories"])) : notFound();
  if (!(SITEMAP_KINDS as readonly string[]).includes(kind)) return notFound();
  try {
    const data = await catalog.sitemap(apiCtx(request, context, null), kind, page, SITEMAP_PAGE_SIZE);
    if (!data || (page > 1 && data.items.length === 0)) return notFound();
    const entries = data.items.map((e) => ({ path: pathFor(kind as SitemapKind, e.key), lastmod: e.lastModified }));
    const newest = data.items.map((e) => lastmod(e.lastModified)).filter((d): d is string => !!d).sort().at(-1) ?? null;
    return xmlResponse(request, buildSitemap(origin, entries), newest);
  } catch {
    return new Response("Service unavailable", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } });
  }
}
