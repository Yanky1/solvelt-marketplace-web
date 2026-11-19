// Regenerates docs/screenshots/offer-<listing|cart|checkout|confirmation>-<desktop|mobile>-<light|dark>.png from the built SSR server and the mock API (quantity offers, portal C18).
// Usage: npm run build && node scripts/offer-screenshots.mjs   (PW_CHROMIUM_PATH optional). The mock returns FIXED figures that mirror the API's test fixtures: 25 units over two lines = $22.50, a free Card wallet.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";
import { gid } from "../e2e/mock-catalog.mjs";

const PORT = 3201, API_PORT = 5082;
const BASE = `http://localhost:${PORT}`, MOCK = `http://localhost:${API_PORT}`;
const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), API_BASE_URL: MOCK, MOCK_API_PORT: String(API_PORT), PUBLIC_ORIGIN: BASE, SESSION_COOKIE_SECRET: "Ud6Ky2Hm8Wb4Tn0Vc3Zs7Jq1Lf5Rg9XpA2e", WEB_FORWARDING_KEY: "Bz5Ne9Wt3Kd7Hs1Vq6Mc2Xj8Pf4Lg0RyT3a", STRIPE_JS_URL: `http://localhost:${API_PORT}/__stripe/v3.js`, ALLOW_STRIPE_STUB: "1" };
const procs = [spawn("node", ["e2e/mock-api.mjs"], { env, stdio: "ignore" }), spawn("node", ["server.js"], { env, stdio: "inherit" })];
const stop = () => procs.forEach((p) => p.kill());
process.on("exit", stop);
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok && (await fetch(`${MOCK}/health`)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
const PACKS = "/p/tiered-card-packs";
for (const [form, device] of [["desktop", devices["Desktop Chrome"]], ["mobile", devices["Pixel 7"]]]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ ...device });
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: BASE }]);
    const page = await context.newPage();
    const shot = async (name) => { await page.evaluate("window.scrollTo(0, 0)"); await page.screenshot({ path: `docs/screenshots/offer-${name}-${form}-${theme}.png`, fullPage: true }); };

    await page.goto(BASE + PACKS, { waitUntil: "networkidle" });
    await shot("listing");

    for (const [which, qty] of [[0, 20], [1, 5]]) {                       // the cart limits a line to 20: 25 units are two lines
      await page.goto(`${BASE}${PACKS}?variant=${gid(`v:tiered-card-packs:${which}`)}`, { waitUntil: "networkidle" });
      await page.getByRole("spinbutton", { name: "Quantity" }).fill(String(qty));
      await page.getByRole("button", { name: /^Add to cart, Blitz Card Pack, / }).click();
      await page.waitForURL(/\/cart\?notice=added$/);
    }
    await page.waitForLoadState("networkidle");
    await shot("cart");

    const email = `offer-shots-${form}-${theme}@example.com`;
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Full name").fill("Dana Guest");
    await page.getByLabel("Street address").fill("1 Main St");
    await page.getByLabel("City").fill("Brooklyn");
    await page.getByLabel("State / region").fill("NY");
    await page.getByLabel("Postal code").fill("11201");
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await page.getByTestId("checkout-review").waitFor();
    await shot("checkout");

    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await page.getByTestId("payment-step").waitFor();
    const orders = await (await fetch(`${MOCK}/__test/checkout-orders`)).json();
    const mine = orders.find((o) => o.guestEmail === email);
    await fetch(`${MOCK}/__test/pay?number=${encodeURIComponent(mine.number)}&status=placed`);
    await page.getByRole("button", { name: /^Pay / }).click();
    await page.waitForURL(new RegExp(`/checkout/confirmation/${mine.number}`));
    await page.getByTestId("order-gift-line").waitFor();
    await page.waitForLoadState("networkidle");
    await shot("confirmation");
    await context.close();
  }
}
await browser.close();
stop();
