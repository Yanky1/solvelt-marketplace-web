/** Shapes of the public catalog API (API repo docs/API.md "Catalog"). Money is whole cents, currency USD. */

export interface Brand { id: string; slug: string; name: string }
export interface Seller { id: string; displayName: string }
export interface CategoryCard { id: string; slug: string; name: string }
export interface ImageRef { id: string; width: number; height: number; alt: string }
export interface Variant { id: string; name: string; priceCents: number; compareAtCents: number | null; available: boolean }
export interface Attribute { key: string; value: string }
export interface Faq { question: string; answer: string }

export interface ListingDetail {
  id: string; slug: string; type: "product" | "service";
  title: string; summary: string; description: string;
  priceFromCents: number; priceToCents: number; compareAtFromCents: number | null; currency: string; available: boolean;
  brand: Brand; seller: Seller; categoryPath: CategoryCard[];
  variants: Variant[]; images: ImageRef[]; attributes: Attribute[]; faqs: Faq[];
  createdAt: string; updatedAt: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 5000): string | null => (typeof v === "string" && v.length <= max ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const arr = (v: unknown, max: number): unknown[] | null => (Array.isArray(v) && v.length <= max ? v : null);

function each<T>(v: unknown, max: number, f: (x: unknown) => T | null): T[] | null {
  const a = arr(v, max);
  if (!a) return null;
  const out: T[] = [];
  for (const x of a) { const r = f(x); if (r === null) return null; out.push(r); }
  return out;
}

const brand = (v: unknown): Brand | null => isObj(v) && str(v.id, 60) && str(v.slug, 200) && str(v.name, 400) !== null ? { id: v.id as string, slug: v.slug as string, name: v.name as string } : null;
const seller = (v: unknown): Seller | null => isObj(v) && str(v.id, 60) && str(v.displayName, 400) !== null ? { id: v.id as string, displayName: v.displayName as string } : null;
const category = (v: unknown): CategoryCard | null => isObj(v) && str(v.id, 60) && str(v.slug, 200) && str(v.name, 400) !== null ? { id: v.id as string, slug: v.slug as string, name: v.name as string } : null;
const image = (v: unknown): ImageRef | null => {
  if (!isObj(v)) return null;
  const id = str(v.id, 60), alt = str(v.alt, 600), w = int(v.width), h = int(v.height);
  return id && alt !== null && w && h ? { id, alt, width: w, height: h } : null;
};
const variant = (v: unknown): Variant | null => {
  if (!isObj(v)) return null;
  const id = str(v.id, 60), name = str(v.name, 600), price = int(v.priceCents);
  const was = v.compareAtCents === null || v.compareAtCents === undefined ? null : int(v.compareAtCents);
  return id && name !== null && price !== null && (v.compareAtCents == null || was !== null) && typeof v.available === "boolean" ? { id, name, priceCents: price, compareAtCents: was, available: v.available } : null;
};

/**
 * The API is ours, but a page must not crash (or render nonsense) on a malformed answer: anything that does not have the documented shape is
 * rejected as a whole (the caller turns it into a 502), never half-rendered. Text is only ever rendered as text by React.
 */
export function parseListingDetail(json: unknown): ListingDetail | null {
  if (!isObj(json)) return null;
  const id = str(json.id, 60), slug = str(json.slug, 200), title = str(json.title, 600), summary = str(json.summary, 1200), description = str(json.description, 100_000);
  const type = json.type === "product" || json.type === "service" ? json.type : null;
  const currency = typeof json.currency === "string" && /^[A-Z]{3}$/.test(json.currency) ? json.currency : null;
  const from = int(json.priceFromCents), to = int(json.priceToCents);
  const was = json.compareAtFromCents == null ? null : int(json.compareAtFromCents);
  const b = brand(json.brand), s = seller(json.seller);
  const path = each(json.categoryPath, 12, category), variants = each(json.variants, 200, variant), images = each(json.images, 50, image);
  const attributes = each(json.attributes, 100, (a) => (isObj(a) && str(a.key, 100) && str(a.value, 500) !== null ? { key: a.key as string, value: a.value as string } : null));
  const faqs = each(json.faqs, 50, (f) => (isObj(f) && str(f.question, 600) && str(f.answer, 20_000) !== null ? { question: f.question as string, answer: f.answer as string } : null));
  const createdAt = str(json.createdAt, 40), updatedAt = str(json.updatedAt, 40);
  if (!id || !slug || !title || summary === null || description === null || !type || !currency || from === null || to === null || (json.compareAtFromCents != null && was === null)
    || !b || !s || !path || !variants || variants.length === 0 || !images || !attributes || !faqs || !createdAt || !updatedAt || typeof json.available !== "boolean") return null;
  return { id, slug, type, title, summary, description, priceFromCents: from, priceToCents: to, compareAtFromCents: was, currency, available: json.available, brand: b, seller: s, categoryPath: path, variants, images, attributes, faqs, createdAt, updatedAt };
}

/** The variant shown: the one asked for (by id) when it exists, else the first one that can be bought, else the first. */
export function pickVariant(listing: Pick<ListingDetail, "variants">, wanted: string | null | undefined): Variant {
  const found = wanted ? listing.variants.find((v) => v.id === wanted) : undefined;
  return found ?? listing.variants.find((v) => v.available) ?? listing.variants[0]!;
}

/** Attribute values for one key, in the portal's order (an attribute can repeat: `delivery` has several values). */
export function attributeValues(listing: Pick<ListingDetail, "attributes">, key: string): string[] {
  return listing.attributes.filter((a) => a.key === key).map((a) => a.value);
}

const DELIVERY_LABELS: Record<string, string> = { ships: "Ships to you", local: "Local delivery", "at-home": "Comes to you", "at-seller": "At the provider", online: "Online" };
export function deliveryLabels(listing: Pick<ListingDetail, "attributes">): string[] {
  return attributeValues(listing, "delivery").map((v) => DELIVERY_LABELS[v]).filter((v): v is string => !!v);
}

/** Where a service is offered, from the listing's `delivery` attribute (online, at-home, at-seller), in that order. */
export function serviceLocations(listing: Pick<ListingDetail, "attributes">): ("online" | "at-home" | "at-seller")[] {
  const have = attributeValues(listing, "delivery");
  return (["online", "at-home", "at-seller"] as const).filter((l) => have.includes(l));
}

const KNOWN_LABELS: Record<string, string> = {
  "kosher-certification": "Kosher certification", "kosher-status": "Kosher status", "kosher-for-passover": "Kosher for Passover",
  "service-area": "Service area", duration: "Duration", location: "Location", "booking-mode": "Booking", "pricing-model": "Pricing",
};
/** Human label for an attribute key ("burn-time" gives "Burn time"). */
export function attributeLabel(key: string): string {
  return KNOWN_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/-/g, " ");
}

/** Attributes worth a spec row: delivery options have their own block, the rest are listed in the seller's order. */
export function specAttributes(listing: Pick<ListingDetail, "attributes">): Attribute[] {
  return listing.attributes.filter((a) => a.key !== "delivery");
}
