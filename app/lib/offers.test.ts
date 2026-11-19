import { describe, expect, it } from "vitest";
import { cartOfferMessages, listingOfferBadges, parseCartOffers, parseListingOffers, type CartOffer } from "./offers";

const offer = () => ({
  offerId: "o1", name: "Bundle", tiers: [{ minQuantity: 50, unitPriceCents: 80 }, { minQuantity: 20, unitPriceCents: 90 }],
  gifts: [{ minQuantity: 10, productId: "g1", title: "Wallet", quantity: 1, available: true }],
});

describe("parseListingOffers", () => {
  it("sorts tiers by quantity and keeps gifts", () => {
    const [o] = parseListingOffers([offer()]);
    expect(o?.tiers.map((t) => t.minQuantity)).toEqual([20, 50]);
    expect(o?.gifts).toHaveLength(1);
  });
  it.each([[undefined], [null], ["x"], [{}], [[{ offerId: "o", name: "n", tiers: [{ minQuantity: 0, unitPriceCents: 90 }] }]]])("treats %j as no offers", (v) => {
    expect(parseListingOffers(v)).toEqual([]);
  });
  it("drops one malformed offer and keeps the others", () => {
    const bad = { ...offer(), tiers: [{ minQuantity: 20, unitPriceCents: -5 }] };
    expect(parseListingOffers([bad, offer()])).toHaveLength(1);
  });
});

describe("listingOfferBadges", () => {
  it("says what to do to start saving, with the seller's own numbers", () => {
    expect(listingOfferBadges(parseListingOffers([offer()]))).toEqual(["Buy 20+, $0.90 each", "Free gift with 10+"]);
  });
  it("is empty without offers", () => {
    expect(listingOfferBadges(undefined)).toEqual([]);
    expect(listingOfferBadges([])).toEqual([]);
  });
});

const cartOffer = (over: Partial<CartOffer> = {}): CartOffer => ({ offerId: "o1", eligibleUnits: 15, tier: null, nextTier: { minQuantity: 20, unitPriceCents: 90 }, unitsToNextTier: 5, discountCents: 0, gifts: [], ...over });

describe("cartOfferMessages", () => {
  it("asks for the units still needed", () => {
    expect(cartOfferMessages(cartOffer()).map((m) => m.text)).toEqual(["Add 5 more for $0.90 each"]);
  });
  it("says a gift is included, or unavailable, and never both for one state", () => {
    const g = (status: "included" | "unavailable") => ({ productId: "g", title: "Wallet", quantity: 1, status });
    expect(cartOfferMessages(cartOffer({ nextTier: null, unitsToNextTier: 0, gifts: [g("included")] })).map((m) => m.text)).toEqual(["Free gift included"]);
    expect(cartOfferMessages(cartOffer({ nextTier: null, unitsToNextTier: 0, gifts: [g("unavailable")] })).map((m) => m.text)).toEqual(["Gift unavailable"]);
  });
  it("says nothing when the top tier is reached and there is no gift", () => {
    expect(cartOfferMessages(cartOffer({ nextTier: null, unitsToNextTier: 0 }))).toEqual([]);
  });
});

describe("parseCartOffers", () => {
  it("reads the server's pricing and drops unknown gift states", () => {
    const [o] = parseCartOffers([{ offerId: "o1", eligibleUnits: 25, tier: { minQuantity: 20, unitPriceCents: 90 }, nextTier: null, unitsToNextTier: 0, discountCents: 250,
      gifts: [{ productId: "g", title: "Wallet", quantity: 1, status: "included" }, { productId: "h", title: "Pack", quantity: 1, status: "weird" }] }]);
    expect(o?.discountCents).toBe(250);
    expect(o?.gifts.map((g) => g.productId)).toEqual(["g"]);
  });
  it("is empty for anything else", () => { expect(parseCartOffers("x")).toEqual([]); });
});
