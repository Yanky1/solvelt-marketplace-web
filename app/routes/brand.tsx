import { redirect } from "react-router";
import type { Route } from "./+types/brand";
import { JsonLd } from "~/components/JsonLd";
import { ListingsPage } from "~/components/ListingsPage";
import { Link } from "react-router";
import { apiCtx } from "~/lib/auth.server";
import { catalog, catalogErrorResponse, GUID } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { breadcrumbJsonLd, clipText, imageUrl } from "~/lib/seo";
import { centsAddress, hasFilters, parseListingQuery, toSearchParams, withChange } from "~/lib/search";
import { brandPath, sellerPath } from "~/lib/urls";

/**
 * A brand's storefront (/b/:slug): its listings with the same facets, sort and paging as search. Indexed like a category page; a filtered, sorted or
 * searched view is `noindex` and points at the plain page (W2-08). An id in the address goes to the slug (301).
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const key = params.slug ?? "";
  const url = new URL(request.url);
  const dollars = centsAddress(url);
  if (dollars) throw redirect(dollars.pathname + dollars.search);
  const ctx = apiCtx(request, context, null);
  try {
    const brand = await catalog.brand(ctx, key);
    if (!brand) throw new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    if (brand.slug !== key) throw redirect(brandPath(brand.slug) + url.search, { status: GUID.test(key) ? 301 : 302 });
    const query = parseListingQuery(url.searchParams, { brand: brand.slug });
    const base = brandPath(brand.slug), qs = toSearchParams(query, ["brand"]).toString();
    if (url.pathname + url.search !== (qs ? `${base}?${qs}` : base)) throw redirect(qs ? `${base}?${qs}` : base);
    const data = await catalog.listings(ctx, query);
    if (data.items.length === 0 && query.page > 1) {
      const back = toSearchParams(withChange(query, { page: Math.max(1, Math.min(data.totalPages, query.page - 1)) }), ["brand"]).toString();
      throw redirect(back ? `${base}?${back}` : base);
    }
    return { brand, query, data, origin: getConfig().publicOrigin };
  } catch (e) {
    if (e instanceof Response) throw e;
    throw catalogErrorResponse(e);
  }
}

export function meta({ data }: Route.MetaArgs) {
  if (!data) return [{ title: "Not found | Solvelt" }, { name: "robots", content: "noindex" }];
  const { brand, query, origin, data: page } = data;
  const plain = hasFilters(query, ["brand"]) || !!query.q || !!query.sort;
  const base = origin + brandPath(brand.slug);
  const canonical = !plain && query.page > 1 ? `${base}?page=${query.page}` : base;
  const title = `${brand.name}${query.page > 1 ? ` (page ${query.page})` : ""} | Solvelt`;
  return [
    { title },
    { name: "description", content: clipText(`${brand.name} by ${brand.seller.displayName} on Solvelt: ${brand.listingCount} ${brand.listingCount === 1 ? "listing" : "listings"}.`) },
    { tagName: "link", rel: "canonical", href: canonical },
    ...(plain ? [{ name: "robots", content: "noindex, follow" }] : []),
    ...(!plain && query.page > 1 ? [{ tagName: "link", rel: "prev", href: query.page === 2 ? base : `${base}?page=${query.page - 1}` }] : []),
    ...(!plain && query.page < page.totalPages ? [{ tagName: "link", rel: "next", href: `${base}?page=${query.page + 1}` }] : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Solvelt Market" },
    { property: "og:title", content: `${brand.name} | Solvelt` },
    { property: "og:url", content: canonical },
    ...(brand.logoImageId ? [{ property: "og:image", content: imageUrl(origin, brand.logoImageId) }] : []),
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: `${brand.name} | Solvelt` },
  ];
}

export default function Brand({ loaderData }: Route.ComponentProps) {
  const { brand, query, data, origin } = loaderData;
  const ld = { "@context": "https://schema.org", "@type": "Brand", name: brand.name, url: origin + brandPath(brand.slug), ...(brand.logoImageId ? { logo: imageUrl(origin, brand.logoImageId) } : {}) };
  return (
    <>
      <JsonLd data={ld} />
      <JsonLd data={breadcrumbJsonLd(origin, [{ name: "Home", path: "/" }, { name: brand.name, path: brandPath(brand.slug) }])} />
      <ListingsPage
        title={brand.name}
        intro={undefined}
        crumbs={[{ label: "Home", to: "/" }, { label: brand.name }]}
        data={data} query={query} basePath={brandPath(brand.slug)} fixed={["brand"]} categories={brand.categories}
        extra={<p className="storefront-by">Sold by <Link to={sellerPath(brand.seller.id)}>{brand.seller.displayName}</Link></p>}
        emptyHint="Nothing from this brand matches. Try removing a filter."
      />
    </>
  );
}
