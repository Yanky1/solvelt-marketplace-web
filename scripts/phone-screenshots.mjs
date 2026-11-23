// Regenerates docs/screenshots/phone-<sign-in|code|methods>-<desktop|mobile>-<light|dark>.png (DESIGN W3-02): signing in with a text message as an account made by phone, and its sign-in methods page.
// Usage: npm run build && node scripts/phone-screenshots.mjs   (PW_CHROMIUM_PATH optional). Its own ports, like the offer screenshots, so the full `npm run screenshots` stays as it was.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const PORT = 3203, API_PORT = 5084;
const BASE = `http://localhost:${PORT}`, MOCK = `http://localhost:${API_PORT}`;
const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), API_BASE_URL: MOCK, MOCK_API_PORT: String(API_PORT), PUBLIC_ORIGIN: BASE, SESSION_COOKIE_SECRET: "Ud6Ky2Hm8Wb4Tn0Vc3Zs7Jq1Lf5Rg9XpA2e", WEB_FORWARDING_KEY: "Bz5Ne9Wt3Kd7Hs1Vq6Mc2Xj8Pf4Lg0RyT3a" };
const procs = [spawn("node", ["e2e/mock-api.mjs"], { env, stdio: "ignore" }), spawn("node", ["server.js"], { env, stdio: "inherit" })];
const stop = () => procs.forEach((p) => p.kill());
process.on("exit", stop);
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok && (await fetch(`${MOCK}/health`)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
let k = 0;
for (const [form, device] of [["desktop", devices["Desktop Chrome"]], ["mobile", devices["Pixel 7"]]]) {
  for (const theme of ["light", "dark"]) {
    const number = `71855501${String(10 + k++)}`;
    await fetch(`${MOCK}/__test/phone-account?phone=${number}&name=Dana%20Levi`);
    const context = await browser.newContext({ ...device });
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: BASE }]);
    const page = await context.newPage();
    const shot = async (name) => { await page.evaluate("window.scrollTo(0, 0)"); await page.screenshot({ path: `docs/screenshots/phone-${name}-${form}-${theme}.png`, fullPage: true }); };

    await page.goto(`${BASE}/sign-in/phone`, { waitUntil: "networkidle" });
    await page.getByLabel("Phone number").fill(number);
    await shot("sign-in");
    await page.getByRole("button", { name: "Text me a code" }).click();
    await page.getByTestId("code-sent").waitFor();
    await shot("code");
    const { code } = await (await fetch(`${MOCK}/__test/sms?phone=${number}`)).json();
    await page.getByLabel("Six-digit code").fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/account$/);
    await page.goto(`${BASE}/account/sign-in-methods`, { waitUntil: "networkidle" });
    await shot("methods");
    await context.close();
  }
}
await browser.close();
stop();
