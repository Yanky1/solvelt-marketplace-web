import { describe, expect, it } from "vitest";
import { parseListingDetail } from "./catalog";
import { breadcrumbJsonLd, clipText, jsonLdString, listingJsonLd, priceString } from "./seo";

const listing = (over: Record<string, unknown> = {}) => parseListingDetail({
  id: "11111111-1111-1111-1111-111111111111", slug: "classic-braided-challah", type: "product", title: "Classic Braided Challah", summary: "Fresh.", description: "A challah.",
  priceFromCents: 650, priceToCents: 950, compareAtFromCents: null, currency: "USD", available: true,
  brand: { id: "b1", slug: "challah-corner", name: "Challah Corner" }, seller: { id: "s1", displayName: "Mazel Bakery" },
  categoryPath: [{ id: "c1", slug: "food-drink", name: "Food & Drink" }, { id: "c2", slug: "bakery", name: "Bakery" }],
  variants: [{ id: "v1", name: "Small", priceCents: 650, compareAtCents: null, available: true }, { id: "v2", name: "Large", priceCents: 950, compareAtCents: null, available: false }],
  images: [{ id: "i1", width: 1200, height: 1200, alt: "p" }], attributes: [], faqs: [], createdAt: "x", updatedAt: "y", ...over,
})!;

describe("jsonLdString", () => {
  it("cannot be closed or reopened by catalog text", () => {
    const s = jsonLdString({ name: "</script><script>alert(1)</script>", d: "a&b <b>" });
    expect(s).not.toContain("<");
    expect(s).not.toContain(">");
    expect(s).not.toContain("&");
    expect(JSON.parse(s).name).toBe("</script><script>alert(1)</script>");       // still the same data once parsed
  });
  it("escapes the line separators JSON allows but JavaScript does not", () => {
    const s = jsonLdString({ t: "a\u2028b\u2029c" });
    expect(s).not.toMatch(/[\u2028\u2029]/);
    expect(JSON.parse(s).t).toBe("a\u2028b\u2029c");
  });
});

describe("clipText", () => {
  it("leaves short text alone and collapses whitespace", () => expect(clipText("  a\n\n b\tc ")).toBe("a b c"));
  it("cuts on a word with an ellipsis, within the limit", () => {
    const t = clipText("word ".repeat(100), 50);
    expect(t.length).toBeLessThanOrEqual(50);
    expect(t.endsWith("…")).toBe(true);
    expect(t.endsWith(" …")).toBe(false);
  });
  it("is exact at the boundary", () => { expect(clipText("a".repeat(155))).toHaveLength(155); expect(clipText("a".repeat(156)).endsWith("…")).toBe(true); });
});

describe("priceString", () => it("is a decimal with two places", () => { expect(priceString(650)).toBe("6.50"); expect(priceString(5)).toBe("0.05"); expect(priceString(100000)).toBe("1000.00"); }));

describe("listingJsonLd", () => {
  const origin = "https://shop.example";
  it("is a Product with one Offer per variant and the stock of each", () => {
    const ld = listingJsonLd(listing(), origin) as Record<string, unknown> & { offers: Record<string, unknown>[] };
    expect(ld["@type"]).toBe("Product");
    expect(ld.url).toBe("https://shop.example/p/classic-braided-challah");
    expect(ld.offers.map((o) => [o.name, o.price, o.priceCurrency, o.availability])).toEqual([
      ["Small", "6.50", "USD", "https://schema.org/InStock"], ["Large", "9.50", "USD", "https://schema.org/OutOfStock"],
    ]);
    expect(ld.offers[0]!.url).toBe("https://shop.example/p/classic-braided-challah?variant=v1");
    expect(ld.brand).toEqual({ "@type": "Brand", name: "Challah Corner" });
    expect(ld.category).toBe("Food & Drink > Bakery");
    expect((ld.image as string[])[0]).toBe("https://shop.example/img/i1?w=1200");
  });
  it("is a Service for a service", () => {
    const ld = listingJsonLd(listing({ type: "service" }), origin) as Record<string, unknown>;
    expect(ld["@type"]).toBe("Service");
    expect(ld.provider).toEqual({ "@type": "Organization", name: "Mazel Bakery" });
    expect(ld.serviceType).toBe("Bakery");
    expect(ld.brand).toBeUndefined();
  });
  it("has no image key without images", () => expect("image" in (listingJsonLd(listing({ images: [] }), origin) as object)).toBe(false));
  it("never uses the caller's path or a variant in the canonical url", () => expect((listingJsonLd(listing(), origin) as { url: string }).url).not.toContain("?"));
});

describe("breadcrumbJsonLd", () => it("numbers the items from 1 with absolute urls", () => {
  const ld = breadcrumbJsonLd("https://shop.example", [{ name: "Home", path: "/" }, { name: "Bakery", path: "/c/bakery" }]);
  expect(ld.itemListElement.map((i) => [i.position, i.item])).toEqual([[1, "https://shop.example/"], [2, "https://shop.example/c/bakery"]]);
}));
