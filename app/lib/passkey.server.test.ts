import { describe, expect, it } from "vitest";
import { isSafeId, rpIdAllowed, sanitizePasskeyOptions } from "./passkey.server";

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

describe("sanitizePasskeyOptions", () => {
  const O = "https://shop.example.com";
  const create = (o: Record<string, unknown>) => sanitizePasskeyOptions("create", o, O);
  const get = (o: Record<string, unknown>) => sanitizePasskeyOptions("get", o, O);

  it("checks rp.id for registration and rpId for sign-in", () => {
    expect(create({ rp: { id: "example.com", name: "x" }, challenge: "c" })).toEqual({ rp: { id: "example.com", name: "x" }, challenge: "c" });
    expect(get({ rpId: "shop.example.com", challenge: "c" })).toEqual({ rpId: "shop.example.com", challenge: "c" });
    expect(create({ rp: { id: "evil.com" } })).toBeNull();
    expect(get({ rpId: "evil.com" })).toBeNull();
  });
  it("accepts an absent id (the browser then uses the page's host)", () => {
    expect(create({ rp: { name: "x" } })).toEqual({ rp: { name: "x" } });
    expect(get({ challenge: "c" })).toEqual({ challenge: "c" });
  });
  it("refuses when BOTH ids are present and differ, whichever one is hostile (the bypass: rp.id good, rpId evil)", () => {
    expect(get({ rp: { id: "example.com" }, rpId: "evil.example" })).toBeNull();
    expect(create({ rp: { id: "example.com" }, rpId: "evil.example" })).toBeNull();
    expect(get({ rp: { id: "evil.example" }, rpId: "example.com" })).toBeNull();
    expect(create({ rp: { id: "evil.example" }, rpId: "example.com" })).toBeNull();
  });
  it("when both are present and equal, forwards only the field the ceremony uses", () => {
    const both = { rp: { id: "example.com", name: "x" }, rpId: "example.com", challenge: "c" };
    expect(create(both)).toEqual({ rp: { id: "example.com", name: "x" }, challenge: "c" });
    expect(get(both)).toEqual({ rpId: "example.com", challenge: "c" });
  });
  it("drops the unused field even when it is the only one present", () => {
    expect(get({ rp: { id: "evil.example", name: "x" }, challenge: "c" })).toEqual({ challenge: "c" }); // browser ignores rp for sign-in
    expect(create({ rpId: "evil.example", rp: { name: "x" } })).toEqual({ rp: { name: "x" } });
  });
  it("refuses non-string ids and malformed shapes", () => {
    expect(get({ rpId: 5 })).toBeNull();
    expect(create({ rp: { id: 5 } })).toBeNull();
    expect(create({ rp: "x" } as never)).toBeNull();
    expect(create({ rp: null } as never)).toBeNull();
    expect(get(null as never)).toBeNull();
    expect(get([] as never)).toBeNull();
  });
  it("does not mutate its input", () => {
    const input = { rp: { id: "example.com" }, rpId: "example.com" };
    get(input);
    expect(input).toEqual({ rp: { id: "example.com" }, rpId: "example.com" });
  });
});

describe("isSafeId", () => {
  it.each(["abc123", "a_b-c", "A".repeat(64)])("accepts %s", (id) => { expect(isSafeId(id)).toBe(true); });
  it.each([".", "..", "../x", "a/b", "a b", "a\u0000b", "", "A".repeat(65), "%2e%2e", "a?b", "a#b", "a\\b", undefined, null, 5])("rejects %j", (id) => { expect(isSafeId(id)).toBe(false); });
});
