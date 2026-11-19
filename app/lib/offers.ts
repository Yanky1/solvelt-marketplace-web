/**
 * Quantity offers (portal C18, API worker V's final shapes, decision Q-W1). Pure helpers only: the SERVER prices everything (cart, quote, checkout, the phone assistant share one function), and
 * this file only parses what the API sent and words it. It never computes a price, a discount or a total.
 */
export interface OfferTier { minQuantity: number; unitPriceCents: number }
export interface OfferGiftInfo { minQuantity: number; productId: string; title: string; quantity: number; available: boolean }
/** An offer that applies now to a listing (listing detail and cards). */
export interface ListingOffer { offerId: string; name: string; tiers: OfferTier[]; gifts: OfferGiftInfo[] }
export interface CartOfferGift { productId: string; title: string; quantity: number; status: "included" | "unavailable" }
/** What an offer did to one cart group, from the server's pricing. */
export interface CartOffer { offerId: string; eligibleUnits: number; tier: OfferTier | null; nextTier: OfferTier | null; unitsToNextTier: number; discountCents: number; gifts: CartOfferGift[] }
export interface GiftLine { productId: string; title: string; quantity: number; unitPriceCents: number }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const posInt = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.length <= max ? v : null);

function tier(v: unknown): OfferTier | null {
  if (!isObj(v)) return null;
  const q = posInt(v.minQuantity), p = posInt(v.unitPriceCents);
  return q !== null && q > 0 && p !== null ? { minQuantity: q, unitPriceCents: p } : null;
}

/**
 * Offers on a listing are optional garnish: a malformed or missing `offers` is "no offers", never a reason to refuse the whole listing. A malformed single offer is dropped, the rest stay.
 * Tiers come back sorted by quantity.
 */
export function parseListingOffers(json: unknown): ListingOffer[] {
  if (!Array.isArray(json) || json.length > 20) return [];
  const out: ListingOffer[] = [];
  for (const o of json) {
    if (!isObj(o)) continue;
    const offerId = text(o.offerId, 60), name = text(o.name, 400);
    if (!offerId || name === null || !Array.isArray(o.tiers) || o.tiers.length > 50) continue;
    const tiers = o.tiers.map(tier);
    if (tiers.some((t) => t === null)) continue;
    const gifts: OfferGiftInfo[] = [];
    for (const g of Array.isArray(o.gifts) ? o.gifts.slice(0, 50) : []) {
      if (!isObj(g)) continue;
      const q = posInt(g.minQuantity), n = posInt(g.quantity), pid = text(g.productId, 60), title = text(g.title, 400);
      if (q !== null && n !== null && n > 0 && pid && title !== null) gifts.push({ minQuantity: q, productId: pid, title, quantity: n, available: g.available === true });
    }
    out.push({ offerId, name, tiers: (tiers as OfferTier[]).sort((a, b) => a.minQuantity - b.minQuantity), gifts });
  }
  return out;
}

/** The cart's offers for one group, parsed the same forgiving way; unknown shapes are dropped. */
export function parseCartOffers(json: unknown): CartOffer[] {
  if (!Array.isArray(json) || json.length > 20) return [];
  const out: CartOffer[] = [];
  for (const o of json) {
    if (!isObj(o)) continue;
    const offerId = text(o.offerId, 60), units = posInt(o.eligibleUnits), toNext = posInt(o.unitsToNextTier), disc = posInt(o.discountCents);
    if (!offerId || units === null || toNext === null || disc === null) continue;
    const gifts: CartOfferGift[] = [];
    for (const g of Array.isArray(o.gifts) ? o.gifts.slice(0, 50) : []) {
      if (!isObj(g)) continue;
      const pid = text(g.productId, 60), title = text(g.title, 400), n = posInt(g.quantity);
      if (pid && title !== null && n !== null && (g.status === "included" || g.status === "unavailable")) gifts.push({ productId: pid, title, quantity: n, status: g.status });
    }
    out.push({ offerId, eligibleUnits: units, tier: o.tier == null ? null : tier(o.tier), nextTier: o.nextTier == null ? null : tier(o.nextTier), unitsToNextTier: toNext, discountCents: disc, gifts });
  }
  return out;
}

export function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

/**
 * The listing badges: "Buy 20+, $0.90 each" for the first step of each offer (what a buyer must do to start saving), and "Free gift with 10+" for the earliest gift. Quantities and prices
 * are the seller's own numbers, shown as given.
 */
export function listingOfferBadges(offers: ListingOffer[] | undefined, currency = "USD"): string[] {
  const out: string[] = [];
  for (const o of offers ?? []) {
    const first = o.tiers[0];
    if (first) out.push(`Buy ${first.minQuantity}+, ${money(first.unitPriceCents, currency)} each`);
    const gift = [...o.gifts].sort((a, b) => a.minQuantity - b.minQuantity)[0];
    if (gift) out.push(`Free gift with ${gift.minQuantity}+`);
  }
  return out;
}

export type CartOfferMessageKind = "next" | "gift" | "gift_unavailable";
export interface CartOfferMessage { kind: CartOfferMessageKind; text: string }

/** "Add 5 more for $0.90 each" / "Free gift included" / "Gift unavailable", in that order. A gift line the server could not include is "unavailable": the order still goes through without it. */
export function cartOfferMessages(offer: CartOffer, currency = "USD"): CartOfferMessage[] {
  const out: CartOfferMessage[] = [];
  if (offer.nextTier && offer.unitsToNextTier > 0) out.push({ kind: "next", text: `Add ${offer.unitsToNextTier} more for ${money(offer.nextTier.unitPriceCents, currency)} each` });
  if (offer.gifts.some((g) => g.status === "included")) out.push({ kind: "gift", text: "Free gift included" });
  if (offer.gifts.some((g) => g.status === "unavailable")) out.push({ kind: "gift_unavailable", text: "Gift unavailable" });
  return out;
}

/** The notice for a 409 `price_changed`: a body with `messageCode: "offer_changed"` says a quantity offer moved and nothing was charged; anything else keeps the usual price/delivery wording. */
export function priceChangedMessage(body: unknown): string {
  const code = isObj(body) ? body.messageCode : undefined;
  return code === "offer_changed"
    ? "A quantity offer in your cart changed while you were checking out, so the total is different. Nothing was charged. Please review the new total and pay again."
    : "The price or delivery changed while you were checking out. Please review the new total and pay again.";
}
