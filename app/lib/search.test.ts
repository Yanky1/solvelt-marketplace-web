import { describe, expect, it } from "vitest";
import { hasFilters, activeFilters, centsAddress, cleanQuery, defaultSort, effectiveSort, emptyQuery, parseBrandStorefront, parseListingPage, parseListingQuery, parseSellerStorefront, parseSuggestions, toApiParams, toSearchParams, withChange, type ListingQuery } from "./search";

const parse = (qs: string, fixed = {}) => parseListingQuery(new URLSearchParams(qs), fixed);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

describe("parseListingQuery", () => {
  it("reads every filter", () => {
    const q = parse("q=challah&type=product&brand=challah-corner&priceMin=500&priceMax=2000&available=true&kosher=OU,Star-K&delivery=ships&attr=kosher-status:pareve&sort=price_asc&page=3");
    expect(q).toEqual({ q: "challah", type: "product", brand: "challah-corner", priceMin: 500, priceMax: 2000, available: true, kosher: ["OU", "Star-K"], delivery: ["ships"], attr: ["kosher-status:pareve"], sort: "price_asc", page: 3, category: undefined, seller: undefined });
  });

  it("reads repeated form fields as well as comma lists, without duplicates", () => {
    expect(parse("kosher=OU&kosher=Star-K&kosher=OU").kosher).toEqual(["OU", "Star-K"]);
    expect(parse("delivery=ships,local&delivery=online").delivery).toEqual(["ships", "local", "online"]);
  });

  it("drops what it does not understand instead of repairing it", () => {
    const q = parse("type=gadget&brand=../etc&category=a b&seller=%00&priceMin=-5&priceMax=1e3&available=yes&delivery=teleport&sort=random&page=0&attr=nocolon&attr=Bad Key:x&attr=ok:");
    expect(q).toEqual({ ...emptyQuery() });
  });

  it("drops an inverted price range's maximum and keeps its minimum", () => {
    const q = parse("priceMin=900&priceMax=100");
    expect([q.priceMin, q.priceMax]).toEqual([900, undefined]);
  });

  it("bounds every number and list to what the API accepts", () => {
    expect(parse("page=100001").page).toBe(1);
    expect(parse("page=100000").page).toBe(100000);
    expect(parse("priceMax=1000000000001").priceMax).toBeUndefined();
    expect(parse("priceMax=1000000000000").priceMax).toBe(1_000_000_000_000);
    expect(parse(`kosher=${Array.from({ length: 30 }, (_, i) => `K${i}`).join(",")}`).kosher).toHaveLength(10);
    expect(parse(Array.from({ length: 30 }, (_, i) => `attr=k${i}:v`).join("&")).attr).toHaveLength(12);
    expect(parse(`kosher=${"x".repeat(61)}`).kosher).toEqual([]);
  });

  it("cleans the search text: no control characters, one space between words, at most 100 whole characters", () => {
    expect(cleanQuery("  a\u0000b\t\tc \u2028d  ")).toBe("a b c d");
    expect(cleanQuery("😀".repeat(150))).toBe("😀".repeat(100));      // never cut inside a surrogate pair
    expect(parse("q=" + encodeURIComponent("x".repeat(300))).q).toHaveLength(100);
  });

  it("keeps Hebrew and other non-Latin search text as typed", () => {
    expect(parse("q=" + encodeURIComponent("חלה מתוקה")).q).toBe("חלה מתוקה");
  });

  it("relevance is only a sort when there is a search", () => {
    expect(parse("sort=relevance").sort).toBeUndefined();
    expect(parse("q=a&sort=relevance").sort).toBe("relevance");
  });

  it("a path's fixed filter wins over the address", () => {
    expect(parse("category=other", { category: "bakery" }).category).toBe("bakery");
    expect(parse("category=bakery").category).toBe("bakery");
    expect(parse("", { category: "bad slug!" }).category).toBeUndefined();
  });
});

