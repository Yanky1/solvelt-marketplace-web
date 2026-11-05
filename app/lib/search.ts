/**
 * The search/browse query: what the address says, validated, and the two ways it is written out (our canonical address, and the API's parameters).
 * Nothing from the address reaches the API unparsed: every field is checked here, anything unknown or malformed is dropped (never repaired into a different
 * meaning), and lists and numbers are bounded to what the API accepts, so a hostile or hand-edited address gives a normal page instead of a 400.
 */

export const SORTS = ["relevance", "newest", "price_asc", "price_desc", "title"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABELS: Record<Sort, string> = { relevance: "Best match", newest: "Newest", price_asc: "Price: low to high", price_desc: "Price: high to low", title: "Name A to Z" };
export const DELIVERY_VALUES = ["ships", "local", "at-home", "at-seller", "online"] as const;
export const DELIVERY_LABELS: Record<string, string> = { ships: "Ships to you", local: "Local delivery", "at-home": "Comes to you", "at-seller": "At the provider", online: "Online" };

export const PAGE_SIZE = 24;
const MAX_PAGE = 100_000, MAX_CENTS = 1_000_000_000_000, MAX_Q = 100, MAX_ATTR = 12, MAX_LIST = 10, MAX_VALUE = 60;
/** A slug or an id: what a path or a filter may name (the API's slugs are lower-case ASCII with hyphens). */
export const CATALOG_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const ATTR_KEY = /^[a-z0-9][a-z0-9-]{0,99}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F\u0080-\u009F\u2028\u2029]/g;

export interface ListingQuery {
  q: string;
  type?: "product" | "service";
  category?: string;
  brand?: string;
  seller?: string;
  priceMin?: number;
  priceMax?: number;
  available: boolean;
  kosher: string[];
  delivery: string[];
  /** `key:value` pairs for any attribute (the API's `attr`). */
  attr: string[];
  sort?: Sort;
  page: number;
}

export const emptyQuery = (): ListingQuery => ({ q: "", available: false, kosher: [], delivery: [], attr: [], page: 1 });

/** Control characters out, runs of white space into one space, cut to the API's limit on whole characters. */
export function cleanQuery(raw: string): string {
  const t = raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  return [...t].slice(0, MAX_Q).join("").trim();
}

const cents = (raw: string | null): number | undefined => {
  if (raw === null || !/^\d{1,13}$/.test(raw)) return undefined;
  const n = Number(raw);
  return n <= MAX_CENTS ? n : undefined;
};

/** A comma separated list of short, plain values (kosher certifications such as `OU` or `Star-K`), without duplicates. */
function list(raw: string | null, ok: (v: string) => boolean): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (v && ok(v) && !out.includes(v)) out.push(v);
    if (out.length >= MAX_LIST) break;
  }
  return out;
}
// eslint-disable-next-line no-control-regex
const plainValue = (v: string) => v.length <= MAX_VALUE && !/[\u0000-\u001F\u007F,]/.test(v);

/** What a page's path can fix: its own category, brand, seller or type (`/services` is the service listings). */
export type FixedKey = "category" | "brand" | "seller" | "type";

export function parseListingQuery(params: URLSearchParams, fixed: Partial<Pick<ListingQuery, "category" | "brand" | "seller" | "type">> = {}): ListingQuery {
  const q: ListingQuery = emptyQuery();
  q.q = cleanQuery(params.get("q") ?? "");
  const type = fixed.type ?? params.get("type");
  if (type === "product" || type === "service") q.type = type;
  for (const key of ["category", "brand", "seller"] as const) {
    const v = fixed[key] ?? params.get(key);
    if (v && CATALOG_KEY.test(v)) q[key] = v;
  }
  q.priceMin = cents(params.get("priceMin"));
  q.priceMax = cents(params.get("priceMax"));
  if (q.priceMin !== undefined && q.priceMax !== undefined && q.priceMin > q.priceMax) q.priceMax = undefined;       // an inverted range is dropped, not guessed
  q.available = params.get("available") === "true";
  q.kosher = list(params.getAll("kosher").join(","), plainValue);                                // a form sends repeats, our own address a comma list: both are read
  q.delivery = list(params.getAll("delivery").join(","), (v) => (DELIVERY_VALUES as readonly string[]).includes(v));
  for (const pair of params.getAll("attr")) {
    const i = pair.indexOf(":");
    if (i < 1) continue;
    const key = pair.slice(0, i), value = pair.slice(i + 1).trim();
    if (ATTR_KEY.test(key) && value && plainValue(value) && !q.attr.includes(`${key}:${value}`)) q.attr.push(`${key}:${value}`);
    if (q.attr.length >= MAX_ATTR) break;
  }
  const sort = params.get("sort");
  if (sort && (SORTS as readonly string[]).includes(sort)) q.sort = sort as Sort;
  if (q.sort === "relevance" && !q.q) q.sort = undefined;                                                            // relevance needs a search
  const page = params.get("page");
  q.page = page && /^\d{1,6}$/.test(page) && Number(page) >= 1 && Number(page) <= MAX_PAGE ? Number(page) : 1;
  return q;
}

