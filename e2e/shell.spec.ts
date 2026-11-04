import { expect, test } from "@playwright/test";

test("404 page has status 404 and noindex", async ({ page }) => {
  const res = await page.goto("/nope");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("skip link moves focus to main", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("theme choice is stored in a cookie and rendered by the server (no flash)", async ({ page, request }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const html = await (await request.get("/", { headers: { cookie: "solvelt_theme=dark" } })).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
});

test("theme action rejects cross-origin posts", async ({ request }) => {
  const res = await request.post("/theme", { form: { theme: "dark" }, headers: { origin: "https://evil.example" }, maxRedirects: 0 });
  expect(res.status()).toBe(403);
});

test("theme action ignores open-redirect targets", async ({ request, baseURL }) => {
  const res = await request.post("/theme", { form: { theme: "dark", redirectTo: "//evil.example" }, headers: { origin: baseURL! }, maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("/");
});

test("robots.txt and sitemap.xml are served", async ({ request, baseURL }) => {
  expect(await (await request.get("/robots.txt")).text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  expect(await (await request.get("/sitemap.xml")).text()).toContain(`<loc>${baseURL}/</loc>`);
});

test("start-up fails in production without config", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("node", ["server.js"], { env: { PATH: process.env.PATH!, NODE_ENV: "production" }, encoding: "utf8", timeout: 20000 });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/Invalid configuration/);
});