describe("addresses", () => {
  const rich: ListingQuery = { q: "קפה coffee", type: "service", category: "bakery", brand: "b-1", seller: "s-1", priceMin: 100, priceMax: 9900, available: true, kosher: ["OU"], delivery: ["ships", "local"], attr: ["kosher-status:dairy", "a:b c"], sort: "title", page: 2 };

  it("writes one canonical address and reads it back to the same query", () => {
    const p = toSearchParams(rich);
    expect([...p.keys()]).toEqual(["q", "type", "category", "brand", "seller", "priceMin", "priceMax", "available", "kosher", "delivery", "attr", "attr", "sort", "page"]);
    expect(parseListingQuery(p)).toEqual(rich);
    expect(toSearchParams(parseListingQuery(p)).toString()).toBe(p.toString());
  });

  it("leaves out defaults: page 1, and the sort the page would use anyway", () => {
    expect(toSearchParams({ ...emptyQuery(), sort: "newest", page: 1 }).toString()).toBe("");
    expect(toSearchParams({ ...emptyQuery(), q: "a", sort: "relevance" }).toString()).toBe("q=a");
    expect(toSearchParams({ ...emptyQuery(), q: "a", sort: "newest" }).toString()).toBe("q=a&sort=newest");
    expect(defaultSort({ q: "" })).toBe("newest");
    expect(effectiveSort({ q: "x", sort: undefined })).toBe("relevance");
  });

  it("omits what the path already says", () => {
    expect(toSearchParams({ ...emptyQuery(), category: "bakery", available: true }, ["category"]).toString()).toBe("available=true");
  });

  it("a change to any filter goes back to page 1, a page change keeps the page", () => {
    expect(withChange({ ...emptyQuery(), page: 4 }, { available: true }).page).toBe(1);
    expect(withChange({ ...emptyQuery(), page: 4 }, { page: 5 }).page).toBe(5);
  });

  it("the API only ever receives known parameters, whatever the address said (O-12)", () => {
    const allowed = new Set(["q", "type", "category", "brand", "seller", "priceMin", "priceMax", "available", "kosher", "delivery", "attr", "sort", "page", "facets", "pageSize"]);
    const hostile = ["/api/admin/users", "../../x", "cursor=abc", "facets=false&pageSize=100000", "__proto__=1&constructor=2", "q=a&q=b&q=c", "sort=price_asc;drop", "attr=a:b&attr=%00:x"];
    for (const qs of hostile) {
      const keys = [...toApiParams(parse(qs + "&unknown=1&cursor=zzz&admin=true"), { facets: true }).keys()];
      expect(keys.filter((k) => !allowed.has(k))).toEqual([]);
    }
    const p = toApiParams(parse("q=x&page=2"), { facets: true });
    expect([p.get("facets"), p.get("pageSize"), p.get("page")]).toEqual(["true", "24", "2"]);
  });
});

describe("centsAddress (the filter form sends dollars)", () => {
  const go = (qs: string) => centsAddress(new URL("https://x.test/search?" + qs));
  it("converts to cents, drops the form fields and restarts at page 1", () => {
    const u = go("q=a&priceMinD=12.5&priceMaxD=30&page=3")!;
    expect(u.search).toBe("?q=a&priceMin=1250&priceMax=3000");
  });
  it("handles cents exactly and ignores what is not money", () => {
    expect(go("priceMinD=0.07")!.searchParams.get("priceMin")).toBe("7");
    expect(go("priceMinD=19.99")!.searchParams.get("priceMin")).toBe("1999");
    const bad = go("priceMinD=abc&priceMaxD=-4&priceMin=77&priceMax=88")!;
    expect([bad.searchParams.get("priceMin"), bad.searchParams.get("priceMax")]).toEqual([null, null]);
    expect(go("priceMinD=")!.searchParams.get("priceMin")).toBeNull();
  });
  it("is null when the address has no dollar fields", () => expect(go("priceMin=100")).toBeNull());
});

