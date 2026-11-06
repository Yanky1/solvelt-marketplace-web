import { RecentlyViewedShelf } from "~/components/RecentlyViewed";
import type { Route } from "./+types/home";
import { JsonLd } from "~/components/JsonLd";
import { LinkButton } from "~/components/ui/form";
import { EmptyState } from "~/components/ui/display";
import { ListingCard } from "~/components/ListingCard";
import { apiCtx } from "~/lib/auth.server";
import { catalog } from "~/lib/catalog.server";
import { getConfig } from "~/lib/config.server";
import { emptyQuery, type ListingCardData } from "~/lib/search";
import { organizationJsonLd, websiteJsonLd } from "~/lib/seo";

const FEATURED = 8;

/** "Featured" is the newest listings (the catalog's default order, no curation). A catalog that cannot be reached is reported as that, never as an empty catalog. */
export async function loader({ request, context }: Route.LoaderArgs) {
  let featured: ListingCardData[] = [];
  let unavailable = false;
  try {
    featured = (await catalog.listings(apiCtx(request, context, null), { ...emptyQuery(), sort: "newest" }, { facets: false })).items.slice(0, FEATURED);
  } catch {
    unavailable = true;
  }
  return { origin: getConfig().publicOrigin, featured, unavailable };
}

export function meta({ data }: Route.MetaArgs) {
  const origin = data?.origin ?? "";
  return [
    { title: "Solvelt Market: products and services from independent sellers" },
    { name: "description", content: "Shop products and book services from independent sellers on Solvelt Market." },
    ...(origin ? [{ tagName: "link", rel: "canonical", href: origin + "/" }] : []),
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Solvelt Market" },
    { property: "og:title", content: "Solvelt Market: products and services from independent sellers" },
    { name: "twitter:card", content: "summary" },
  ];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <div className="stack">
      <JsonLd data={websiteJsonLd(loaderData.origin)} />
      <JsonLd data={organizationJsonLd(loaderData.origin)} />
      <section className="hero">
        <h1>Shop independent sellers, with confidence</h1>
        <p>Products and services from trusted sellers, with kosher-aware filters and one simple checkout.</p>
        <LinkButton to="/categories" className="btn-gold">Browse categories</LinkButton>
      </section>
      <section aria-labelledby="featured">
        <h2 id="featured">Featured</h2>
        {loaderData.featured.length > 0
          ? <ul className="listing-grid" aria-label="Featured listings">{loaderData.featured.map((item, i) => <ListingCard key={item.id} item={item} priority={i < 4} />)}</ul>
          : loaderData.unavailable
            ? <EmptyState title="Listings could not be loaded">Please try again in a moment, or <a href="/search">search the catalog</a>.</EmptyState>
            : <EmptyState title="No listings yet">Sellers have not published anything yet. Check back soon.</EmptyState>}
      </section>
      <RecentlyViewedShelf />
    </div>
  );
}