/** What the sort is when none is chosen. */
export const defaultSort = (q: Pick<ListingQuery, "q">): Sort => (q.q ? "relevance" : "newest");
export const effectiveSort = (q: Pick<ListingQuery, "q" | "sort">): Sort => q.sort ?? defaultSort(q);

/** Our own address for a query: a fixed parameter order, defaults left out, so one set of results has one address. `omit` leaves out what the path already says. */
export function toSearchParams(query: ListingQuery, omit: ReadonlyArray<FixedKey> = []): URLSearchParams {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.type && !omit.includes("type")) p.set("type", query.type);
  for (const key of ["category", "brand", "seller"] as const) if (query[key] && !omit.includes(key)) p.set(key, query[key]!);
  if (query.priceMin !== undefined) p.set("priceMin", String(query.priceMin));
  if (query.priceMax !== undefined) p.set("priceMax", String(query.priceMax));
  if (query.available) p.set("available", "true");
  if (query.kosher.length) p.set("kosher", query.kosher.join(","));
  if (query.delivery.length) p.set("delivery", query.delivery.join(","));
  for (const a of query.attr) p.append("attr", a);
  if (query.sort && query.sort !== defaultSort(query)) p.set("sort", query.sort);
  if (query.page > 1) p.set("page", String(query.page));
  return p;
}

/** The parameters of `GET /api/v1/catalog/listings` for this query (facets on, our page size). */
export function toApiParams(query: ListingQuery, opts: { facets: boolean }): URLSearchParams {
  const p = toSearchParams(query);                       // the API's own default sort is the same as ours, so it is left out when chosen
  if (opts.facets) p.set("facets", "true");
  p.set("pageSize", String(PAGE_SIZE));
  return p;
}

/** A filter form sends prices in dollars (`priceMinD`, `priceMaxD`: a plain GET form cannot convert). The address we keep is in cents; this returns it, or null when there is nothing to convert. */
export function centsAddress(url: URL): URL | null {
  const min = url.searchParams.get("priceMinD"), max = url.searchParams.get("priceMaxD");
  if (min === null && max === null) return null;
  const toCents = (d: string | null): string | null => {
    const m = d === null ? null : /^\s*(\d{1,10})(?:\.(\d{1,2}))?\s*$/.exec(d);
    return m ? String(Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || 0)) : null;
  };
  const next = new URL(url);
  next.searchParams.delete("priceMinD"); next.searchParams.delete("priceMaxD");
  next.searchParams.delete("priceMin"); next.searchParams.delete("priceMax");
  const a = toCents(min), b = toCents(max);
  if (a !== null) next.searchParams.set("priceMin", a);
  if (b !== null) next.searchParams.set("priceMax", b);
  next.searchParams.delete("page");                      // a new filter starts at page 1
  return next;
}

/** Is any filter active? `ignore` names what the page's path already fixes (a brand page's brand is not a filter). */
export const hasFilters = (q: ListingQuery, ignore: ReadonlyArray<FixedKey> = []): boolean =>
  !!((q.type && !ignore.includes("type")) || (q.brand && !ignore.includes("brand")) || (q.seller && !ignore.includes("seller")) || (q.category && !ignore.includes("category")) || q.priceMin !== undefined || q.priceMax !== undefined || q.available || q.kosher.length || q.delivery.length || q.attr.length);

/** The same query with one change; a change to any filter or the sort goes back to page 1. */
export function withChange(q: ListingQuery, change: Partial<ListingQuery>): ListingQuery {
  return { ...q, ...change, page: change.page ?? 1 };
}

// ---------- what the API answers ----------
export interface ListingCardData {
  id: string; slug: string; type: "product" | "service"; title: string; summary: string;
  priceFromCents: number; priceToCents: number; compareAtFromCents: number | null; currency: string; available: boolean;
  brand: { slug: string; name: string }; seller: { id: string; displayName: string }; category: { slug: string; name: string } | null;
  image: { id: string; width: number; height: number; alt: string } | null;
}
export interface CategoryNode { id: string; slug: string; name: string; listingCount: number; children: CategoryNode[] }
export interface Facets {
  categories: CategoryNode[];
  brands: { slug: string; name: string; count: number }[];
  types: { value: string; count: number }[];
  available: number;
  price: { minCents: number; maxCents: number } | null;
  attributes: Record<string, { value: string; count: number }[]>;
}
export interface ListingPageData { items: ListingCardData[]; page: number; pageSize: number; total: number; totalPages: number; facets: Facets | null }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const str = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.length <= max ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

