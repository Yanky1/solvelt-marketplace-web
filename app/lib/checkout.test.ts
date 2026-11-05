import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINAL_ORDER_STATUSES, MAX_POLLS, POLL_INTERVAL_MS, carrierValue, deliveryField, estimateText, guestExpiry, guestTokenFor, hasReturnParams, localValue, looksLikeGuestToken, readCheckoutValues, readSelections, startPolling, validateCheckout } from "./checkout";

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

describe("the guest order token", () => {
  const go = { n: "MP-1", t: "tok_abcdefghijklmnop", e: 2000 };
  it("is bound to the order number it was issued for", () => {
    expect(guestTokenFor(go, "MP-1", 1000)).toBe("tok_abcdefghijklmnop");
    expect(guestTokenFor(go, "MP-2", 1000)).toBeUndefined();            // another order's page never gets it
    expect(guestTokenFor(undefined, "MP-1", 1000)).toBeUndefined();
  });
  it("stops working at the API's expiry, and without an expiry it is not capped here", () => {
    expect(guestTokenFor(go, "MP-1", 1999)).toBeDefined();
    expect(guestTokenFor(go, "MP-1", 2000)).toBeUndefined();
    expect(guestTokenFor({ n: "MP-1", t: "tok_abcdefghijklmnop" }, "MP-1", 9e9)).toBeDefined();
  });
  it("takes the API's expiry date, never more than a week ahead, and a day when it is missing", () => {
    expect(guestExpiry("2026-11-05T12:00:00Z", Date.parse("2026-11-05T00:00:00Z") / 1000)).toBe(Date.parse("2026-11-05T12:00:00Z") / 1000);
    expect(guestExpiry("2030-01-01T00:00:00Z", 1_000_000)).toBe(1_000_000 + 7 * 86400);
    expect(guestExpiry(undefined, 1_000_000)).toBe(1_000_000 + 86400);
    expect(guestExpiry("garbage", 1_000_000)).toBe(1_000_000 + 86400);
  });
  it("accepts only token-shaped values from a link", () => {
    expect(looksLikeGuestToken("abcDEF012345_-.~xyz")).toBe(true);
    for (const bad of ["", "short", "a b c d e f g h i j k l", "x".repeat(121), "../../etc/passwd/........", 42, null, undefined]) expect(looksLikeGuestToken(bad)).toBe(false);
  });
  it("knows the statuses an order never leaves", () => {
    expect([...FINAL_ORDER_STATUSES].sort()).toEqual(["expired", "failed", "placed", "superseded"]);
  });
});

describe("the return address from Stripe", () => {
  it("is recognised by any of Stripe's parameters", () => {
    for (const q of ["?redirect_status=succeeded", "?payment_intent=pi_1", "?payment_intent_client_secret=pi_1_secret_x&redirect_status=failed"]) expect(hasReturnParams(new URL("http://x/checkout/confirmation/MP-1" + q))).toBe(true);
    expect(hasReturnParams(new URL("http://x/checkout/confirmation/MP-1"))).toBe(false);
    expect(hasReturnParams(new URL("http://x/checkout/confirmation/MP-1?utm=1"))).toBe(false);
  });
});

describe("startPolling", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("stops after the cap even when every tick finds the router busy and idle in turn (the count is not reset by state changes)", () => {
    let idle = true;
    const revalidate = vi.fn(() => { idle = false; setTimeout(() => { idle = true; }, 100); });   // a revalidation flips the router's state and back, as in the app
    const stop = startPolling(revalidate, () => idle);
    vi.advanceTimersByTime(POLL_INTERVAL_MS * (MAX_POLLS + 20));
    expect(revalidate.mock.calls.length).toBe(MAX_POLLS);
    stop();
  });
  it("does not revalidate while the router is busy and stops when told to", () => {
    const revalidate = vi.fn();
    const stop = startPolling(revalidate, () => false, 10, 5);
    vi.advanceTimersByTime(100);
    expect(revalidate).not.toHaveBeenCalled();
    const r2 = vi.fn();
    const stop2 = startPolling(r2, () => true, 10, 100);
    vi.advanceTimersByTime(35);
    stop2();
    vi.advanceTimersByTime(100);
    expect(r2).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe("publishableKeyOk", () => {
  it("accepts only key-shaped values, and outside production only test keys", async () => {
    const { publishableKeyOk } = await import("./checkout");
    expect(publishableKeyOk("pk_test_abcdefgh12345678", false)).toBe(true);
    expect(publishableKeyOk("pk_live_abcdefgh12345678", false)).toBe(false);     // a live key in a dev or test run
    expect(publishableKeyOk("pk_live_abcdefgh12345678", true)).toBe(true);
    expect(publishableKeyOk("pk_test_abcdefgh12345678", true)).toBe(true);
    for (const bad of [null, undefined, "", "sk_test_abcdefgh12345678", "pk_test_", "pk_test_a b", "<script>", "pk_test_" + "x".repeat(300)]) expect(publishableKeyOk(bad, true)).toBe(false);
  });
});
