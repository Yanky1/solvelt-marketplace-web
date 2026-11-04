import { describe, expect, it } from "vitest";
import { isCatalogKey } from "./catalog.server";
import { attributeLabel, deliveryLabels, parseListingDetail, pickVariant, serviceLocations, specAttributes } from "./catalog";

const good = () => ({
  id: "11111111-1111-1111-1111-111111111111", slug: "classic-braided-challah", type: "product", title: "Classic Braided Challah", summary: "Fresh.", description: "A challah.\n\nTwo paragraphs.",
  priceFromCents: 650, priceToCents: 950, compareAtFromCents: 750, currency: "USD", available: true,
  brand: { id: "b1", slug: "challah-corner", name: "Challah Corner" }, seller: { id: "s1", displayName: "Mazel Bakery" },
  categoryPath: [{ id: "c1", slug: "food-drink", name: "Food & Drink" }],
  variants: [{ id: "v1", name: "Small", priceCents: 650, compareAtCents: 750, available: false }, { id: "v2", name: "Large", priceCents: 950, compareAtCents: null, available: true }],
  images: [{ id: "i1", width: 1200, height: 1200, alt: "photo" }], attributes: [{ key: "kosher-certification", value: "OU" }, { key: "delivery", value: "ships" }, { key: "delivery", value: "local" }],
  faqs: [{ question: "Q?", answer: "A." }], createdAt: "2026-09-01T09:00:00+00:00", updatedAt: "2026-09-04T09:00:00+00:00",
});

describe("parseListingDetail", () => {
  it("accepts the documented shape", () => {
    const l = parseListingDetail(good());
    expect(l?.slug).toBe("classic-braided-challah");
    expect(l?.variants).toHaveLength(2);
  });
  it("accepts a null compare-at price on a variant and on the listing", () => {
    const j = good(); j.compareAtFromCents = null as never;
    expect(parseListingDetail(j)?.compareAtFromCents).toBeNull();
  });
  it.each([
    ["null", null], ["an array", []], ["a string", "x"],
  ])("rejects %s", (_n, v) => expect(parseListingDetail(v)).toBeNull());
  it.each([
    ["no variants", (j: ReturnType<typeof good>) => { j.variants = []; }],
    ["a negative price", (j: ReturnType<typeof good>) => { j.priceFromCents = -1; }],
    ["a fractional price", (j: ReturnType<typeof good>) => { j.priceFromCents = 6.5; }],
    ["a string price", (j: ReturnType<typeof good>) => { (j as { priceToCents: unknown }).priceToCents = "950"; }],
    ["an unknown type", (j: ReturnType<typeof good>) => { (j as { type: unknown }).type = "gadget"; }],
    ["a variant without availability", (j: ReturnType<typeof good>) => { delete (j.variants[0] as { available?: boolean }).available; }],
    ["a variant with a bad compare-at", (j: ReturnType<typeof good>) => { (j.variants[0] as { compareAtCents: unknown }).compareAtCents = "x"; }],
    ["an image without size", (j: ReturnType<typeof good>) => { (j.images[0] as { width: unknown }).width = 0; }],
    ["a missing brand", (j: ReturnType<typeof good>) => { delete (j as { brand?: unknown }).brand; }],
    ["a seller without a name", (j: ReturnType<typeof good>) => { (j.seller as { displayName: unknown }).displayName = 5; }],
    ["a missing available flag", (j: ReturnType<typeof good>) => { delete (j as { available?: unknown }).available; }],
    ["a currency of the wrong length", (j: ReturnType<typeof good>) => { j.currency = "US"; }],
    ["too many variants", (j: ReturnType<typeof good>) => { j.variants = Array.from({ length: 201 }, (_, i) => ({ id: `v${i}`, name: "x", priceCents: 1, compareAtCents: null, available: true })); }],
  ])("rejects %s as a whole", (_n, mutate) => { const j = good(); mutate(j); expect(parseListingDetail(j)).toBeNull(); });
  it("accepts exactly 200 variants", () => {
    const j = good(); j.variants = Array.from({ length: 200 }, (_, i) => ({ id: `v${i}`, name: "x", priceCents: 1, compareAtCents: null, available: true }));
    expect(parseListingDetail(j)?.variants).toHaveLength(200);
  });
});

describe("pickVariant", () => {
  const l = parseListingDetail(good())!;
  it("takes the one asked for, even if sold out", () => expect(pickVariant(l, "v1").id).toBe("v1"));
  it("falls back to the first one that can be bought", () => { expect(pickVariant(l, null).id).toBe("v2"); expect(pickVariant(l, "nonsense").id).toBe("v2"); expect(pickVariant(l, "").id).toBe("v2"); });
  it("falls back to the first when none can be bought", () => {
    const sold = { variants: l.variants.map((v) => ({ ...v, available: false })) };
    expect(pickVariant(sold, undefined).id).toBe("v1");
  });
});

describe("attributes", () => {
  const l = parseListingDetail(good())!;
  it("labels delivery options and leaves them out of the spec rows", () => {
    expect(deliveryLabels(l)).toEqual(["Ships to you", "Local delivery"]);
    expect(specAttributes(l).map((a) => a.key)).toEqual(["kosher-certification"]);
  });
  it("lists where a service is offered in a fixed order, and labels the provider's own place", () => {
    const attrs = [["delivery", "at-seller"], ["delivery", "online"], ["delivery", "ships"], ["delivery", "at-home"]].map(([key, value]) => ({ key: key!, value: value! }));
    expect(serviceLocations({ attributes: attrs })).toEqual(["online", "at-home", "at-seller"]);
    expect(serviceLocations({ attributes: [] })).toEqual([]);
    expect(deliveryLabels({ attributes: [{ key: "delivery", value: "at-seller" }] })).toEqual(["At the provider"]);
  });
  it("ignores delivery values it does not know", () => expect(deliveryLabels({ attributes: [{ key: "delivery", value: "teleport" }] })).toEqual([]));
  it("makes a readable label from a key", () => {
    expect(attributeLabel("kosher-certification")).toBe("Kosher certification");
    expect(attributeLabel("burn-time")).toBe("Burn time");
    expect(attributeLabel("weight")).toBe("Weight");
  });
});

describe("isCatalogKey (what may reach the API as a path segment)", () => {
  it.each(["classic-braided-challah", "11111111-1111-1111-1111-111111111111", "a", "A_b-c9", "a".repeat(160)])("accepts %s", (k) => expect(isCatalogKey(k)).toBe(true));
  it.each(["", "..", ".", "a/b", "a\\b", "a b", "a?b", "a#b", "%2e%2e", "a%2Fb", "-a", "_a", "a\u0000b", "a\nb", "é", "a".repeat(161)])("refuses %j", (k) => expect(isCatalogKey(k)).toBe(false));
});
