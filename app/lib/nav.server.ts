import { apiFetch, type ApiRequestContext } from "./api.server";
import { getConfig } from "./config.server";
import { parseCategoryTree } from "./search";

/**
 * The header's category links (DESIGN W3-03): the TOP-LEVEL catalog categories in the order the API gives them (the portal's sort order, then the name), read from the public category
 * tree. Every page renders the header on the server, so the answer is cached in this process: a fresh copy for a minute; when the API cannot be read the last good copy keeps being
 * used for up to ten minutes, and only then (or before any copy was ever read) is the list empty, which makes the header fall back to its fixed links. The API is asked at most once
 * at a time (one request in flight is shared). Public catalog data only: no session reaches this call.
 */
export interface NavCategory { slug: string; name: string }

export const MAX_NAV_CATEGORIES = 12;
const TTL_MS = 60_000, STALE_MS = 600_000, FAIL_RETRY_MS = 10_000, TIMEOUT_MS = 1500;
let cache: { at: number; value: NavCategory[] } | null = null;
let failedAt = Number.NEGATIVE_INFINITY;
let inFlight: Promise<NavCategory[] | null> | null = null;

export function resetNavCache(): void { cache = null; failedAt = Number.NEGATIVE_INFINITY; inFlight = null; }

/** Top-level categories of a tree as the API sends it; null when it is not a tree. */
export function topLevel(json: unknown): NavCategory[] | null {
  const tree = parseCategoryTree(json);
  if (!tree) return null;
  return tree.filter((c) => c.listingCount > 0).slice(0, MAX_NAV_CATEGORIES).map((c) => ({ slug: c.slug, name: c.name }));
}

async function fetchTop(ctx: ApiRequestContext): Promise<NavCategory[] | null> {
  try {
    const res = await apiFetch(getConfig(), { ...ctx, sessionToken: undefined }, "/api/v1/catalog/categories", { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return topLevel(await res.json());
  } catch {
    return null;
  }
}

export async function navCategories(ctx: ApiRequestContext, now = Date.now()): Promise<NavCategory[]> {
  if (cache && now - cache.at < TTL_MS) return cache.value;
  const stale = cache && now - cache.at < STALE_MS ? cache.value : [];
  if (now - failedAt < FAIL_RETRY_MS) return stale;          // the API just failed: do not ask on every page
  inFlight ??= fetchTop(ctx).finally(() => { inFlight = null; });
  const fresh = await inFlight;
  if (fresh) { cache = { at: now, value: fresh }; return fresh; }
  failedAt = now;
  return stale;
}
