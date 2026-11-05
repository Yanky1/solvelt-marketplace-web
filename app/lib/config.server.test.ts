import { describe, expect, it } from "vitest";
import { DEV_FORWARDING_KEY, deploymentOf, isProduction, loadConfig, weakSecretReason, stripeScriptOrigins } from "./config.server";

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
    // the canonical form: what the browser sends in Origin (lower-case host, default port dropped), review LOW-2
    expect(loadConfig({ ...good, PUBLIC_ORIGIN: "https://Shop.Example.test" }).publicOrigin).toBe("https://shop.example.test");
    expect(loadConfig({ ...good, PUBLIC_ORIGIN: "https://shop.example.test:443/" }).publicOrigin).toBe("https://shop.example.test");
  });
  it("uses development defaults only in development or test", () => {
    const c = loadConfig({ NODE_ENV: "development" });
    expect(c.production).toBe(false);
    expect(c.apiBaseUrl).toBe("http://localhost:5080");
    expect(c.webForwardingKey).toBe(DEV_FORWARDING_KEY);
  });
});

describe("TRUSTED_PROXIES in config", () => {
  it("is parsed strictly at start-up (bad entries fail, by position)", () => {
    fails({ ...good, TRUSTED_PROXIES: "10.0.0.5, 10.0.0.0/0x8" }, /TRUSTED_PROXIES entry 2 is not a valid IP/);
    fails({ ...good, TRUSTED_PROXIES: "10.0.0.5:80,2001:db8::/129" }, /entries 1, 2/);
    expect(loadConfig({ ...good, TRUSTED_PROXIES: "10.0.0.5, 172.16.0.0/12, 2001:db8::/32" }).trustedProxies).toHaveLength(3);
    expect(loadConfig(good).trustedProxies).toEqual([]);
  });
});

describe("REAUTH_WINDOW_SECONDS", () => {
  it("defaults to 10 minutes and is validated", () => {
    expect(loadConfig(good).reauthWindowSeconds).toBe(600);
    expect(loadConfig({ ...good, REAUTH_WINDOW_SECONDS: "5" }).reauthWindowSeconds).toBe(5);
    for (const bad of ["0", "-1", "3601", "abc", "1.5", "1e2"]) fails({ ...good, REAUTH_WINDOW_SECONDS: bad }, /REAUTH_WINDOW_SECONDS/);
  });
});

describe("weakSecretReason", () => {
  it("accepts a random-looking secret", () => { expect(weakSecretReason(SECRET)).toBeNull(); });
});

describe("STRIPE_JS_URL (review M1: Stripe.js is loaded from Stripe's origin only)", () => {
  const stub = "http://localhost:5080/__stripe/v3.js";
  it("defaults to Stripe's own script and, in production, refuses any other origin", () => {
    expect(loadConfig(good).stripeJsUrl).toBe("https://js.stripe.com/v3");
    for (const evil of ["https://evil.example/v3", "https://js.stripe.com.evil.example/v3", "http://js.stripe.com/v3", "https://js-stripe.com/v3", stub]) fails({ ...good, STRIPE_JS_URL: evil }, /STRIPE_JS_URL/);
    expect(loadConfig({ ...good, STRIPE_JS_URL: "https://js.stripe.com/basil/stripe.js" }).stripeJsUrl).toBe("https://js.stripe.com/basil/stripe.js");
  });
  it("lets the E2E stand-in through only with ALLOW_STRIPE_STUB=1 AND a localhost site", () => {
    const local = { ...good, PUBLIC_ORIGIN: "http://localhost:3100", STRIPE_JS_URL: stub };
    fails(local, /STRIPE_JS_URL/);                                                    // localhost alone is not enough
    fails({ ...good, ALLOW_STRIPE_STUB: "1", STRIPE_JS_URL: stub }, /STRIPE_JS_URL/);  // the flag alone (a real https site) is not enough either
    fails({ ...local, ALLOW_STRIPE_STUB: "true" }, /STRIPE_JS_URL/);
    expect(loadConfig({ ...local, ALLOW_STRIPE_STUB: "1" }).stripeJsUrl).toBe(stub);
  });
  it("is free outside production, but never plain http to a remote host", () => {
    expect(loadConfig({ NODE_ENV: "development", STRIPE_JS_URL: stub }).stripeJsUrl).toBe(stub);
    expect(() => loadConfig({ NODE_ENV: "development", STRIPE_JS_URL: "http://evil.example/v3" })).toThrow(/STRIPE_JS_URL/);
  });
  it("builds the CSP script origins from the validated value: Stripe's own, plus the stand-in only when configured", () => {
    expect(stripeScriptOrigins("https://js.stripe.com/v3")).toEqual(["https://js.stripe.com"]);
    expect(stripeScriptOrigins(stub)).toEqual(["https://js.stripe.com", "http://localhost:5080"]);
  });
});

