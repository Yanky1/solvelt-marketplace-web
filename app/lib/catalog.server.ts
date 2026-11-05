import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";
import { ApiError } from "./api-client.server";
import { parseListingDetail, type ListingDetail } from "./catalog";
import { MAX_INPUT_BYTES } from "./img.server";
import { parseSitemapPage, SITEMAP_KINDS, type SitemapKind, type SitemapPageData } from "./sitemap";
import { cleanQuery, parseBrandList, parseBrandStorefront, parseCategoryTree, parseListingPage, parseSellerStorefront, parseSuggestions, SUGGEST_MIN, toApiParams, type BrandCardData, type BrandStorefront, type CategoryNode, type ListingPageData, type ListingQuery, type SellerStorefront, type Suggestion } from "./search";

/**
 * The buyer API's catalog, as TYPED calls only (standing rule O-12: the web server never proxies a generic /api/* path; every upstream path is built
 * here from a validated id). A slug is lower-case ASCII with hyphens, an id is a GUID: anything else cannot exist and is answered without calling the API.
 */
const SLUG_OR_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
export const isCatalogKey = (s: string): boolean => SLUG_OR_ID.test(s);
export const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type ListingResult = { kind: "ok"; listing: ListingDetail } | { kind: "gone" } | { kind: "notFound" };

async function getJson(ctx: ApiRequestContext, path: string): Promise<{ status: number; json: unknown }> {
  let res: Response;
  try {
    res = await apiFetch(getConfig(), ctx, path, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new ApiError(503, "unavailable", "The catalog is temporarily unavailable. Please try again.");
  }
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: res.status, json };
}

/** A failed call becomes one of two errors the pages know: rate limited, or unavailable (a malformed answer is also "unavailable": it is the API's fault, not the visitor's). */
function failure(status: number): ApiError {
  return status === 429 ? new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.") : new ApiError(status >= 500 ? 503 : 502, "unavailable", "The catalog is temporarily unavailable. Please try again.");
}

export type ImageResult = { kind: "ok"; bytes: Buffer; contentType: string } | { kind: "notFound" } | { kind: "unavailable" } | { kind: "bad" };
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