function parseCard(v: unknown): ListingCardData | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.id, 64), slug = str(o.slug, 160), title = str(o.title, 400), type = o.type;
  const from = int(o.priceFromCents), to = int(o.priceToCents), currency = str(o.currency, 3);
  const brand = obj(o.brand), seller = obj(o.seller);
  if (!id || !slug || !title || (type !== "product" && type !== "service") || from === null || to === null || !currency || !/^[A-Z]{3}$/.test(currency) || typeof o.available !== "boolean" || !brand || !seller) return null;
  const bSlug = str(brand.slug, 160), bName = str(brand.name, 400), sId = str(seller.id, 64), sName = str(seller.displayName, 400);
  if (!bSlug || bName === null || !sId || sName === null) return null;
  const cat = obj(o.category), img = obj(o.image);
  const imgId = img ? str(img.id, 64) : null, w = img ? int(img.width) : null, h = img ? int(img.height) : null;
  return {
    id, slug, type, title, summary: str(o.summary, 2000) ?? "", priceFromCents: from, priceToCents: Math.max(from, to), compareAtFromCents: int(o.compareAtFromCents), currency, available: o.available,
    brand: { slug: bSlug, name: bName }, seller: { id: sId, displayName: sName },
    category: cat && str(cat.slug, 160) && str(cat.name, 400) ? { slug: str(cat.slug, 160)!, name: str(cat.name, 400)! } : null,
    image: imgId && w && h ? { id: imgId, width: w, height: h, alt: str(img!.alt, 400) ?? "" } : null,
  };
}

export function parseCategoryTree(v: unknown, depth = 0): CategoryNode[] | null {
  if (!Array.isArray(v) || depth > 12) return null;
  const out: CategoryNode[] = [];
  for (const raw of v) {
    const o = obj(raw);
    const id = o ? str(o.id, 64) : null, slug = o ? str(o.slug, 160) : null, name = o ? str(o.name, 400) : null, n = o ? int(o.listingCount) : null;
    const children = o ? parseCategoryTree(o.children ?? [], depth + 1) : null;
    if (!id || !slug || !name || n === null || !children) return null;
    out.push({ id, slug, name, listingCount: n, children });
  }
  return out;
}

function parseFacets(v: unknown): Facets | null {
  const o = obj(v);
  if (!o) return null;
  const categories = parseCategoryTree(o.categories ?? []);
  const counted = (raw: unknown, keyName: string) => (Array.isArray(raw) ? raw.flatMap((x) => { const e = obj(x); const k = e ? str(e[keyName], 400) : null; const c = e ? int(e.count) : null; return k !== null && c !== null ? [{ k, c }] : []; }) : []);
  const brands = (Array.isArray(o.brands) ? o.brands : []).flatMap((x) => { const e = obj(x); const slug = e ? str(e.slug, 160) : null, name = e ? str(e.name, 400) : null, c = e ? int(e.count) : null; return slug && name !== null && c !== null ? [{ slug, name, count: c }] : []; });
  const price = obj(o.price);
  const min = price ? int(price.minCents) : null, max = price ? int(price.maxCents) : null;
  const attributes: Facets["attributes"] = {};
  const attrs = obj(o.attributes);
  if (attrs) for (const [key, vals] of Object.entries(attrs)) if (ATTR_KEY.test(key)) attributes[key] = counted(vals, "value").map(({ k, c }) => ({ value: k, count: c }));
  if (!categories) return null;
  return { categories, brands, types: counted(o.types, "value").map(({ k, c }) => ({ value: k, count: c })), available: int(o.available) ?? 0, price: min !== null && max !== null ? { minCents: min, maxCents: max } : null, attributes };
}

export function parseListingPage(json: unknown): ListingPageData | null {
  const o = obj(json);
  if (!o || !Array.isArray(o.items)) return null;
  const items: ListingCardData[] = [];
  for (const raw of o.items) { const c = parseCard(raw); if (!c) return null; items.push(c); }
  const page = int(o.page), pageSize = int(o.pageSize), total = int(o.total), totalPages = int(o.totalPages);
  if (page === null || pageSize === null || total === null || totalPages === null) return null;
  const facets = o.facets === undefined || o.facets === null ? null : parseFacets(o.facets);
  if (o.facets !== undefined && o.facets !== null && !facets) return null;
  return { items, page, pageSize, total, totalPages, facets };
}

/** One active filter as a chip: what to show, and the query without it. */
export interface FilterChip { key: string; label: string; without: ListingQuery }

