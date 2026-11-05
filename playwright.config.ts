import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// Test mode (M9) needs its own pair of servers: the production site refuses DEMO_ENABLED (there is no override), so the demo specs run against a production BUILD that says it is
// the test site (APP_ENV=staging) and a mock API started with MOCK_DEMO=1. The default servers stay in normal mode, which the demo spec also checks.
const DEMO_PORT = 3101, DEMO_API_PORT = 5081;
// Behind a TLS-terminating proxy (Azure) the server speaks http while the site is https: its own server, with an https PUBLIC_ORIGIN, reached over http (decision M8W-04).
const PROXY_PORT = 3102, PROXY_ORIGIN = "https://shop.example.test";
const FWD_KEY = "Mh3Xt7Bk1Qw5Zn9Vs2Dj6Lc0Rf4Pg8YaE1o"; // shared by the mock API and the web server under test
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0, // no retries anywhere: flakiness must show up
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Local sandboxes may ship a different Chromium build; CI installs its own via `playwright install`.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {},
  },
  projects: [
    { name: "desktop", testIgnore: [/\.mobile\.spec\.ts$/, /demo\.spec\.ts$/, /proxy-origin\.spec\.ts$/], use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", testIgnore: [/demo\.spec\.ts$/, /proxy-origin\.spec\.ts$/], use: { ...devices["Pixel 7"] } },
    { name: "proxy", testMatch: /proxy-origin\.spec\.ts$/, use: { baseURL: `http://localhost:${PROXY_PORT}` } },
    { name: "demo-desktop", testMatch: /demo\.spec\.ts$/, use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${DEMO_PORT}` } },
    { name: "demo-mobile", testMatch: /demo\.spec\.ts$/, use: { ...devices["Pixel 7"], baseURL: `http://localhost:${DEMO_PORT}` } },
  ],
  webServer: [
    { command: "node e2e/mock-api.mjs", url: "http://localhost:5080/health", reuseExistingServer: !process.env.CI, env: { WEB_FORWARDING_KEY: FWD_KEY } },
    { command: "node e2e/mock-api.mjs", url: `http://localhost:${DEMO_API_PORT}/health`, reuseExistingServer: !process.env.CI, env: { WEB_FORWARDING_KEY: FWD_KEY, MOCK_API_PORT: String(DEMO_API_PORT), MOCK_DEMO: "1" } },
    {
      command: "node server.js",
      url: `http://localhost:${DEMO_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "production", // the test site is a production build ...
        APP_ENV: "staging", // ... that says it is staging: only a production deployment refuses demo mode
        PORT: String(DEMO_PORT),
        API_BASE_URL: `http://localhost:${DEMO_API_PORT}`,
        PUBLIC_ORIGIN: `http://localhost:${DEMO_PORT}`,
        TRUSTED_PROXIES: "127.0.0.1,::1",
        SESSION_COOKIE_SECRET: "Pq8Vn2Ws6Zk0Jd4Lc9Rb3Hm7Ty1Fg5XeA8u",
        WEB_FORWARDING_KEY: FWD_KEY,
        STRIPE_JS_URL: `http://localhost:${DEMO_API_PORT}/__stripe/v3.js`,
        ALLOW_STRIPE_STUB: "1",
        DEMO_ENABLED: "true",
      },
    },
    {
      command: "node server.js",
      url: `http://localhost:${PROXY_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "production",
        PORT: String(PROXY_PORT),
        API_BASE_URL: "http://localhost:5080",
        PUBLIC_ORIGIN: PROXY_ORIGIN,   // https: the browser's address; this server itself is reached over plain http, as behind Azure's TLS termination
        TRUSTED_PROXIES: "127.0.0.1,::1",
        SESSION_COOKIE_SECRET: "Pq8Vn2Ws6Zk0Jd4Lc9Rb3Hm7Ty1Fg5XeA8u",
        WEB_FORWARDING_KEY: FWD_KEY,
      },
    },
    {
      command: "node server.js",
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "production",
        PORT: String(PORT),
        API_BASE_URL: "http://localhost:5080",
        PUBLIC_ORIGIN: `http://localhost:${PORT}`,
        TRUSTED_PROXIES: "127.0.0.1,::1", // tests send X-Forwarded-For to pick a client IP (and so a mock API variant)
        SESSION_COOKIE_SECRET: "Pq8Vn2Ws6Zk0Jd4Lc9Rb3Hm7Ty1Fg5XeA8u",
        WEB_FORWARDING_KEY: FWD_KEY,
        STRIPE_JS_URL: "http://localhost:5080/__stripe/v3.js", // a stand-in for Stripe.js served by the mock API
        ALLOW_STRIPE_STUB: "1", // the one way a non-Stripe script origin is accepted in a production build, and only when served from localhost
      },
    },
  ],
});
