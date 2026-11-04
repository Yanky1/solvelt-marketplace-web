import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";
import { ApiError } from "./api-client.server";
import { parseListingDetail, type ListingDetail } from "./catalog";

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

export const catalog = {
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
