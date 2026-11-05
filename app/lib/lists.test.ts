import { describe, expect, it } from "vitest";
import { GUEST_VIEWED_KEY, MAX_RECENT, clearGuestViewed, guestViewedIds, parseCard, parseItems, parseSummary, readGuestViewed, recordGuestView, type ListCardView } from "./lists";
import { USER_STORAGE_PREFIX, clearUserScopedStorage } from "./client-storage";

class MemStore implements Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> {
  m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const card = (n: number): ListCardView => ({ id: `id${n}`, slug: `item-${n}`, type: "product", title: `Item ${n}`, priceFromCents: 100 + n, priceToCents: 100 + n, currency: "USD", available: true, brandName: "B", sellerName: "S", image: null });

describe("guest recently viewed", () => {
  it("is newest first, one entry per listing, capped", () => {
    const s = new MemStore();
    for (let i = 0; i < 25; i++) recordGuestView(s, card(i));
    recordGuestView(s, card(10));   // seen again: moves to the front, no duplicate
    const ids = guestViewedIds(s);
    expect(ids).toHaveLength(MAX_RECENT);
    expect(ids[0]).toBe("id10");
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[1]).toBe("id24");
    expect(ids).not.toContain("id0");
  });
  it("lives under the user-scoped prefix, so sign-out clears it", () => {
    expect(GUEST_VIEWED_KEY.startsWith(USER_STORAGE_PREFIX)).toBe(true);
    const s = new MemStore();
    recordGuestView(s, card(1));
    s.setItem("solvelt.device.theme", "dark");
    clearUserScopedStorage([s]);
    expect(readGuestViewed(s)).toEqual([]);
    expect(s.getItem("solvelt.device.theme")).toBe("dark");
  });
  it("is removed after the merge, and what it holds is catalog data only", () => {
    const s = new MemStore();
    recordGuestView(s, card(1));
    expect(Object.keys(JSON.parse(s.getItem(GUEST_VIEWED_KEY)!)[0]).sort()).toEqual(["available", "brandName", "currency", "id", "image", "priceFromCents", "priceToCents", "sellerName", "slug", "title", "type"]);
    clearGuestViewed(s);
    expect(guestViewedIds(s)).toEqual([]);
  });
  it("ignores a damaged or hostile store value", () => {
    const s = new MemStore();
    for (const bad of ["not json", "{}", "[1,2]", JSON.stringify([{ id: "x" }]), JSON.stringify([{ ...card(1), currency: "usd" }])]) {
      s.setItem(GUEST_VIEWED_KEY, bad);
      expect(readGuestViewed(s)).toEqual([]);
    }
    const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
    expect(readGuestViewed(blocked)).toEqual([]);
    expect(() => recordGuestView(blocked, card(1))).not.toThrow();
  });
});

describe("parsers", () => {
  it("accept what the API sends and drop what is malformed", () => {
    expect(parseCard({ ...card(1), image: { id: "im", width: 10, height: 20, alt: "a" } })?.image).toEqual({ id: "im", width: 10, height: 20, alt: "a" });
    expect(parseCard({ ...card(1), priceFromCents: -1 })).toBeNull();
    expect(parseCard({ ...card(1), available: "yes" })).toBeNull();
    expect(parseCard(null)).toBeNull();
    expect(parseSummary({ id: "w1", name: "Gifts", itemCount: 2, shared: true, sharedAt: "2026-11-05T10:00:00Z" })).toMatchObject({ id: "w1", shared: true });
    expect(parseSummary({ id: "w1", name: "Gifts", itemCount: "2" })).toBeNull();
    const items = parseItems([{ listingId: "a", addedAt: "t", unavailable: true, listing: null }, { listingId: "b", addedAt: "t", unavailable: false, listing: card(2) }, { nope: 1 }]);
    expect(items.map((i) => [i.listingId, i.unavailable, i.listing?.id ?? null])).toEqual([["a", true, null], ["b", false, "id2"]]);
    expect(parseItems("x")).toEqual([]);
  });
});
