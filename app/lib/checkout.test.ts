import { describe, expect, it } from "vitest";
import { carrierValue, deliveryField, estimateText, localValue, readCheckoutValues, readSelections, validateCheckout } from "./checkout";

const g = [{ sellerId: "s1", brandId: "b1" }, { sellerId: "s2", brandId: "b2" }];
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe("readSelections", () => {
  it("reads a carrier speed and a local window for the groups it was given", () => {
    const f = form({ [deliveryField(g[0]!)]: carrierValue("overnight"), [deliveryField(g[1]!)]: localValue("w-1", "2026-11-06") });
    expect(readSelections(f, g)).toEqual([
      { sellerId: "s1", brandId: "b1", speed: "overnight" },
      { sellerId: "s2", brandId: "b2", localWindowId: "w-1", localDate: "2026-11-06" },
    ]);
  });
  it("ignores groups it was not given, malformed values and anything that could carry a price", () => {
    const f = form({
      [deliveryField(g[0]!)]: "carrier:../../x", [deliveryField(g[1]!)]: "local:w-1:tomorrow", "delivery:evil:evil": "carrier:standard", priceCents: "1", totalCents: "1",
    });
    expect(readSelections(f, g)).toEqual([]);
  });
  it("has no money field to read at all", () => {
    const f = form({ [deliveryField(g[0]!)]: carrierValue("standard"), shippingCents: "0" });
    expect(JSON.stringify(readSelections(f, g))).not.toMatch(/cents/i);
  });
});

describe("validateCheckout", () => {
  const base = () => form({ fullName: "Dana Levi", line1: "1 Main St", city: "Brooklyn", region: "NY", postalCode: "11201", country: "US", email: "  Dana@Example.COM " });
  it("accepts a US address with a state and normalises the email", () => {
    const v = readCheckoutValues(base());
    expect(v.email).toBe("dana@example.com");
    expect(validateCheckout(v, true)).toEqual({});
  });
  it("needs a two-letter state for the US, and a good email only for guests", () => {
    const f = base(); f.set("region", "New York"); f.set("email", "nope");
    const v = readCheckoutValues(f);
    expect(validateCheckout(v, true)).toMatchObject({ region: expect.any(String), email: expect.any(String) });
    expect(validateCheckout(v, false).email).toBeUndefined();
    const other = base(); other.set("country", "CA"); other.set("region", "");
    expect(validateCheckout(readCheckoutValues(other), false).region).toBeUndefined();
  });
  it("cuts the gift message to 500 characters", () => {
    const f = base(); f.set("giftMessage", "x".repeat(900));
    expect(readCheckoutValues(f).giftMessage).toHaveLength(500);
  });
});

describe("estimateText", () => {
  it("says one date or a range", () => {
    expect(estimateText({ earliest: "2026-11-06", latest: "2026-11-06" })).toBe("arrives 2026-11-06");
    expect(estimateText({ earliest: "2026-11-06", latest: "2026-11-09" })).toBe("arrives 2026-11-06 to 2026-11-09");
  });
});
