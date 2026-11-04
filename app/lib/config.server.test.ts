import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.server";

const good = { NODE_ENV: "production", API_BASE_URL: "https://api.example.com/", SESSION_COOKIE_SECRET: "x".repeat(40), PUBLIC_ORIGIN: "https://shop.example.com" };

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
});
