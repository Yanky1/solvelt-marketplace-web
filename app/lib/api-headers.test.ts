import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "./api.server";
import { cartHeaders } from "./api-client.server";
import { ALLOWED_API_HEADERS, CART_TOKEN_HEADER, GUEST_ORDER_HEADER, IDEMPOTENCY_HEADER } from "./api-headers";
import { DEV_FORWARDING_KEY } from "./config.server";

/**
 * Contract test (review H1). These literals are copied from the API source on purpose (CartEndpoints.GuestHeader, CheckoutEndpoints.GuestOrderHeader): the API's docs once said "X-Cart-Token", the web
 * followed the docs, and a guest's cart never reached the API while every test stayed green because the mock followed the web.
 */
describe("the API's header names", () => {
  it("are exactly what the API reads", () => {
    expect(CART_TOKEN_HEADER).toBe("X-Solvelt-Cart-Token");
    expect(GUEST_ORDER_HEADER).toBe("X-Guest-Order");
    expect(IDEMPOTENCY_HEADER).toBe("Idempotency-Key");
  });
  it("are the only extra headers apiFetch lets through, and the old wrong name is not one of them", () => {
    expect([...ALLOWED_API_HEADERS].sort()).toEqual(["idempotency-key", "x-guest-order", "x-solvelt-cart-token"]);
    expect(ALLOWED_API_HEADERS.has("x-cart-token")).toBe(false);
  });
});

describe("a guest cart's token reaches the API under the API's name", () => {
  afterEach(() => vi.restoreAllMocks());
  const cfg = { apiBaseUrl: "http://api", trustedProxies: [], webForwardingKey: DEV_FORWARDING_KEY, production: false };
  const send = async (headers?: Record<string, string>, sessionToken?: string) => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await apiFetch(cfg, { request: new Request("http://web/x"), socketAddress: "203.0.113.9", ...(sessionToken ? { sessionToken } : {}) }, "/api/v1/cart", { headers });
    return new Headers((spy.mock.calls[0]![1] as RequestInit).headers);
  };
  const ctx = (sessionToken?: string) => ({ request: new Request("http://web/x"), socketAddress: "203.0.113.9", ...(sessionToken ? { sessionToken } : {}) });

  it("sends X-Solvelt-Cart-Token and nothing under the old name", async () => {
    const h = await send(cartHeaders(ctx(), "cart_abc"));
    expect(h.get("X-Solvelt-Cart-Token")).toBe("cart_abc");
    expect(h.get("X-Cart-Token")).toBeNull();
  });
  it("drops a header under the old name if a route ever passes one", async () => {
    const h = await send({ "X-Cart-Token": "cart_abc" });
    expect(h.get("X-Cart-Token")).toBeNull();
    expect(h.get("X-Solvelt-Cart-Token")).toBeNull();
  });
  it("sends no cart token for a signed-in buyer (the account's cart is theirs)", () => {
    expect(cartHeaders(ctx("tok"), "cart_abc")).toBeUndefined();
  });
});
