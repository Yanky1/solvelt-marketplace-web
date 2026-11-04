import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, FORWARDED_CLIENT_IP_HEADER, FORWARDED_CLIENT_SIGNATURE_HEADER, FORWARDED_CLIENT_TIMESTAMP_HEADER, signClientIp } from "./api.server";
import { formatIp, isTrusted, parseIp, parseTrustedProxies, parseTrustedProxy, resolveClientIp } from "./client-ip.server";
import { DEV_FORWARDING_KEY } from "./config.server";

const T = ["10.0.0.5", "172.16.0.0/12", "2001:db8::/32", "fd00::1"];
const txt = (s: string) => { const ip = parseIp(s); return ip ? formatIp(ip) : null; };

describe("parseIp", () => {
  it.each([
    ["198.51.100.7", "198.51.100.7"],
    ["198.51.100.7:4567", "198.51.100.7"], // Azure App Gateway / ARR
    [" 198.51.100.7 ", "198.51.100.7"],
    ["[2001:db8::7]:4567", "2001:db8::7"],
    ["[2001:db8::7]", "2001:db8::7"],
    ["2001:DB8:0:0:0:0:0:7", "2001:db8::7"],
    ["2001:db8::7%eth0", "2001:db8::7"], // zone stripped
    ["::ffff:198.51.100.7", "198.51.100.7"], // IPv4-mapped is IPv4
    ["::ffff:c633:6407", "198.51.100.7"],
    ["::1", "::1"],
    ["::", "::"],
    ["1:0:0:2:0:0:0:3", "1:0:0:2::3"],
  ])("%s -> %s", (raw, out) => { expect(txt(raw)).toBe(out); });
  it.each(["", "garbage", "1.2.3", "1.2.3.4.5", "256.1.1.1", "01.2.3.4", "1.2.3.4:99999x", "[::1", "::1::2", "2001:db8::7%", "1.2.3.4%eth0", "198.51.100.7%1", "1:2:3:4:5:6:7:8:9", "12345::", "1.2.3.4/8", "a".repeat(100)])("rejects %j", (raw) => {
    expect(parseIp(raw)).toBeNull();
  });
});

describe("TRUSTED_PROXIES parsing", () => {
  it.each(["10.0.0.5", "10.0.0.0/8", "0.0.0.0/0", "2001:db8::/32", "::1", "fd00::/8"])("accepts %s", (e) => { expect(parseTrustedProxy(e)).not.toBeNull(); });
  it.each(["", "10.0.0.5:80", "[::1]", "::1%eth0", "10.0.0.0/0x8", "10.0.0.0/1e1", "10.0.0.0/ 8", "10.0.0.0/08", "10.0.0.0/33", "2001:db8::/129", "10.0.0.0/-1", "10.0.0.0/8/8", "::ffff:10.0.0.0/104", "nope", "10.0.0/8"])("rejects %j", (e) => {
    expect(parseTrustedProxy(e)).toBeNull();
  });
  it("lists bad entries by position, never by value, and accepts an empty list", () => {
    expect(() => parseTrustedProxies(["10.0.0.5", "bogus", "10.0.0.0/0x8"])).toThrow(/entries 2, 3 are not a valid IP/);
    expect(() => parseTrustedProxies(["10.0.0.5", "bogus"])).not.toThrow(/bogus/);
    expect(parseTrustedProxies([])).toEqual([]);
  });
});

describe("isTrusted", () => {
  const trusted = parseTrustedProxies(T);
  const is = (s: string) => isTrusted(parseIp(s)!, trusted);
  it("matches exact IPs and IPv4 CIDRs", () => {
    expect([is("172.31.255.255"), is("172.32.0.1"), is("10.0.0.5"), is("10.0.0.6")]).toEqual([true, false, true, false]);
  });
  it("matches IPv6 by value and by CIDR, however it is spelled", () => {
    expect([is("2001:db8:ffff::1"), is("2001:DB8:0:0:0:0:0:1"), is("2001:db9::1"), is("fd00::1"), is("FD00:0:0:0:0:0:0:1"), is("fd00::2")]).toEqual([true, true, false, true, true, false]);
  });
  it("never matches across versions (a v6 address is not an IPv4 CIDR member)", () => {
    expect(isTrusted(parseIp("::a00:5")!, parseTrustedProxies(["10.0.0.5"]))).toBe(false);
  });
  it("/0 trusts every address of that version only", () => {
    const all4 = parseTrustedProxies(["0.0.0.0/0"]);
    expect([isTrusted(parseIp("1.2.3.4")!, all4), isTrusted(parseIp("::1")!, all4)]).toEqual([true, false]);
  });
});

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
  it("understands ports, brackets and zones in hops (Azure App Gateway, ARR)", () => {
    expect(resolveClientIp("10.0.0.5", "198.51.100.7:4567", T)).toBe("198.51.100.7");
    expect(resolveClientIp("10.0.0.5", "[2606:4700::1]:5555", T)).toBe("2606:4700::1");
    expect(resolveClientIp("10.0.0.5", "6.6.6.6, 2606:4700::1%eth0, 172.16.0.9:80", T)).toBe("2606:4700::1");
  });
  it("trusts IPv6 proxies, including by CIDR and spelled differently", () => {
    expect(resolveClientIp("2001:db8:1::5", "198.51.100.7", T)).toBe("198.51.100.7");
    expect(resolveClientIp("[fd00:0:0:0:0:0:0:1]", "198.51.100.7", T)).toBe("198.51.100.7");
    expect(resolveClientIp("2001:db9::5", "198.51.100.7", T)).toBe("2001:db9::5");
  });
  it("falls back to the peer on a malformed chain or when all hops are trusted", () => {
    expect(resolveClientIp("10.0.0.5", "198.51.100.7, garbage", T)).toBe("10.0.0.5");
    expect(resolveClientIp("10.0.0.5", "172.16.1.1", T)).toBe("10.0.0.5");
  });
  it("normalises IPv4-mapped IPv6 peers and returns canonical text", () => {
    expect(resolveClientIp("::ffff:10.0.0.5", "198.51.100.7", T)).toBe("198.51.100.7");
    expect(resolveClientIp("2001:0DB9:0:0:0:0:0:5", null, T)).toBe("2001:db9::5");
  });
  it("returns null without a valid peer", () => {
    expect(resolveClientIp(undefined, "1.2.3.4", T)).toBeNull();
    expect(resolveClientIp("", "1.2.3.4", T)).toBeNull();
    expect(resolveClientIp("not-an-ip", null, T)).toBeNull();
  });
});

