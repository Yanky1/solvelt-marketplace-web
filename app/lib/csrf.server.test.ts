import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSameOrigin, logRefusal, refusal, resetRefusalLog, safeNext } from "./csrf.server";

const O = "https://shop.example.com";
const req = (method: string, headers: Record<string, string> = {}) => new Request(`${O}/x`, { method, headers });

describe("assertSameOrigin", () => {
  it("allows safe methods without headers", () => { expect(() => assertSameOrigin(req("GET"), O)).not.toThrow(); });
  it("allows a matching Origin", () => { expect(() => assertSameOrigin(req("POST", { origin: O }), O)).not.toThrow(); });
  it("falls back to Referer", () => { expect(() => assertSameOrigin(req("POST", { referer: `${O}/a?b=1` }), O)).not.toThrow(); });
  it.each([[{ origin: "https://evil.example" }], [{}], [{ origin: "null" }], [{ referer: "not a url" }]])("rejects %j", (h) => {
    try { assertSameOrigin(req("POST", h), O); throw new Error("no throw"); } catch (e) {
      expect(e).toBeInstanceOf(Response);
      expect((e as Response).status).toBe(403);
    }
  });
});

describe("safeNext", () => {
  it.each(["/", "/account/orders?x=1", "/a#frag", "/p%20q", "/%2F%2Fevil.example"])("keeps %s", (p) => { expect(safeNext(p)).toBe(p); });
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined, "/a\r\nSet-Cookie: x=1", "/\t/evil.example/x", "/\n/evil.example", "/ /evil.example", "/\u0000/evil.example", "https:", "https:evil.example", "/\u00a0/evil.example", "/%09/evil.example".replace("%09", decodeURIComponent("%09"))])("rejects %j", (p) => {
    expect(safeNext(p as string | null | undefined)).toBe("/");
  });
});

describe("why a request was refused", () => {
  beforeEach(resetRefusalLog);
  afterEach(() => vi.restoreAllMocks());
  const thrown = (h: Record<string, string>) => { try { assertSameOrigin(req("POST", h), O); } catch (e) { return e as Response; } throw new Error("no throw"); };

  it("says origin_mismatch for another origin and no_origin for none, in the body the error page reads", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await thrown({ origin: "http://shop.example.com" }).text()).toBe("origin_mismatch");     // http where https is expected
    expect(await thrown({ origin: "https://www.shop.example.com" }).text()).toBe("origin_mismatch"); // another host name
    expect(await thrown({}).text()).toBe("no_origin");
  });
  it("keeps the plain Forbidden body for a stale token, and never lets a refusal be cached", async () => {
    const r = refusal("bad_token");
    expect([r.status, await r.text(), r.headers.get("cache-control")]).toEqual([403, "Forbidden", "no-store"]);
    expect(refusal("no_session").headers.get("cache-control")).toBe("no-store");
  });
  it("logs the reason, the origin the browser sent and the one expected, and nothing else", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => assertSameOrigin(req("POST", { origin: "http://shop.example.com", cookie: "solvelt_session=SECRET", "x-csrf": "TOKEN" }), O)).toThrow();
    const line = String(warn.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: "request_refused", reason: "origin_mismatch", seenOrigin: "http://shop.example.com", expectedOrigin: O });
    expect(line).not.toMatch(/SECRET|TOKEN/);
  });
  it("logs one line per reason per ten seconds and counts what it held back", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t0 = 5_000_000_000;
    logRefusal("no_session", null, O, t0); logRefusal("no_session", null, O, t0 + 1); logRefusal("no_session", null, O, t0 + 2);
    expect(warn).toHaveBeenCalledTimes(1);
    logRefusal("bad_token", null, O, t0 + 3);                                                     // another reason is logged at once
    expect(warn).toHaveBeenCalledTimes(2);
    logRefusal("no_session", null, O, t0 + 10_001);
    expect(warn).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(warn.mock.calls.at(-1)?.[0])).suppressed).toBe(2);
  });
  it("strips control characters and cuts a long origin before it reaches the log", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    logRefusal("origin_mismatch", "https://x.example\r\nfake: line" + "a".repeat(500), O, 9_000_000_000);
    const line = String(warn.mock.calls.at(-1)?.[0]);
    expect(line.split("\n")).toHaveLength(1);
    const seen = JSON.parse(line).seenOrigin as string;
    // eslint-disable-next-line no-control-regex -- checking that no control character is left is the point of this assertion
    expect(seen).not.toMatch(/[\u0000-\u001f\u007f]/);                                                 // JSON would escape them, but the stored value must not carry them
    expect(seen.length).toBeLessThanOrEqual(120);
  });
});
