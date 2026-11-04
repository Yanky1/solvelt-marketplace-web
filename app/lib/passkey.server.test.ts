import { describe, expect, it } from "vitest";
import { isSafeId, optionsRpIdOk, rpIdAllowed, rpIdOf } from "./passkey.server";

describe("rpIdAllowed", () => {
  it.each([
    ["shop.example.com", "https://shop.example.com", true],
    ["example.com", "https://shop.example.com", true],
    ["SHOP.example.com", "https://shop.example.com", true], // case-insensitive
    ["localhost", "http://localhost:3100", true],
    ["evil.com", "https://shop.example.com", false],
    ["example.com.evil.com", "https://shop.example.com", false],
    ["xample.com", "https://shop.example.com", false], // suffix of the string, not a parent domain
    ["com", "https://shop.example.com", false], // single label
    ["shop.example.com", "https://example.com", false], // a child is not allowed for a parent origin
    ["1.2.3.4", "https://shop.example.com", false],
    ["127.0.0.1", "http://127.0.0.1:3000", true],
    ["0.0.1", "http://127.0.0.1:3000", false],
    [" example.com", "https://shop.example.com", false],
    ["exa mple.com", "https://shop.example.com", false],
    ["", "https://shop.example.com", false],
  ])("%j for %s -> %s", (rp, origin, ok) => { expect(rpIdAllowed(rp, origin)).toBe(ok); });
  it("fails closed on a bad origin", () => { expect(rpIdAllowed("example.com", "not a url")).toBe(false); });
});

describe("optionsRpIdOk", () => {
  const O = "https://shop.example.com";
  it("reads rp.id (creation) and rpId (request)", () => {
    expect(rpIdOf({ rp: { id: "a.com" } })).toBe("a.com");
    expect(rpIdOf({ rpId: "b.com" })).toBe("b.com");
    expect(rpIdOf({})).toBeUndefined();
    expect(rpIdOf({ rpId: 5 })).toBeNull();
  });
  it("accepts matching ids and an absent id, rejects mismatches and non-strings", () => {
    expect(optionsRpIdOk({ rp: { id: "example.com", name: "x" } }, O)).toBe(true);
    expect(optionsRpIdOk({ rpId: "shop.example.com" }, O)).toBe(true);
    expect(optionsRpIdOk({ challenge: "x" }, O)).toBe(true);
    expect(optionsRpIdOk({ rp: { id: "evil.com" } }, O)).toBe(false);
    expect(optionsRpIdOk({ rpId: "evil.com" }, O)).toBe(false);
    expect(optionsRpIdOk({ rpId: 5 }, O)).toBe(false);
  });
});

describe("isSafeId", () => {
  it.each(["abc123", "a_b-c", "A".repeat(64)])("accepts %s", (id) => { expect(isSafeId(id)).toBe(true); });
  it.each([".", "..", "../x", "a/b", "a b", "a\u0000b", "", "A".repeat(65), "%2e%2e", "a?b", "a#b", "a\\b", undefined, null, 5])("rejects %j", (id) => { expect(isSafeId(id)).toBe(false); });
});
