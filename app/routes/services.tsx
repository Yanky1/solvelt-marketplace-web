import { redirect } from "react-router";
import type { Route } from "./+types/services";
import { JsonLd } from "~/components/JsonLd";
import { ListingsPage } from "~/components/ListingsPage";
import { apiCtx } from "~/lib/auth.server";
import { catalog, catalogErrorResponse } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { breadcrumbJsonLd } from "~/lib/seo";
import { centsAddress, hasFilters, parseListingQuery, toSearchParams, withChange } from "~/lib/search";

/**
 * The service listings (/services): a search fixed to the service type, with the same facets, sort, paging and canonical address rules as /search (the path
 * says "service", so `type` is never in the address). The plain page is indexed; any filter, search or sort makes it `noindex` and points at the plain page,
 * as on category pages (decision W2-08).
 */
const BASE = "/services";
const withQuery = (p: URLSearchParams) => (p.size ? `${BASE}?${p.toString()}` : BASE);

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const dollars = centsAddress(url);
  if (dollars) throw redirect(dollars.pathname + dollars.search);
  const query = parseListingQuery(url.searchParams, { type: "service" });
  const canonical = withQuery(toSearchParams(query, ["type"]));
  if (url.pathname + url.search !== canonical) throw redirect(canonical);
  let data;
  try {
    data = await catalog.listings(apiCtx(request, context, null), query);
  } catch (e) {
    throw catalogErrorResponse(e);
  }
  if (data.items.length === 0 && query.page > 1) throw redirect(withQuery(toSearchParams(withChange(query, { page: Math.max(1, Math.min(data.totalPages, query.page - 1)) }), ["type"])));   // past the last page: go back
  return { query, data, categories: data.facets?.categories ?? [], origin: getConfig().publicOrigin };
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: "Services | Solvelt" }, { name: "robots", content: "noindex" }];
  const { query, origin, data: page } = data;
  const plain = hasFilters(query, ["type"]) || !!query.q || !!query.sort;
  const base = origin + BASE;
  const canonical = !plain && query.page > 1 ? `${base}?page=${query.page}` : base;
  return [
    { title: `Services${query.page > 1 ? ` (page ${query.page})` : ""} | Solvelt` },
    { name: "description", content: "Book local services on Solvelt Market: cleaning, repairs and handyman work, lessons and tutoring from independent providers." },
    { tagName: "link", rel: "canonical", href: canonical },
    ...(plain ? [{ name: "robots", content: "noindex, follow" }] : []),
    ...(!plain && query.page > 1 ? [{ tagName: "link", rel: "prev", href: query.page === 2 ? base : `${base}?page=${query.page - 1}` }] : []),
    ...(!plain && query.page < page.totalPages ? [{ tagName: "link", rel: "next", href: `${base}?page=${query.page + 1}` }] : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Solvelt Market" },
    { property: "og:title", content: "Services | Solvelt" },
    { property: "og:url", content: canonical },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: "Services | Solvelt" },
  ];
}

export default function Services({ loaderData }: Route.ComponentProps) {
  const { query, data, categories, origin } = loaderData;
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, { name: "Services", path: BASE }])} />
      <ListingsPage
        title={query.q ? `Services for “${query.q}”` : "Services"}
        intro="Book a local provider: pick a service, a day and a time."
        crumbs={[{ label: "Home", to: "/" }, { label: "Services" }]}
        data={data}
        query={query}
        basePath={BASE}
        fixed={["type"]}
        categories={categories}
        emptyHint="No services match. Try fewer words or remove a filter."
      />
    </>
  );
}
