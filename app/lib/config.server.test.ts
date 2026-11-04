import { describe, expect, it } from "vitest";
import { DEV_FORWARDING_KEY, isProduction, loadConfig, weakSecretReason } from "./config.server";

const SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
const KEY = "Tn4Wb8Ke2Vr6Pj0Hs3Dy7Lc9Mf1Ga5QxZu8o";
const good = { NODE_ENV: "production", API_BASE_URL: "https://api.example.com/", SESSION_COOKIE_SECRET: SECRET, WEB_FORWARDING_KEY: KEY, PUBLIC_ORIGIN: "https://shop.example.com" };
const fails = (env: Record<string, string | undefined>, re: RegExp) => expect(() => loadConfig(env)).toThrow(re);

describe("loadConfig", () => {
  it("accepts a complete production config and trims trailing slashes", () => {
    expect(loadConfig(good).apiBaseUrl).toBe("https://api.example.com");
  });
  it("fails in production when required values are missing", () => {
    fails({ NODE_ENV: "production" }, /SESSION_COOKIE_SECRET is required.*WEB_FORWARDING_KEY is required.*API_BASE_URL is required/);
  });
  it("treats an unset or unknown NODE_ENV as production", () => {
    expect(isProduction({})).toBe(true);
    expect(isProduction({ NODE_ENV: "staging" })).toBe(true);
    expect(isProduction({ NODE_ENV: "development" })).toBe(false);
    expect(isProduction({ NODE_ENV: "test" })).toBe(false);
    fails({}, /SESSION_COOKIE_SECRET is required/);
  });
  it("rejects weak secrets without echoing them", () => {
    for (const weak of ["short-secret", "a".repeat(40), "change-me-change-me-change-me-change-me", "dev-only-secret-dev-only-secret-0000"]) {
      try { loadConfig({ ...good, SESSION_COOKIE_SECRET: weak }); throw new Error("accepted " + weak.length); } catch (e) {
        expect(String(e)).toMatch(/SESSION_COOKIE_SECRET (must be at least 32|looks like a placeholder|has too little variety)/);
        expect(String(e)).not.toContain(weak);
      }
    }
  });
  it("rejects the same weak values for WEB_FORWARDING_KEY", () => {
    fails({ ...good, WEB_FORWARDING_KEY: "a".repeat(40) }, /WEB_FORWARDING_KEY has too little variety/);
    fails({ ...good, WEB_FORWARDING_KEY: DEV_FORWARDING_KEY }, /WEB_FORWARDING_KEY looks like a placeholder/);
    fails({ ...good, WEB_FORWARDING_KEY: undefined }, /WEB_FORWARDING_KEY is required/);
  });
  it("rejects a forwarding key equal to the session secret, without echoing it", () => {
    expect.assertions(2);
    try { loadConfig({ ...good, WEB_FORWARDING_KEY: SECRET }); } catch (e) {
      expect(String(e)).toMatch(/must differ from SESSION_COOKIE_SECRET/);
      expect(String(e)).not.toContain(SECRET);
    }
  });
  it("requires an https public origin; http only for localhost or 127.0.0.1 hostnames", () => {
    fails({ ...good, PUBLIC_ORIGIN: "http://shop.example.com" }, /https/);
    fails({ ...good, PUBLIC_ORIGIN: "http://localhost.evil.com" }, /https/);
    fails({ ...good, PUBLIC_ORIGIN: "http://127.0.0.1.evil.com" }, /https/);
    fails({ ...good, PUBLIC_ORIGIN: "http://evil.com:3000/localhost" }, /origin/);
    expect(loadConfig({ ...good, PUBLIC_ORIGIN: "http://localhost:3100" }).publicOrigin).toBe("http://localhost:3100");
    expect(loadConfig({ ...good, PUBLIC_ORIGIN: "http://127.0.0.1:3100" }).publicOrigin).toBe("http://127.0.0.1:3100");
  });
  it("uses development defaults only in development or test", () => {
    const c = loadConfig({ NODE_ENV: "development" });
    expect(c.production).toBe(false);
    expect(c.apiBaseUrl).toBe("http://localhost:5080");
    expect(c.webForwardingKey).toBe(DEV_FORWARDING_KEY);
  });
});

describe("weakSecretReason", () => {
  it("accepts a random-looking secret", () => { expect(weakSecretReason(SECRET)).toBeNull(); });
});
