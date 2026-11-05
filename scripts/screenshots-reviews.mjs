// Screenshots of the review and question pages (M6): docs/screenshots/<page>-<desktop|mobile>-<light|dark>.png, from the built SSR server and the mock API.
// Usage: npm run build && node scripts/screenshots-reviews.mjs   (PW_CHROMIUM_PATH optional). Older pages are not regenerated here.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const PORT = 3202, API = 5083;
const BASE = `http://localhost:${PORT}`, MOCK = `http://localhost:${API}`;
const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), API_BASE_URL: MOCK, MOCK_API_PORT: String(API), PUBLIC_ORIGIN: BASE, SESSION_COOKIE_SECRET: "Ud6Ky2Hm8Wb4Tn0Vc3Zs7Jq1Lf5Rg9XpA2e", WEB_FORWARDING_KEY: "Bz5Ne9Wt3Kd7Hs1Vq6Mc2Xj8Pf4Lg0RyT3a" };
const procs = [spawn("node", ["e2e/mock-api.mjs"], { env, stdio: "ignore" }), spawn("node", ["server.js"], { env, stdio: "inherit" })];
const stop = () => procs.forEach((p) => p.kill());
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const PASSWORD = "correct horse battery staple";
mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {});

async function account(page, email, name) {
  await page.goto(`${BASE}/sign-up`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/verify-email/);
  const outbox = await (await fetch(`${MOCK}/__test/outbox`)).json();
  await page.goto(`${BASE}/verify-email?token=${outbox.filter((m) => m.email === email).at(-1).token}`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Verify email" }).click();
  await page.getByRole("heading", { name: "Email verified" }).waitFor();
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/account$/);
}

const SLUGS = { "desktop-light": "classic-braided-challah", "desktop-dark": "silver-plated-shabbat-candlesticks", "mobile-light": "cabernet-sauvignon-mevushal", "mobile-dark": "sold-out-honey-cake" };   // one listing each: the mock is shared
for (const [form, device] of [["desktop", devices["Desktop Chrome"]], ["mobile", devices["Pixel 7"]]]) {
  for (const theme of ["light", "dark"]) {
    const slug = SLUGS[`${form}-${theme}`];
    const context = await browser.newContext({ ...device });
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: BASE }]);
    const page = await context.newPage();
    const go = async (path) => { await page.goto(BASE + path); await page.locator("html[data-hydrated=true]").waitFor(); };
    const shot = (name) => page.screenshot({ path: `docs/screenshots/${name}-${form}-${theme}.png`, fullPage: true });
    const email = `reviews-${form}-${theme}@example.test`;
    await account(page, email, "Dana Levi");
    const e = await (await fetch(`${MOCK}/__test/seed-eligible?email=${encodeURIComponent(email)}&slug=${slug}`)).json();

    await go(`/p/${slug}`);
    await shot("pdp-reviews-empty");
    await go(`/account/reviews/new?kind=order_line&target=${e.id}&listing=${e.listingId}`);
    await shot("review-new");
    await page.getByLabel("5 stars").check();
    await page.getByLabel("Your review").fill("Soft, golden and still warm when it arrived. We finished it before Shabbat was over.");
    await page.getByRole("button", { name: "Publish review" }).click();
    await page.getByText("Your review is published").waitFor();
    await page.setInputFiles("#photo-file", { name: "p.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await page.getByText("Photo added.").waitFor();
    await shot("review-edit");
    await go("/account/reviews");
    await shot("reviews");
    await go(`/p/${slug}`);
    await page.getByTestId("review").first().scrollIntoViewIfNeeded();
    await shot("pdp-reviews");
    await page.getByLabel("Your question").fill("Is it nut free?");
    await page.getByRole("button", { name: "Send question" }).click();
    await page.getByText("We sent your question to the seller", { exact: false }).waitFor();
    await go("/account/questions");
    await shot("questions");
    await context.close();
  }
}
await browser.close();
stop();