describe("ALLOW_LIVE_STRIPE_KEYS", () => {
  it("is off by default, and is honoured only in production", () => {
    expect(loadConfig(good).allowLiveStripeKeys).toBe(false);
    expect(loadConfig({ ...good, ALLOW_LIVE_STRIPE_KEYS: "1" }).allowLiveStripeKeys).toBe(true);
    expect(loadConfig({ ...good, ALLOW_LIVE_STRIPE_KEYS: "true" }).allowLiveStripeKeys).toBe(false);          // only the exact value 1
    expect(loadConfig({ NODE_ENV: "development", ALLOW_LIVE_STRIPE_KEYS: "1" }).allowLiveStripeKeys).toBe(false);   // never outside production
  });
});

describe("demo data (test mode, M9)", () => {
  it("is off by default and in every spelling that is not an explicit yes", () => {
    expect(loadConfig(good).demoEnabled).toBe(false);
    for (const v of [undefined, "", "false", "0", "yes", "enabled", "tru"]) expect(loadConfig({ ...good, DEMO_ENABLED: v }).demoEnabled, String(v)).toBe(false);
  });
  it("a production build with it off or unset starts normally, on production and on the test site alike", () => {
    expect(() => loadConfig(good)).not.toThrow();
    expect(() => loadConfig({ ...good, DEMO_ENABLED: "false" })).not.toThrow();
    expect(() => loadConfig({ ...good, APP_ENV: "staging" })).not.toThrow();
  });
  const REFUSED = /DEMO_ENABLED must not be true here/;
  it("refuses to start on the production site with it on, however it is spelled, and with no override", () => {
    for (const v of ["true", "TRUE", " True ", "1"]) fails({ ...good, DEMO_ENABLED: v }, REFUSED);
    fails({ ...good, DEMO_ENABLED: "true", APP_ENV: "production" }, REFUSED);
    fails({ ...good, DEMO_ENABLED: "true", APP_ENV: " Production " }, REFUSED);
    fails({ ...good, DEMO_ENABLED: "true", ALLOW_DEMO: "1", DEMO_FORCE: "true", ALLOW_DEMO_IN_PRODUCTION: "1", DEMO_ALLOW: "1" }, REFUSED);
    fails({ ...good, NODE_ENV: undefined, DEMO_ENABLED: "true" }, REFUSED);                  // an unset NODE_ENV is production
    fails({ NODE_ENV: "development", APP_ENV: "production", DEMO_ENABLED: "true" }, REFUSED);   // a development run that says it is production is production
  });
  it("is an allowlist: any other deployment name refuses too, whatever it is called (M9-06)", () => {
    for (const name of ["prod", "live", "demo", "anything", "stagin", "staging2", "development-eu", "production-eu"])
      fails({ ...good, DEMO_ENABLED: "true", APP_ENV: name }, REFUSED);
    fails({ NODE_ENV: "development", APP_ENV: "live", DEMO_ENABLED: "true" }, REFUSED);   // a development run that names itself something else is not on the list
  });
  it("the test site is a production build named staging, and may use it", () => {
    expect(loadConfig({ ...good, DEMO_ENABLED: "true", APP_ENV: "staging" }).demoEnabled).toBe(true);
    expect(loadConfig({ ...good, DEMO_ENABLED: "1", APP_ENV: " Staging " }).demoEnabled).toBe(true);
    for (const name of ["testing", "TEST", "development"]) expect(loadConfig({ ...good, DEMO_ENABLED: "true", APP_ENV: name }).demoEnabled, name).toBe(true);
  });
  it("may be on in development and test", () => {
    expect(loadConfig({ NODE_ENV: "development", DEMO_ENABLED: "true" }).demoEnabled).toBe(true);
    expect(loadConfig({ NODE_ENV: "test", DEMO_ENABLED: "1" }).demoEnabled).toBe(true);
  });
  it("names the deployment: APP_ENV, else production for a production build and development otherwise", () => {
    expect(deploymentOf({})).toBe("production");
    expect(deploymentOf({ NODE_ENV: "production" })).toBe("production");
    expect(deploymentOf({ NODE_ENV: "development" })).toBe("development");
    expect(deploymentOf({ NODE_ENV: "test" })).toBe("development");
    expect(deploymentOf({ NODE_ENV: "production", APP_ENV: " Staging " })).toBe("staging");
    expect(deploymentOf({ NODE_ENV: "production", APP_ENV: "   " })).toBe("production");
  });
});
