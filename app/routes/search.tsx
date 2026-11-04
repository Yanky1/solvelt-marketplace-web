import { redirect } from "react-router";
import type { Route } from "./+types/search";
import { ListingsPage } from "~/components/ListingsPage";
import { apiCtx } from "~/lib/auth.server";
import { catalog, catalogErrorResponse } from "~/lib/catalog.server";
import { centsAddress, parseListingQuery, toSearchParams, withChange } from "~/lib/search";

/**
 * Search and browse (/search). The address is the whole state: it is parsed and checked (lib/search), and any spelling other than our canonical one is
 * redirected to it, so a set of results has one address. Search pages are never indexed (decision W2-08); category pages are what search engines get.
 */
const withQuery = (p: URLSearchParams) => (p.size ? `/search?${p.toString()}` : "/search");

export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const dollars = centsAddress(url);
  if (dollars) throw redirect(dollars.pathname + dollars.search);
  const query = parseListingQuery(url.searchParams);
  const canonical = withQuery(toSearchParams(query));
  if (url.pathname + url.search !== canonical) throw redirect(canonical);
  let data;
  try {
    data = await catalog.listings(apiCtx(request, context, null), query);
  } catch (e) {
    throw catalogErrorResponse(e);
  }
  if (data.items.length === 0 && query.page > 1) throw redirect(withQuery(toSearchParams(withChange(query, { page: Math.max(1, Math.min(data.totalPages, query.page - 1)) }))));   // past the last page: go back
  const categories = data.facets?.categories ?? [];
  return { query, data, categories };
}

export function meta({ data }: Route.MetaArgs) {
  const q = data?.query.q;
  return [
    { title: q ? `Results for “${q}” | Solvelt` : "Search | Solvelt" },
    { name: "description", content: "Search kosher food, Judaica, gifts and local services on Solvelt." },
    { name: "robots", content: "noindex, follow" },
  ];
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { query, data, categories } = loaderData;
  return (
    <ListingsPage
      title={query.q ? `Results for “${query.q}”` : "Browse everything"}
      crumbs={[{ label: "Home", to: "/" }, { label: "Search" }]}
      data={data}
      query={query}
      basePath="/search"
      categories={categories}
      emptyHint={query.q ? "Try fewer words, check the spelling, or remove a filter." : "Nothing is listed yet."}
    />
  );
}
