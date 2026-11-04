import { redirect } from "react-router";
import type { Route } from "./+types/seller";
import { JsonLd } from "~/components/JsonLd";
import { ListingsPage } from "~/components/ListingsPage";
import { Link } from "react-router";
import { apiCtx } from "~/lib/auth.server";
import { catalog, catalogErrorResponse, GUID } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { breadcrumbJsonLd, clipText } from "~/lib/seo";
import { centsAddress, hasFilters, parseListingQuery, toSearchParams, withChange } from "~/lib/search";
import { brandPath, sellerPath } from "~/lib/urls";

/** A seller's storefront (/s/:id): the seller's brands and all of its listings. The address holds the seller's id; the page is indexed like a brand page. */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const id = (params.id ?? "").toLowerCase();
  const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!GUID.test(id)) throw notFound();
  const url = new URL(request.url);
  const dollars = centsAddress(url);
  if (dollars) throw redirect(dollars.pathname + dollars.search);
  const ctx = apiCtx(request, context, null);
  try {
    const seller = await catalog.seller(ctx, id);
    if (!seller) throw notFound();
    const query = parseListingQuery(url.searchParams, { seller: seller.id });
    const base = sellerPath(seller.id), qs = toSearchParams(query, ["seller"]).toString();
    if (url.pathname + url.search !== (qs ? `${base}?${qs}` : base)) throw redirect(qs ? `${base}?${qs}` : base);
    const data = await catalog.listings(ctx, query);
    if (data.items.length === 0 && query.page > 1) {
      const back = toSearchParams(withChange(query, { page: Math.max(1, Math.min(data.totalPages, query.page - 1)) }), ["seller"]).toString();
      throw redirect(back ? `${base}?${back}` : base);
    }
    return { seller, query, data, origin: getConfig().publicOrigin };
  } catch (e) {
    if (e instanceof Response) throw e;
    throw catalogErrorResponse(e);
  }
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found | Solvelt" }, { name: "robots", content: "noindex" }];
  const { seller, query, origin, data: page } = data;
  const plain = hasFilters(query, ["seller"]) || !!query.q || !!query.sort;
  const base = origin + sellerPath(seller.id);
  const canonical = !plain && query.page > 1 ? `${base}?page=${query.page}` : base;
  return [
    { title: `${seller.displayName}${query.page > 1 ? ` (page ${query.page})` : ""} | Solvelt` },
    { name: "description", content: clipText(`Shop ${seller.displayName} on Solvelt: ${seller.listingCount} ${seller.listingCount === 1 ? "listing" : "listings"}.`) },
    { tagName: "link", rel: "canonical", href: canonical },
    ...(plain ? [{ name: "robots", content: "noindex, follow" }] : []),
    ...(!plain && query.page > 1 ? [{ tagName: "link", rel: "prev", href: query.page === 2 ? base : `${base}?page=${query.page - 1}` }] : []),
    ...(!plain && query.page < page.totalPages ? [{ tagName: "link", rel: "next", href: `${base}?page=${query.page + 1}` }] : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Solvelt Market" },
    { property: "og:title", content: `${seller.displayName} | Solvelt` },
    { property: "og:url", content: canonical },
    { name: "twitter:card", content: "summary" },
  ];
}

export default function Seller({ loaderData }: Route.ComponentProps) {
  const { seller, query, data, origin } = loaderData;
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, { name: seller.displayName, path: sellerPath(seller.id) }])} />
      <ListingsPage
        title={seller.displayName}
        crumbs={[{ label: "Home", to: "/" }, { label: seller.displayName }]}
        data={data} query={query} basePath={sellerPath(seller.id)} fixed={["seller"]} categories={seller.categories}
        extra={seller.brands.length > 0 ? (
          <nav className="storefront-brands" aria-label={`Brands by ${seller.displayName}`}>
            <h2>Brands</h2>
            <ul>{seller.brands.map((b) => <li key={b.id}><Link to={brandPath(b.slug)}>{b.name} <span className="facet-count">({b.listingCount})</span></Link></li>)}</ul>
          </nav>
        ) : undefined}
        emptyHint="Nothing from this seller matches. Try removing a filter."
      />
    </>
  );
}