export const catalog = {
  /**
   * The original bytes of one image of a visible listing (`GET /api/v1/catalog/images/{id}`), for the resizer. The path is built from a checked GUID and nothing else
   * (O-12). The answer is judged again here and not just trusted: only the picture types we resize, at most MAX_INPUT_BYTES, read as a stream that is cancelled the
   * moment it grows past the limit.
   */
  async image(ctx: ApiRequestContext, id: string): Promise<ImageResult> {
    if (!GUID.test(id)) return { kind: "notFound" };
    let res: Response;
    try {
      res = await apiFetch(getConfig(), ctx, `/api/v1/catalog/images/${encodeURIComponent(id.toLowerCase())}`, { signal: AbortSignal.timeout(15_000) });
    } catch {
      return { kind: "unavailable" };
    }
    if (res.status === 404) { await res.body?.cancel(); return { kind: "notFound" }; }
    if (res.status === 502) { await res.body?.cancel(); return { kind: "bad" }; }
    if (res.status !== 200) { await res.body?.cancel(); return { kind: "unavailable" }; }
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) { await res.body?.cancel(); return { kind: "bad" }; }
    if (Number(res.headers.get("content-length") ?? 0) > MAX_INPUT_BYTES) { await res.body?.cancel(); return { kind: "bad" }; }
    const chunks: Uint8Array[] = []; let total = 0;
    try {
      const reader = res.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_INPUT_BYTES) { await reader.cancel(); return { kind: "bad" }; }
        chunks.push(value);
      }
    } catch {
      return { kind: "unavailable" };
    }
    return total === 0 ? { kind: "bad" } : { kind: "ok", bytes: Buffer.concat(chunks), contentType: type };
  },

  /** One page of listings for a validated query (facets on for the search and category pages). Only typed parameters are ever sent (O-12). */
  async listings(ctx: ApiRequestContext, query: ListingQuery, opts: { facets: boolean } = { facets: true }): Promise<ListingPageData> {
    const { status, json } = await getJson(ctx, `/api/v1/catalog/listings?${toApiParams(query, opts).toString()}`);
    if (status !== 200) throw failure(status);
    const page = parseListingPage(json);
    if (!page) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return page;
  },

  /** One page of the public sitemap entries of a kind (slug and last-modified). Null when the kind or page cannot exist. */
  async sitemap(ctx: ApiRequestContext, kind: string, page: number, pageSize: number): Promise<SitemapPageData | null> {
    if (!(SITEMAP_KINDS as readonly string[]).includes(kind) || !Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1) return null;
    const { status, json } = await getJson(ctx, `/api/v1/catalog/sitemap/${kind}?page=${page}&pageSize=${pageSize}`);
    if (status === 404) return null;
    if (status !== 200) throw failure(status);
    const data = parseSitemapPage(json, kind as SitemapKind);
    if (!data) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return data;
  },

  /** Autocomplete for the header search box. Text under the minimum is answered with nothing and never reaches the API; the text is cleaned like a search. */
  async suggest(ctx: ApiRequestContext, text: string): Promise<Suggestion[]> {
    const q = cleanQuery(text);
    if ([...q].length < SUGGEST_MIN) return [];
    const { status, json } = await getJson(ctx, `/api/v1/catalog/suggest?${new URLSearchParams({ q, limit: "8" }).toString()}`);
    if (status !== 200) throw failure(status);
    const list = parseSuggestions(json);
    if (!list) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return list;
  },

  /** Every brand that has something visible (the /brands index). */
  async brands(ctx: ApiRequestContext): Promise<BrandCardData[]> {
    const { status, json } = await getJson(ctx, "/api/v1/catalog/brands");
    if (status !== 200) throw failure(status);
    const list = parseBrandList(json);
    if (!list) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return list;
  },

  /** A brand's storefront by slug or id, or null when it is unknown, suspended or has nothing visible (the API does not say which). */
  async brand(ctx: ApiRequestContext, slugOrId: string): Promise<BrandStorefront | null> {
    if (!isCatalogKey(slugOrId)) return null;
    const { status, json } = await getJson(ctx, `/api/v1/catalog/brands/${encodeURIComponent(slugOrId)}`);
    if (status === 404) return null;
    if (status !== 200) throw failure(status);
    const brand = parseBrandStorefront(json);
    if (!brand) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return brand;
  },

  /** A seller's storefront by id (a GUID), or null. */
  async seller(ctx: ApiRequestContext, id: string): Promise<SellerStorefront | null> {
    if (!GUID.test(id)) return null;
    const { status, json } = await getJson(ctx, `/api/v1/catalog/sellers/${encodeURIComponent(id)}`);
    if (status === 404) return null;
    if (status !== 200) throw failure(status);
    const seller = parseSellerStorefront(json);
    if (!seller) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return seller;
  },

  /** The category tree (empty categories are already left out by the API). */
  async categories(ctx: ApiRequestContext): Promise<CategoryNode[]> {
    const { status, json } = await getJson(ctx, "/api/v1/catalog/categories");
    if (status !== 200) throw failure(status);
    const tree = parseCategoryTree(json);
    if (!tree) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return tree;
  },

  /** One listing by slug or id. 404 and 410 are answers, not errors; anything unexpected is an ApiError (503 for an outage, 502 for a malformed answer). */
  async listing(ctx: ApiRequestContext, slugOrId: string): Promise<ListingResult> {
    if (!isCatalogKey(slugOrId)) return { kind: "notFound" };
    const { status, json } = await getJson(ctx, `/api/v1/catalog/listings/${encodeURIComponent(slugOrId)}`);
    if (status === 404) return { kind: "notFound" };
    if (status === 410) return { kind: "gone" };
    if (status === 429) throw new ApiError(429, "rate_limited", "Too many requests. Please wait a moment and try again.");
    if (status !== 200) throw new ApiError(status >= 500 ? 503 : 502, "unavailable", "The catalog is temporarily unavailable. Please try again.");
    const listing = parseListingDetail(json);
    if (!listing) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return { kind: "ok", listing };
  },
};

/** The response a page throws when the catalog could not answer: 429 (with Retry-After) or 503, never cached. */
export function catalogErrorResponse(e: unknown): Response {
  const rate = e instanceof ApiError && e.status === 429;
  return new Response(rate ? "Too many requests" : "Service unavailable", { status: rate ? 429 : 503, headers: { "Cache-Control": "no-store", ...(rate ? { "Retry-After": "30" } : {}) } });
}
