import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api-client.server";
import { cleanRef, clearRefCookie, newRef, noteFailure, refCookie, refFromCookieHeader, routePattern } from "./error-ref.server";

/** The reference on the error page (decision M8W-03): the API's correlation id for a server fault, one made here when there is no API answer, logged once without anything personal. */
describe("routePattern", () => {
  it("drops origin, query and fragment and masks ids and numbers", () => {
    expect(routePattern("/api/v1/orders/MP-20261105-ABCDEFGH/shipments/0a5d2c1e-1111-4222-8333-444455556666?email=a@b.com#x")).toBe("/api/v1/orders/:id/shipments/:id");
    expect(routePattern("https://web.example/checkout/confirmation/MP-20261105-ABCDEFGH?token=secret")).toBe("/checkout/confirmation/:id");
    expect(routePattern("/p/classic-braided-challah")).toBe("/p/classic-braided-challah");
  });
});

describe("cleanRef and newRef", () => {
  it("accept only a plain, short id from outside", () => {
    expect(cleanRef("0HN7A8-corr_12:34")).toBe("0HN7A8-corr_12:34");
    for (const bad of [null, undefined, "", "abc", "has space here", "<script>x</script>", "x".repeat(65), "a;b=c"]) expect(cleanRef(bad)).toBeUndefined();
  });
  it("makes W- ids that pass their own check", () => {
    const id = newRef();
    expect(id).toMatch(/^W-[0-9a-f]{10}$/);
    expect(cleanRef(id)).toBe(id);
  });
});

describe("noteFailure", () => {
  afterEach(() => vi.restoreAllMocks());
  it("keeps the API's id, logs one line with no query, and keeps the first id of a request", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const holder: { id?: string } = {};
    const id = noteFailure(holder, { source: "api", status: 500, code: "internal_error", route: routePattern("/api/v1/checkout?x=1"), apiRef: "corr-123456" });
    expect(id).toBe("corr-123456");
    expect(holder.id).toBe("corr-123456");
    expect(noteFailure(holder, { source: "bff", status: 500, code: "TypeError", route: "/checkout" })).toBe("corr-123456");   // the second failure of the request reuses it
    const line = String(log.mock.calls[0]![1]);
    expect(JSON.parse(line)).toEqual({ ref: "corr-123456", source: "api", status: 500, code: "internal_error", route: "/api/v1/checkout" });
    expect(line).not.toContain("x=1");
  });
  it("makes an id when the API had none", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const holder: { id?: string } = {};
    expect(noteFailure(holder, { source: "bff", status: 503, code: "unreachable", route: "/api/v1/cart" })).toMatch(/^W-/);
    expect(holder.id).toMatch(/^W-/);
  });
  it("sets a short-lived cookie the error page can read, Secure on https only", () => {
    expect(refCookie("W-abc1234567", false)).toBe("sl_ref=W-abc1234567; Path=/; Max-Age=120; SameSite=Lax; HttpOnly");
    expect(refCookie("W-abc1234567", true)).toContain("; Secure");
    expect(refCookie("W-abc1234567", true)).toContain("; HttpOnly");
    expect(clearRefCookie(true)).toBe("sl_ref=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly; Secure");
    expect(refFromCookieHeader("a=b; sl_ref=W-abc1234567; c=d")).toBe("W-abc1234567");
    expect(refFromCookieHeader("sl_ref=<script>")).toBeUndefined();
    expect(refFromCookieHeader(null)).toBeUndefined();
  });
});

describe("the API client keeps the failure's reference", () => {
  afterEach(() => vi.restoreAllMocks());
  const ctx = (holder: { id?: string }) => ({ request: new Request("http://web/x"), socketAddress: "203.0.113.9", errorRef: holder });
  const quiet = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("a 500 with X-Correlation-Id: the ApiError and the holder carry the API's id", async () => {
    quiet();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "internal_error", message: "x" }), { status: 500, headers: { "X-Correlation-Id": "0HN7A8TESTID01" } }));
    const holder: { id?: string } = {};
    const e = await api.bookings(ctx(holder)).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).reference).toBe("0HN7A8TESTID01");
    expect(holder.id).toBe("0HN7A8TESTID01");
  });
  it("a 502 page from a proxy (no correlation id) gets an id made here", async () => {
    quiet();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 }));
    const holder: { id?: string } = {};
    const e = (await api.bookings(ctx(holder)).catch((x: unknown) => x)) as ApiError;
    expect(e.reference).toMatch(/^W-/);
    expect(holder.id).toBe(e.reference);
  });
  it("an unreachable API gets an id made here", async () => {
    quiet();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const holder: { id?: string } = {};
    const e = (await api.bookings(ctx(holder)).catch((x: unknown) => x)) as ApiError;
    expect(e.status).toBe(503);
    expect(e.reference).toMatch(/^W-/);
    expect(holder.id).toBe(e.reference);
  });
  it("a 4xx the page handles puts nothing in the holder", async () => {
    const log = quiet();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "not_found" }), { status: 404, headers: { "X-Correlation-Id": "ignored-corr-1" } }));
    const holder: { id?: string } = {};
    await api.bookings(ctx(holder)).catch(() => {});
    expect(holder.id).toBeUndefined();
    expect(log).not.toHaveBeenCalled();
  });
});