export function activeFilters(q: ListingQuery, facets: Facets | null, money: (cents: number) => string, ignore: ReadonlyArray<FixedKey> = []): FilterChip[] {
  const chips: FilterChip[] = [];
  const drop = (change: Partial<ListingQuery>) => withChange(q, change);
  if (q.type && !ignore.includes("type")) chips.push({ key: "type", label: q.type === "service" ? "Services" : "Products", without: drop({ type: undefined }) });
  if (q.brand && !ignore.includes("brand")) chips.push({ key: "brand", label: facets?.brands.find((b) => b.slug === q.brand)?.name ?? q.brand, without: drop({ brand: undefined }) });
  if (q.priceMin !== undefined || q.priceMax !== undefined) {
    const label = q.priceMin !== undefined && q.priceMax !== undefined ? `${money(q.priceMin)} to ${money(q.priceMax)}` : q.priceMin !== undefined ? `${money(q.priceMin)} and up` : `Up to ${money(q.priceMax!)}`;
    chips.push({ key: "price", label, without: drop({ priceMin: undefined, priceMax: undefined }) });
  }
  if (q.available) chips.push({ key: "available", label: "In stock", without: drop({ available: false }) });
  for (const v of q.kosher) chips.push({ key: `kosher:${v}`, label: v, without: drop({ kosher: q.kosher.filter((x) => x !== v) }) });
  for (const v of q.delivery) chips.push({ key: `delivery:${v}`, label: DELIVERY_LABELS[v] ?? v, without: drop({ delivery: q.delivery.filter((x) => x !== v) }) });
  for (const a of q.attr) chips.push({ key: `attr:${a}`, label: a.replace(":", ": "), without: drop({ attr: q.attr.filter((x) => x !== a) }) });
  return chips;
}

// ---------- brand and seller storefronts ----------
export interface BrandCardData { id: string; slug: string; name: string; logoImageId: string | null; listingCount: number; seller: { id: string; displayName: string } }
export interface BrandStorefront extends BrandCardData { categories: CategoryNode[] }
export interface SellerStorefront { id: string; displayName: string; listingCount: number; brands: BrandCardData[]; categories: CategoryNode[] }

/** `GET /api/v1/catalog/brands`: every brand with something visible, or null when the answer cannot be read. */
export function parseBrandList(json: unknown): BrandCardData[] | null {
  if (!Array.isArray(json)) return null;
  const out: BrandCardData[] = [];
  for (const b of json) { const c = parseBrandCard(b); if (!c) return null; out.push(c); }
  return out;
}

function parseBrandCard(v: unknown): BrandCardData | null {
  const o = obj(v);
  const id = o ? str(o.id, 64) : null, slug = o ? str(o.slug, 160) : null, name = o ? str(o.name, 400) : null, n = o ? int(o.listingCount) : null;
  const seller = o ? obj(o.seller) : null;
  const sId = seller ? str(seller.id, 64) : null, sName = seller ? str(seller.displayName, 400) : null;
  if (!o || !id || !slug || !name || n === null || !sId || sName === null) return null;
  return { id, slug, name, listingCount: n, logoImageId: str(o.logoImageId, 64), seller: { id: sId, displayName: sName } };
}

export function parseBrandStorefront(json: unknown): BrandStorefront | null {
  const card = parseBrandCard(json);
  const categories = parseCategoryTree(obj(json)?.categories ?? []);
  return card && categories ? { ...card, categories } : null;
}

export function parseSellerStorefront(json: unknown): SellerStorefront | null {
  const o = obj(json);
  const id = o ? str(o.id, 64) : null, name = o ? str(o.displayName, 400) : null, n = o ? int(o.listingCount) : null;
  if (!o || !id || name === null || n === null || !Array.isArray(o.brands)) return null;
  const brands: BrandCardData[] = [];
  for (const b of o.brands) { const c = parseBrandCard(b); if (!c) return null; brands.push(c); }
  const categories = parseCategoryTree(o.categories ?? []);
  return categories ? { id, displayName: name, listingCount: n, brands, categories } : null;
}

// ---------- autocomplete ----------
export interface Suggestion { kind: "listing" | "brand" | "category"; text: string; slug: string }
/** Fewest characters (after cleaning) that are worth asking the API about. */
export const SUGGEST_MIN = 2;

export function parseSuggestions(json: unknown): Suggestion[] | null {
  const o = obj(json);
  if (!o || !Array.isArray(o.suggestions)) return null;
  const out: Suggestion[] = [];
  for (const raw of o.suggestions.slice(0, 20)) {
    const e = obj(raw);
    const kind = e?.kind, text = e ? str(e.text, 400) : null, slug = e ? str(e.slug, 160) : null;
    if ((kind !== "listing" && kind !== "brand" && kind !== "category") || !text || !slug || !CATALOG_KEY.test(slug)) continue;   // one bad entry is left out, not the list
    out.push({ kind, text, slug });
  }
  return out;
}
