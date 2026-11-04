// Regenerates docs/screenshots/<page>-<desktop|mobile>-<light|dark>.png from the built SSR server.
// Usage: npm run build && npm run screenshots   (PW_CHROMIUM_PATH optional)
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const PORT = 3200;
const BASE = `http://localhost:${PORT}`;
const PAGES = { home: "/", styleguide: "/styleguide", "not-found": "/does-not-exist" };
const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), API_BASE_URL: "http://localhost:5081", MOCK_API_PORT: "5081", PUBLIC_ORIGIN: BASE, SESSION_COOKIE_SECRET: "screens-secret-screens-secret-0000000" };
const procs = [spawn("node", ["e2e/mock-api.mjs"], { env, stdio: "ignore" }), spawn("node", ["server.js"], { env, stdio: "inherit" })];
const stop = () => procs.forEach((p) => p.kill());
process.on("exit", stop);

for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
for (const [form, device] of [["desktop", devices["Desktop Chrome"]], ["mobile", devices["Pixel 7"]]]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ ...device });
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: BASE }]);
    const page = await context.newPage();
    for (const [name, path] of Object.entries(PAGES)) {
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.screenshot({ path: `docs/screenshots/${name}-${form}-${theme}.png`, fullPage: true });
    }
    await context.close();
  }
}
await browser.close();
stop();
