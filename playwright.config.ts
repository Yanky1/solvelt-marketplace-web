import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
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
    { name: "desktop", testIgnore: /\.mobile\.spec\.ts$/, use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    { command: "node e2e/mock-api.mjs", url: "http://localhost:5080/health", reuseExistingServer: !process.env.CI },
    {
      command: "node server.js",
      url: `http://localhost:${PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      env: {
        NODE_ENV: "production",
        PORT: String(PORT),
        API_BASE_URL: "http://localhost:5080",
        PUBLIC_ORIGIN: `http://localhost:${PORT}`,
        SESSION_COOKIE_SECRET: "Pq8Vn2Ws6Zk0Jd4Lc9Rb3Hm7Ty1Fg5XeA8u",
        WEB_FORWARDING_KEY: "Mh3Xt7Bk1Qw5Zn9Vs2Dj6Lc0Rf4Pg8YaE1o",
      },
    },
  ],
});
