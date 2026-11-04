import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
        SESSION_COOKIE_SECRET: "e2e-secret-e2e-secret-e2e-secret-0000",
        WEB_FORWARDING_KEY: "e2e-forwarding-e2e-forwarding-key-0000",
      },
    },
  ],
});
