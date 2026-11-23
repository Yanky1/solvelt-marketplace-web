import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NAV_CATEGORIES, navCategories, resetNavCache, topLevel } from "./nav.server";
import { navLinks, NAV_LINKS } from "~/components/Shell";

vi.mock("./config.server", () => ({ getConfig: vi.fn(() => ({ apiBaseUrl: "http://api.test" })) }));
vi.mock("./api.server", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "./api.server";

const ctx = { request: new Request("http://localhost/"), socketAddress: "127.0.0.1", sessionToken: "secret-session" } as never;
const node = (slug: string, name: string, listingCount = 3, children: unknown[] = []) => ({ id: slug, slug, name, listingCount, children });
const TREE = [node("food-drink", "Food & Drink", 3, [node("bakery", "Bakery", 2)]), node("home-judaica", "Home & Judaica"), node("services", "Services"), node("gifts", "Gifts", 26)];
const answer = (body: unknown, status = 200) => vi.mocked(apiFetch).mockImplementation(async () => new Response(JSON.stringify(body), { status }));

describe("topLevel", () => {
  it("keeps the top-level categories in the API's order (the portal's), never the children", () => {
    expect(topLevel(TREE)).toEqual([{ slug: "food-drink", name: "Food & Drink" }, { slug: "home-judaica", name: "Home & Judaica" }, { slug: "services", name: "Services" }, { slug: "gifts", name: "Gifts" }]);
  });
  it("caps the list and refuses what is not a tree", () => {
    expect(topLevel(Array.from({ length: 20 }, (_, i) => node(`c${i}`, `C ${i}`)))).toHaveLength(MAX_NAV_CATEGORIES);
    for (const bad of [null, "x", {}, [{ slug: 1 }]]) expect(topLevel(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe("navCategories (cached, SSR)", () => {
  beforeEach(() => { resetNavCache(); vi.mocked(apiFetch).mockReset(); });

  it("asks the API once a minute, without the visitor's session", async () => {
    answer(TREE);
    expect((await navCategories(ctx, 0)).map((c) => c.slug)).toEqual(["food-drink", "home-judaica", "services", "gifts"]);
    await navCategories(ctx, 59_000);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(apiFetch).mock.calls[0]![1]).toMatchObject({ sessionToken: undefined });   // public data: no session reaches the call
    expect(vi.mocked(apiFetch).mock.calls[0]![2]).toBe("/api/v1/catalog/categories");
    answer([node("gifts", "Gifts")]);
    expect((await navCategories(ctx, 61_000)).map((c) => c.slug)).toEqual(["gifts"]);       // a minute later: read again
  });

  it("keeps the last good list for ten minutes when the API fails, then gives up, and does not ask again for ten seconds", async () => {
    answer(TREE);
    await navCategories(ctx, 0);
    answer({}, 503);
    expect(await navCategories(ctx, 120_000)).toHaveLength(4);                               // stale but shown
    expect(await navCategories(ctx, 125_000)).toHaveLength(4);
    expect(apiFetch).toHaveBeenCalledTimes(2);                                                // no retry within ten seconds of a failure
    expect(await navCategories(ctx, 700_000)).toEqual([]);                                    // too old: the header falls back to its fixed links
  });

  it("an unreachable API at first gives an empty list (fixed links), never an error", async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error("down"));
    expect(await navCategories(ctx, 0)).toEqual([]);
  });

  it("parallel pages share one API call", async () => {
    answer(TREE);
    await Promise.all([navCategories(ctx, 0), navCategories(ctx, 0), navCategories(ctx, 0)]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe("navLinks (the header)", () => {
  const cats = topLevel(TREE)!;
  it("puts the categories first, then Categories and the fixed links a category does not already name", () => {
    expect(navLinks(cats, 6)).toEqual([
      { to: "/c/food-drink", label: "Food & Drink" }, { to: "/c/home-judaica", label: "Home & Judaica" }, { to: "/c/services", label: "Services" }, { to: "/c/gifts", label: "Gifts" },
      { to: "/categories", label: "Categories" }, { to: "/brands", label: "Brands" },
    ]);
  });
  it("says All categories when the bar cannot show them all", () => {
    const links = navLinks(cats, 2);
    expect(links.slice(0, 3).map((l) => l.label)).toEqual(["Food & Drink", "Home & Judaica", "All categories"]);
  });
  it("is the fixed list when there are no categories", () => {
    expect(navLinks([], 6)).toBe(NAV_LINKS);
    expect(navLinks(undefined, 6)).toBe(NAV_LINKS);
  });
});
