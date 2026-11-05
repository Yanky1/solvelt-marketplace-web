// Screenshots of the wishlist and recently-viewed pages (M6): docs/screenshots/<page>-<desktop|mobile>-<light|dark>.png, from the built SSR server and the mock API.
// Usage: npm run build && node scripts/screenshots-lists.mjs   (PW_CHROMIUM_PATH optional). The older pages are not regenerated here, so their files stay untouched.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium, devices } from "@playwright/test";

const PORT = 3201, API = 5082;
const BASE = `http://localhost:${PORT}`, MOCK = `http://localhost:${API}`;
const env = { ...process.env, NODE_ENV: "production", PORT: String(PORT), API_BASE_URL: MOCK, MOCK_API_PORT: String(API), PUBLIC_ORIGIN: BASE, SESSION_COOKIE_SECRET: "Ud6Ky2Hm8Wb4Tn0Vc3Zs7Jq1Lf5Rg9XpA2e", WEB_FORWARDING_KEY: "Bz5Ne9Wt3Kd7Hs1Vq6Mc2Xj8Pf4Lg0RyT3a" };
const procs = [spawn("node", ["e2e/mock-api.mjs"], { env, stdio: "ignore" }), spawn("node", ["server.js"], { env, stdio: "inherit" })];
const stop = () => procs.forEach((p) => p.kill());
process.on("exit", stop);
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`${BASE}/healthz`)).ok) break; } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 250));
}

mkdirSync("docs/screenshots", { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
const A = "/p/classic-braided-challah", B = "/p/sold-out-honey-cake";
for (const [form, device] of [["desktop", devices["Desktop Chrome"]], ["mobile", devices["Pixel 7"]]]) {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ ...device });
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: BASE }]);
    const page = await context.newPage();
    const go = async (path) => { await page.goto(path.startsWith("http") ? path : BASE + path); await page.locator("html[data-hydrated=true]").waitFor(); };
    const shot = (name) => page.screenshot({ path: `docs/screenshots/${name}-${form}-${theme}.png`, fullPage: true });
    // a guest looks at two products: the shelf on the home page comes from this browser
    await go(A);
    await go(B);
    await go("/");
    await page.getByTestId("recently-viewed").waitFor();
    await shot("home-recently-viewed");
    const email = `lists-${form}-${theme}@example.test`;
    await page.goto(`${BASE}/sign-up`);
    await page.getByLabel("Name").fill("Dana Levi");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/verify-email/);
    const outbox = await (await fetch(`${MOCK}/__test/outbox`)).json();
    await page.goto(`${BASE}/verify-email?token=${outbox.filter((m) => m.email === email).at(-1).token}`);
    await page.getByLabel("Password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Verify email" }).click();
    await page.getByRole("heading", { name: "Email verified" }).waitFor();
    await page.goto(`${BASE}/sign-in`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/account$/);

    await go("/account/wishlists");
    await shot("wishlists-empty");
    await go(A);
    await page.getByText("Save to a list", { exact: true }).click();
    await page.getByLabel("New list").fill("Gifts for Dad");
    await page.getByRole("button", { name: "Create and save" }).click();
    await page.getByText("Gifts for Dad · Saved").waitFor();
    await shot("pdp-save-to-list");
    await go("/account/wishlists");
    await shot("wishlists");
    await page.getByRole("link", { name: "Gifts for Dad" }).click();
    await page.getByRole("link", { name: "Classic Braided Challah" }).waitFor();
    await page.getByRole("button", { name: "Create a share link" }).click();
    const url = await page.getByLabel("Share link").inputValue();
    await shot("wishlist-shared");
    await go(new URL(new URL(url).pathname, BASE).toString());
    await shot("wishlist-public");
    await context.close();
  }
}
await browser.close();
stop();
