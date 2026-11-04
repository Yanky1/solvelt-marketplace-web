import { redirect } from "react-router";
import type { Route } from "./+types/category";
import { JsonLd } from "~/components/JsonLd";
import { ListingsPage } from "~/components/ListingsPage";
import { apiCtx } from "~/lib/auth.server";
import { catalog, catalogErrorResponse, isCatalogKey } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { breadcrumbJsonLd, clipText } from "~/lib/seo";
import { centsAddress, hasFilters, parseListingQuery, toSearchParams, withChange, type CategoryNode } from "~/lib/search";
import { categoryPath } from "~/lib/urls";

/** The node with this slug and the way down to it (roots first), or null. */
function findPath(nodes: CategoryNode[], slug: string, trail: CategoryNode[] = []): CategoryNode[] | null {
  for (const n of nodes) {
    if (n.slug === slug) return [...trail, n];
    const below = findPath(n.children, slug, [...trail, n]);
    if (below) return below;
  }
  return null;
}

/**
 * A category page (/c/:slug): the category's own listings and everything below it, with the same facets, sort and paging as search. Category pages are what
 * search engines index; a page with a filter or a sort is `noindex` and points at the plain page (decision W2-08), so filter combinations never compete.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  if (!isCatalogKey(slug)) throw new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const url = new URL(request.url);
  const dollars = centsAddress(url);
  if (dollars) throw redirect(dollars.pathname + dollars.search);
  const query = parseListingQuery(url.searchParams, { category: slug });
  const base = categoryPath(slug);
  const qs = toSearchParams(query, ["category"]).toString();
  if (url.pathname + url.search !== (qs ? `${base}?${qs}` : base)) throw redirect(qs ? `${base}?${qs}` : base);
  const ctx = apiCtx(request, context, null);
  let tree, data;
  try {
    tree = await catalog.categories(ctx);
    const trail = findPath(tree, slug);
    if (!trail) throw new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    data = await catalog.listings(ctx, query);
    if (data.items.length === 0 && query.page > 1) throw redirect(`${base}?${toSearchParams(withChange(query, { page: Math.max(1, Math.min(data.totalPages, query.page - 1)) }), ["category"]).toString()}`.replace(/\?$/, ""));
    return { query, data, trail: trail.map((n) => ({ slug: n.slug, name: n.name })), node: trail[trail.length - 1]!, origin: getConfig().publicOrigin };
  } catch (e) {
    if (e instanceof Response) throw e;
    throw catalogErrorResponse(e);
  }
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found | Solvelt" }, { name: "robots", content: "noindex" }];
  const { node, query, origin, data: page } = data;
  const plain = hasFilters(query) || !!query.q || !!query.sort;
  const base = origin + categoryPath(node.slug);
  const canonical = !plain && query.page > 1 ? `${base}?page=${query.page}` : base;
  return [
    { title: `${node.name}${query.page > 1 ? ` (page ${query.page})` : ""} | Solvelt` },
    { name: "description", content: clipText(`Shop ${node.name} on Solvelt: ${node.listingCount} ${node.listingCount === 1 ? "listing" : "listings"} from independent sellers.`) },
    { tagName: "link", rel: "canonical", href: canonical },
    ...(plain ? [{ name: "robots", content: "noindex, follow" }] : []),
    ...(!plain && query.page > 1 ? [{ tagName: "link", rel: "prev", href: query.page === 2 ? base : `${base}?page=${query.page - 1}` }] : []),
    ...(!plain && query.page < page.totalPages ? [{ tagName: "link", rel: "next", href: `${base}?page=${query.page + 1}` }] : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Solvelt Market" },
    { property: "og:title", content: `${node.name} | Solvelt` },
    { property: "og:url", content: canonical },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: `${node.name} | Solvelt` },
  ];
}

export default function Category({ loaderData }: Route.ComponentProps) {
  const { query, data, trail, node, origin } = loaderData;
  const crumbs = [{ label: "Home", to: "/" }, ...trail.map((c, i) => (i === trail.length - 1 ? { label: c.name } : { label: c.name, to: categoryPath(c.slug) }))];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, ...trail.map((c) => ({ name: c.name, path: categoryPath(c.slug) }))])} />
      <ListingsPage title={node.name} crumbs={crumbs} data={data} query={query} basePath={categoryPath(node.slug)} fixed={["category"]} categories={node.children} categoriesTitle="In this category" emptyHint="Nothing in this category matches. Try removing a filter." />
    </>
  );
}
