/**
 * Wishlists and recently viewed (M6; API repo docs/API.md "Wishlists and recently viewed"). Types, defensive parsers for what the API answers, and the guest's recently-viewed
 * list in the browser: catalog data only (slug, title, price, image id), never anything about the person, capped, under the `solvelt.user.` prefix so sign-out clears it, and merged
 * into the account once on sign-in (the browser sends ids only; the API stamps the times).
 */
import { USER_STORAGE_PREFIX } from "./client-storage";

export interface ListCardView {
  id: string; slug: string; type: string; title: string; priceFromCents: number; priceToCents: number; currency: string; available: boolean;
  brandName: string; sellerName: string; image: { id: string; width: number; height: number; alt: string } | null;
}
export interface WishlistSummary { id: string; name: string; itemCount: number; shared: boolean; sharedAt: string | null }
export interface WishlistItemView { listingId: string; addedAt: string; unavailable: boolean; listing: ListCardView | null }

export const MAX_LISTS = 20;
export const MAX_ITEMS = 200;
export const MAX_RECENT = 20;
export const NAME_MAX = 60;
export const GUEST_VIEWED_KEY = USER_STORAGE_PREFIX + "recently-viewed";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const text = (v: unknown, max = 400): string | null => (typeof v === "string" && v.length <= max ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

export function parseCard(v: unknown): ListCardView | null {
  const o = obj(v);
  if (!o) return null;
  const id = text(o.id, 64), slug = text(o.slug, 160), title = text(o.title), currency = text(o.currency, 3), type = text(o.type, 20);
  const from = num(o.priceFromCents), to = num(o.priceToCents);
  if (!id || !slug || title === null || !currency || !/^[A-Z]{3}$/.test(currency) || !type || from === null || to === null || typeof o.available !== "boolean") return null;
  const img = obj(o.image);
  const iid = img ? text(img.id, 64) : null, w = img ? num(img.width) : null, h = img ? num(img.height) : null;
  return {
    id, slug, type, title, priceFromCents: from, priceToCents: Math.max(from, to), currency, available: o.available, brandName: text(o.brandName) ?? "", sellerName: text(o.sellerName) ?? "",
    image: iid && w && h ? { id: iid, width: w, height: h, alt: text(img!.alt) ?? "" } : null,
  };
}

export function parseSummary(v: unknown): WishlistSummary | null {
  const o = obj(v);
  const id = text(o?.id, 64), name = text(o?.name, NAME_MAX * 4), count = num(o?.itemCount);
  if (!o || !id || name === null || count === null) return null;
  return { id, name, itemCount: count, shared: o.shared === true, sharedAt: text(o.sharedAt, 40) };
}

export function parseItems(v: unknown): WishlistItemView[] {
  if (!Array.isArray(v)) return [];
  const out: WishlistItemView[] = [];
  for (const raw of v) {
    const o = obj(raw);
    const listingId = text(o?.listingId, 64);
    if (!o || !listingId) continue;
    out.push({ listingId, addedAt: text(o.addedAt, 40) ?? "", unavailable: o.unavailable === true, listing: parseCard(o.listing) });
  }
  return out;
}

// ---------------------------------------------------------------- guest recently viewed (browser)
export type GuestViewed = ListCardView;

export function readGuestViewed(store: Pick<Storage, "getItem">): GuestViewed[] {
  try { return parseGuestViewed(store.getItem(GUEST_VIEWED_KEY)); } catch { return []; }
}

export function parseGuestViewed(raw: string | null): GuestViewed[] {
  try {
    const arr: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    const seen = new Set<string>();
    const out: GuestViewed[] = [];
    for (const v of arr) {
      const c = parseCard(v);
      if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); }
      if (out.length >= MAX_RECENT) break;
    }
    return out;
  } catch { return []; }
}

/** Newest first, one entry per listing, at most MAX_RECENT. Returns the new list (also written to the store; a blocked store is not an error). */
export function recordGuestView(store: Pick<Storage, "getItem" | "setItem">, card: GuestViewed): GuestViewed[] {
  const next = [card, ...readGuestViewed(store).filter((c) => c.id !== card.id)].slice(0, MAX_RECENT);
  try { store.setItem(GUEST_VIEWED_KEY, JSON.stringify(next)); } catch { /* blocked */ }
  return next;
}

/** The ids to send on sign-in, newest first. */
export function guestViewedIds(store: Pick<Storage, "getItem">): string[] {
  return readGuestViewed(store).map((c) => c.id);
}

export function clearGuestViewed(store: Pick<Storage, "removeItem">): void {
  try { store.removeItem(GUEST_VIEWED_KEY); } catch { /* blocked */ }
}
