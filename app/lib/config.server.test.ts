import { describe, expect, it } from "vitest";
import { DEV_FORWARDING_KEY, loadConfig } from "./config.server";

const good = { NODE_ENV: "production", API_BASE_URL: "https://api.example.com/", SESSION_COOKIE_SECRET: "x".repeat(40), WEB_FORWARDING_KEY: "y".repeat(40), PUBLIC_ORIGIN: "https://shop.example.com" };

describe("loadConfig", () => {
  it("accepts a complete production config and trims trailing slashes", () => {
    expect(loadConfig(good).apiBaseUrl).toBe("https://api.example.com");
  });
  it("fails in production when required values are missing", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(/API_BASE_URL is required.*SESSION_COOKIE_SECRET is required/);
  });
  it("rejects short secrets without echoing them", () => {
    expect.assertions(2);
    try { loadConfig({ ...good, SESSION_COOKIE_SECRET: "short-secret" }); } catch (e) {
      expect(String(e)).toMatch(/at least 32/);
      expect(String(e)).not.toContain("short-secret");
    }
  });
  it("requires https public origin in production", () => {
    expect(() => loadConfig({ ...good, PUBLIC_ORIGIN: "http://shop.example.com" })).toThrow(/https/);
  });
  it("uses development defaults outside production", () => {
    const c = loadConfig({});
    expect(c.production).toBe(false);
    expect(c.apiBaseUrl).toBe("http://localhost:5080");
  });
  it("rejects the dev default secret in production", () => {
    const dev = loadConfig({}).sessionCookieSecret;
    expect(() => loadConfig({ ...good, SESSION_COOKIE_SECRET: dev })).toThrow(/development default/);
  });
  it("requires WEB_FORWARDING_KEY in production, long enough and not the dev default", () => {
    expect(() => loadConfig({ ...good, WEB_FORWARDING_KEY: undefined })).toThrow(/WEB_FORWARDING_KEY is required/);
    expect(() => loadConfig({ ...good, WEB_FORWARDING_KEY: "short" })).toThrow(/WEB_FORWARDING_KEY must be at least 32/);
    expect(() => loadConfig({ ...good, WEB_FORWARDING_KEY: DEV_FORWARDING_KEY })).toThrow(/development default/);
  });
  it("rejects a forwarding key equal to the session secret, without echoing it", () => {
    const same = "z".repeat(40);
    expect.assertions(2);
    try { loadConfig({ ...good, SESSION_COOKIE_SECRET: same, WEB_FORWARDING_KEY: same }); } catch (e) {
      expect(String(e)).toMatch(/must differ from SESSION_COOKIE_SECRET/);
      expect(String(e)).not.toContain(same);
    }
  });
  it("uses the dev forwarding key outside production", () => { expect(loadConfig({}).webForwardingKey).toBe(DEV_FORWARDING_KEY); });
});
