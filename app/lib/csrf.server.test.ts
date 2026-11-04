import { describe, expect, it } from "vitest";
import { assertSameOrigin, safeNext } from "./csrf.server";

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
  it.each(["/", "/account/orders?x=1"])("keeps %s", (p) => { expect(safeNext(p)).toBe(p); });
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "", null, undefined, "/a\r\nSet-Cookie: x=1"])("rejects %j", (p) => {
    expect(safeNext(p as string | null | undefined)).toBe("/");
  });
});
