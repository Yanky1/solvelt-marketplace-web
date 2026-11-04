import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";
import { ApiError } from "./api-client.server";
import { parseListingDetail, type ListingDetail } from "./catalog";
import { parseCategoryTree, parseListingPage, toApiParams, type CategoryNode, type ListingPageData, type ListingQuery } from "./search";

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

export const catalog = {
  /** One page of listings for a validated query (facets on for the search and category pages). Only typed parameters are ever sent (O-12). */
  async listings(ctx: ApiRequestContext, query: ListingQuery, opts: { facets: boolean } = { facets: true }): Promise<ListingPageData> {
    const { status, json } = await getJson(ctx, `/api/v1/catalog/listings?${toApiParams(query, opts).toString()}`);
    if (status !== 200) throw failure(status);
    const page = parseListingPage(json);
    if (!page) throw new ApiError(502, "bad_gateway", "The catalog answered with something we could not read.");
    return page;
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