const card = (over: Record<string, unknown> = {}) => ({ id: "i1", slug: "s1", type: "product", title: "T", summary: "S", priceFromCents: 100, priceToCents: 200, compareAtFromCents: null, currency: "USD", available: true, brand: { id: "b", slug: "b", name: "B" }, seller: { id: "s", displayName: "S" }, category: { id: "c", slug: "c", name: "C" }, image: { id: "im", width: 100, height: 100, alt: "a" }, ...over });
const page = (over: Record<string, unknown> = {}) => ({ items: [card()], page: 1, pageSize: 24, total: 1, totalPages: 1, nextCursor: null, ...over });

describe("parseListingPage", () => {
  it("reads a page with facets", () => {
    const p = parseListingPage(page({ facets: { categories: [{ id: "1", slug: "a", name: "A", listingCount: 2, children: [] }], brands: [{ id: "x", slug: "b", name: "B", count: 1 }], sellers: [], types: [{ value: "product", count: 1 }], available: 1, price: { minCents: 1, maxCents: 2 }, attributes: { delivery: [{ value: "ships", count: 1 }], "Bad Key": [{ value: "x", count: 1 }] } } }));
    expect(p?.items).toHaveLength(1);
    expect(p?.facets?.attributes).toEqual({ delivery: [{ value: "ships", count: 1 }] });       // a key we could not put back in an address is dropped
    expect(p?.facets?.price).toEqual({ minCents: 1, maxCents: 2 });
  });
  it("has no facets when none were asked for, and a null price when nothing matches", () => {
    expect(parseListingPage(page())?.facets).toBeNull();
    expect(parseListingPage(page({ facets: { categories: [], price: { minCents: null, maxCents: null } } }))?.facets?.price).toBeNull();
  });
  it("refuses anything that is not what the API promises", () => {
    for (const bad of [null, "x", [], {}, page({ items: "no" }), page({ items: [card({ priceFromCents: -1 })] }), page({ items: [card({ currency: "usd" })] }), page({ items: [card({ type: "gadget" })] }), page({ total: "3" }), page({ items: [card({ slug: undefined })] }), page({ facets: "oops" }), page({ facets: { categories: "oops" } })])
      expect(parseListingPage(bad)).toBeNull();
  });
  it("never lets a range run backwards and tolerates a missing image or category", () => {
    const c = parseListingPage(page({ items: [card({ priceFromCents: 500, priceToCents: 100, image: null, category: null })] }))!.items[0]!;
    expect([c.priceToCents, c.image, c.category]).toEqual([500, null, null]);
  });
});

describe("activeFilters", () => {
  it("makes a chip per filter, each one the query without it", () => {
    const q: ListingQuery = { ...emptyQuery(), type: "service", brand: "b", priceMin: 500, available: true, kosher: ["OU", "Star-K"], delivery: ["at-home"], attr: ["k:v"], page: 4 };
    const chips = activeFilters(q, { categories: [], brands: [{ slug: "b", name: "Brand B", count: 1 }], types: [], available: 0, price: null, attributes: {} }, money);
    expect(chips.map((c) => c.label)).toEqual(["Services", "Brand B", "$5.00 and up", "In stock", "OU", "Star-K", "Comes to you", "k: v"]);
    const kosher = chips.find((c) => c.key === "kosher:OU")!;
    expect(kosher.without.kosher).toEqual(["Star-K"]);
    expect(kosher.without.page).toBe(1);
    expect(chips.find((c) => c.key === "price")!.without.priceMin).toBeUndefined();
  });
});

