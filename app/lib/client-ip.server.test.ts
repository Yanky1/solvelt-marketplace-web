import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, FORWARDED_CLIENT_IP_HEADER } from "./api.server";
import { isTrusted, resolveClientIp } from "./client-ip.server";

const T = ["10.0.0.5", "172.16.0.0/12"];

describe("resolveClientIp", () => {
  it("uses the socket peer and ignores X-Forwarded-For when the peer is not a trusted proxy", () => {
    expect(resolveClientIp("203.0.113.9", "1.2.3.4", T)).toBe("203.0.113.9");
    expect(resolveClientIp("203.0.113.9", "1.2.3.4", [])).toBe("203.0.113.9");
  });
  it("honours X-Forwarded-For from a trusted proxy", () => {
    expect(resolveClientIp("10.0.0.5", "198.51.100.7", T)).toBe("198.51.100.7");
  });
  it("walks right to left past trusted hops, so a client-forged left entry is never used", () => {
    expect(resolveClientIp("10.0.0.5", "6.6.6.6, 198.51.100.7, 172.16.3.4", T)).toBe("198.51.100.7");
  });
  it("falls back to the peer on a malformed chain or when all hops are trusted", () => {
    expect(resolveClientIp("10.0.0.5", "198.51.100.7, garbage", T)).toBe("10.0.0.5");
    expect(resolveClientIp("10.0.0.5", "172.16.1.1", T)).toBe("10.0.0.5");
  });
  it("normalises IPv4-mapped IPv6 peers", () => {
    expect(resolveClientIp("::ffff:10.0.0.5", "198.51.100.7", T)).toBe("198.51.100.7");
  });
  it("returns null without a valid peer", () => {
    expect(resolveClientIp(undefined, "1.2.3.4", T)).toBeNull();
    expect(resolveClientIp("not-an-ip", null, T)).toBeNull();
  });
});

describe("isTrusted", () => {
  it("matches exact IPs and IPv4 CIDRs only", () => {
    expect(isTrusted("172.31.255.255", T)).toBe(true);
    expect(isTrusted("172.32.0.1", T)).toBe(false);
    expect(isTrusted("10.0.0.6", T)).toBe(false);
  });
});

describe("apiFetch", () => {
  afterEach(() => vi.restoreAllMocks());
  const call = async (headers: Record<string, string>, socketAddress: string, trusted: string[]) => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await apiFetch({ apiBaseUrl: "http://api", trustedProxies: trusted }, { request: new Request("http://web/x", { headers }), socketAddress, sessionToken: "tok" }, "/api/v1/ping");
    return new Headers((spy.mock.calls[0]![1] as RequestInit).headers);
  };
  it("sets the forwarded IP from the socket and never passes a client-supplied header through", async () => {
    const h = await call({ [FORWARDED_CLIENT_IP_HEADER]: "6.6.6.6", "x-forwarded-for": "7.7.7.7" }, "203.0.113.9", []);
    expect(h.get(FORWARDED_CLIENT_IP_HEADER)).toBe("203.0.113.9");
    expect(h.get("x-forwarded-for")).toBeNull();
  });
  it("uses the proxy-reported client IP when the peer is trusted, and sends the bearer token", async () => {
    const h = await call({ "x-forwarded-for": "198.51.100.7" }, "10.0.0.5", ["10.0.0.5"]);
    expect(h.get(FORWARDED_CLIENT_IP_HEADER)).toBe("198.51.100.7");
    expect(h.get("authorization")).toBe("Bearer tok");
  });
});
