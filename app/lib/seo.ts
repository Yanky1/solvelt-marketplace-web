import type { ListingDetail, Variant } from "./catalog";
import { listingPath } from "./urls";

/** JSON for an inline <script type="application/ld+json">: `<` and friends are escaped so no text from the catalog can close the tag or open another. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Plain text of at most `max` characters, cut on a word, for a description meta tag. */
export function clipText(text: string, max = 155): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).trimEnd() + "…";
}

export const priceString = (cents: number): string => (cents / 100).toFixed(2);
export const imageUrl = (origin: string, id: string, width = 1200): string => `${origin}/img/${encodeURIComponent(id)}?w=${width}`;

const availabilityUrl = (v: Variant): string => (v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock");

/** schema.org Product (a service is a Service) with one Offer per variant; the canonical URL never carries the variant, an offer's url does. */
export function listingJsonLd(listing: ListingDetail, origin: string) {
  const url = origin + listingPath(listing.slug);
  const offers = listing.variants.map((v) => ({
    "@type": "Offer",
    name: v.name,
    url: `${url}?variant=${encodeURIComponent(v.id)}`,
    price: priceString(v.priceCents),
    priceCurrency: listing.currency,
    availability: availabilityUrl(v),
    seller: { "@type": "Organization", name: listing.seller.displayName },
  }));
  const base = {
    "@context": "https://schema.org",
    name: listing.title,
    description: clipText(listing.summary || listing.description, 5000),
    url,
    ...(listing.images.length ? { image: listing.images.slice(0, 8).map((i) => imageUrl(origin, i.id)) } : {}),
    offers,
  };
  if (listing.type === "service") return { "@type": "Service", ...base, provider: { "@type": "Organization", name: listing.seller.displayName }, ...(listing.categoryPath.length ? { serviceType: listing.categoryPath.at(-1)!.name } : {}) };
  return { "@type": "Product", ...base, brand: { "@type": "Brand", name: listing.brand.name }, ...(listing.categoryPath.length ? { category: listing.categoryPath.map((c) => c.name).join(" > ") } : {}) };
}

export interface Crumb { name: string; path: string }
export function breadcrumbJsonLd(origin: string, crumbs: Crumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: origin + c.path })),
  };
}