describe("storefront parsers", () => {
  const brand = (over: Record<string, unknown> = {}) => ({ id: "b1", slug: "challah-corner", name: "Challah Corner", logoImageId: null, listingCount: 3, seller: { id: "s1", displayName: "Mazel" }, categories: [{ id: "c", slug: "bakery", name: "Bakery", listingCount: 3, children: [] }], ...over });
  it("reads a brand and a seller with their category trees and brands", () => {
    expect(parseBrandStorefront(brand())?.categories[0]?.slug).toBe("bakery");
    const seller = parseSellerStorefront({ id: "s1", displayName: "Mazel", listingCount: 5, brands: [brand()], categories: [] });
    expect([seller?.brands.length, seller?.brands[0]?.slug, seller?.listingCount]).toEqual([1, "challah-corner", 5]);
  });
  it("keeps a logo id and tolerates none", () => {
    expect(parseBrandStorefront(brand({ logoImageId: "img1" }))?.logoImageId).toBe("img1");
    expect(parseBrandStorefront(brand())?.logoImageId).toBeNull();
  });
  it("refuses a malformed answer", () => {
    for (const bad of [null, "x", {}, brand({ listingCount: -1 }), brand({ seller: null }), brand({ categories: "no" }), brand({ slug: undefined })]) expect(parseBrandStorefront(bad)).toBeNull();
    for (const bad of [null, {}, { id: "s", displayName: "x", listingCount: 1, brands: "no" }, { id: "s", displayName: "x", listingCount: 1, brands: [{}] }, { id: "s", displayName: "x", listingCount: 1, brands: [], categories: "no" }]) expect(parseSellerStorefront(bad)).toBeNull();
  });
});

describe("hasFilters", () => {
  it("does not count what the page's path already fixes", () => {
    expect(hasFilters({ ...emptyQuery(), brand: "b" })).toBe(true);
    expect(hasFilters({ ...emptyQuery(), brand: "b" }, ["brand"])).toBe(false);
    expect(hasFilters({ ...emptyQuery(), seller: "s", brand: "b" }, ["seller"])).toBe(true);        // a brand inside a seller page is a real filter
    expect(hasFilters({ ...emptyQuery(), category: "c" }, ["category"])).toBe(false);
    expect(hasFilters({ ...emptyQuery(), available: true }, ["brand", "seller", "category"])).toBe(true);
  });
});

describe("parseSuggestions", () => {
  it("reads the three kinds and leaves out one bad entry without losing the list", () => {
    const out = parseSuggestions({ query: "c", suggestions: [{ kind: "listing", text: "A", slug: "a" }, { kind: "brand", text: "B", slug: "../b" }, { kind: "robot", text: "C", slug: "c" }, { kind: "category", text: "D" }, { kind: "category", text: "E", slug: "e" }] });
    expect(out).toEqual([{ kind: "listing", text: "A", slug: "a" }, { kind: "category", text: "E", slug: "e" }]);
  });
  it("is null when the answer is not a suggestion list, and never longer than 20", () => {
    for (const bad of [null, "x", {}, { suggestions: "no" }]) expect(parseSuggestions(bad)).toBeNull();
    expect(parseSuggestions({ suggestions: Array.from({ length: 50 }, (_, i) => ({ kind: "listing", text: `T${i}`, slug: `s${i}` })) })).toHaveLength(20);
  });
});

describe("a page that fixes the type (/services)", () => {
  it("takes the type from the page, never from the address, and leaves it out of the address", () => {
    const q = parseListingQuery(new URLSearchParams("type=product&sort=price_asc"), { type: "service" });
    expect(q.type).toBe("service");
    expect(toSearchParams(q, ["type"]).toString()).toBe("sort=price_asc");
    expect(toSearchParams(q).toString()).toBe("type=service&sort=price_asc");
  });
  it("does not count the fixed type as a filter or show it as a chip", () => {
    const q = parseListingQuery(new URLSearchParams(""), { type: "service" });
    expect(hasFilters(q, ["type"])).toBe(false);
    expect(hasFilters(q)).toBe(true);
    expect(activeFilters(q, null, (c) => String(c), ["type"])).toEqual([]);
    expect(activeFilters(q, null, (c) => String(c)).map((c) => c.key)).toEqual(["type"]);
  });
  it("still counts every other filter", () => {
    const q = parseListingQuery(new URLSearchParams("available=true"), { type: "service" });
    expect(hasFilters(q, ["type"])).toBe(true);
    expect(activeFilters(q, null, (c) => String(c), ["type"]).map((c) => c.key)).toEqual(["available"]);
  });
  it("a brand page's own brand is no chip either", () => {
    const q = parseListingQuery(new URLSearchParams(""), { brand: "clay" });
    expect(activeFilters(q, null, (c) => String(c), ["brand"])).toEqual([]);
  });
});