describe("apiFetch", () => {
  afterEach(() => vi.restoreAllMocks());
  const cfg = (trusted: string[], production = false) => ({ apiBaseUrl: "http://api", trustedProxies: trusted, webForwardingKey: DEV_FORWARDING_KEY, production });
  const call = async (headers: Record<string, string>, socketAddress: string, trusted: string[]) => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await apiFetch(cfg(trusted), { request: new Request("http://web/x", { headers }), socketAddress, sessionToken: "tok" }, "/api/v1/ping", { now: () => 1700000000.9 });
    return new Headers((spy.mock.calls[0]![1] as RequestInit).headers);
  };
  it("sets the forwarded IP from the socket and never passes a client-supplied header through", async () => {
    const h = await call({ [FORWARDED_CLIENT_IP_HEADER]: "6.6.6.6", "x-forwarded-for": "7.7.7.7" }, "203.0.113.9", []);
    expect(h.get(FORWARDED_CLIENT_IP_HEADER)).toBe("203.0.113.9");
    expect(h.get("x-forwarded-for")).toBeNull();
  });
  it("uses the proxy-reported client IP when the peer is trusted, and sends the bearer token", async () => {
    const h = await call({ "x-forwarded-for": "198.51.100.7:1234" }, "10.0.0.5", ["10.0.0.5"]);
    expect(h.get(FORWARDED_CLIENT_IP_HEADER)).toBe("198.51.100.7");
    expect(h.get("authorization")).toBe("Bearer tok");
  });
  it("sends all three signed headers (timestamp floored, signature over the resolved IP)", async () => {
    const h = await call({ "x-forwarded-for": "6.6.6.6" }, "203.0.113.9", []);
    expect(h.get(FORWARDED_CLIENT_TIMESTAMP_HEADER)).toBe("1700000000");
    expect(h.get(FORWARDED_CLIENT_SIGNATURE_HEADER)).toBe(signClientIp(DEV_FORWARDING_KEY, 1700000000, "203.0.113.9"));
  });

  describe("without a socket address (a route forgot the load context)", () => {
    const spoofed = { [FORWARDED_CLIENT_IP_HEADER]: "6.6.6.6", [FORWARDED_CLIENT_TIMESTAMP_HEADER]: "1700000000", [FORWARDED_CLIENT_SIGNATURE_HEADER]: "v1=forged", "x-forwarded-for": "7.7.7.7" };
    it.each([undefined, ""])("fails loudly outside production (socketAddress %j)", async (empty) => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
      await expect(apiFetch(cfg([]), { request: new Request("http://web/x", { headers: spoofed }), socketAddress: empty as unknown as string }, "/p")).rejects.toThrow(/socketAddress is missing/);
      expect(spy).not.toHaveBeenCalled();
    });
    it.each([undefined, ""])("in production still forwards NONE of the client's X-Solvelt-Client-* headers (socketAddress %j)", async (empty) => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
      await apiFetch(cfg(["10.0.0.5"], true), { request: new Request("http://web/x", { headers: spoofed }), socketAddress: empty as unknown as string }, "/p");
      const h = new Headers((spy.mock.calls[0]![1] as RequestInit).headers);
      for (const name of [FORWARDED_CLIENT_IP_HEADER, FORWARDED_CLIENT_TIMESTAMP_HEADER, FORWARDED_CLIENT_SIGNATURE_HEADER, "x-forwarded-for"]) expect(h.get(name), name).toBeNull();
    });
  });
});

describe("signClientIp", () => {
  it("matches the fixed vector (also recorded in docs/DESIGN.md W1-14)", () => {
    expect(signClientIp("dev-only-web-forwarding-key-not-for-production", 1700000000, "203.0.113.9")).toBe("v1=eaf9dade01862226a6cb91574596e068996969fe53eb32f05d4ec102df81a4e8");
  });
  it("changes with key, timestamp and ip", () => {
    const base = signClientIp("k".repeat(32), 1700000000, "203.0.113.9");
    expect(signClientIp("j".repeat(32), 1700000000, "203.0.113.9")).not.toBe(base);
    expect(signClientIp("k".repeat(32), 1700000001, "203.0.113.9")).not.toBe(base);
    expect(signClientIp("k".repeat(32), 1700000000, "203.0.113.10")).not.toBe(base);
  });
});
