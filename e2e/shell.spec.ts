import { expect, test } from "@playwright/test";
import { csrfFor } from "./helpers";

test("404 page has status 404 and noindex", async ({ page }) => {
  const res = await page.goto("/nope");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
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

test("theme action rejects cross-origin posts and missing or wrong CSRF tokens", async ({ request, baseURL }) => {
  const csrf = await csrfFor(request, "/");
  expect((await request.post("/theme", { form: { theme: "dark", csrf }, headers: { origin: "https://evil.example" }, maxRedirects: 0 })).status()).toBe(403);
  expect((await request.post("/theme", { form: { theme: "dark" }, headers: { origin: baseURL! }, maxRedirects: 0 })).status()).toBe(403);
  expect((await request.post("/theme", { form: { theme: "dark", csrf: "forged" }, headers: { origin: baseURL! }, maxRedirects: 0 })).status()).toBe(403);
  expect((await request.post("/theme", { form: { theme: "dark", csrf }, headers: { origin: baseURL! }, maxRedirects: 0 })).status()).toBe(302);
});

for (const bad of ["//evil.example", "/\t/evil.example/x", "/\n/evil.example", "/ /evil.example", "/\\evil.example", "https://evil.example", "/\u0000/evil.example"]) {
  test(`theme action never redirects off-site: ${JSON.stringify(bad)}`, async ({ request, baseURL }) => {
    const csrf = await csrfFor(request, "/");
    const res = await request.post("/theme", { form: { theme: "dark", redirectTo: bad, csrf }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["location"]).toBe("/");
  });
}

test("theme action ignores open-redirect targets", async ({ request, baseURL }) => {
  const csrf = await csrfFor(request, "/");
  const res = await request.post("/theme", { form: { theme: "dark", redirectTo: "//evil.example", csrf }, headers: { origin: baseURL! }, maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers()["location"]).toBe("/");
});

test("robots.txt and sitemap.xml are served", async ({ request, baseURL }) => {
  expect(await (await request.get("/robots.txt")).text()).toContain(`Sitemap: ${baseURL}/sitemap.xml`);
  // the index names the child sitemaps; the home page is in the static one (the catalog sitemaps are checked in seo.spec.ts)
  expect(await (await request.get("/sitemap.xml")).text()).toContain(`<loc>${baseURL}/sitemaps/static/1.xml</loc>`);
  expect(await (await request.get("/sitemaps/static/1.xml")).text()).toContain(`<loc>${baseURL}/</loc>`);
});

test("start-up fails when NODE_ENV is unset and with weak secrets", async () => {
  const { spawnSync } = await import("node:child_process");
  const unset = spawnSync("node", ["server.js"], { env: { PATH: process.env.PATH! }, encoding: "utf8", timeout: 20000 });
  expect(unset.status).not.toBe(0);
  expect(unset.stderr).toMatch(/Invalid configuration/);
  const weak = spawnSync("node", ["server.js"], { env: { PATH: process.env.PATH!, NODE_ENV: "production", API_BASE_URL: "https://a.example", PUBLIC_ORIGIN: "https://s.example", SESSION_COOKIE_SECRET: "a".repeat(40), WEB_FORWARDING_KEY: "change-me-change-me-change-me-change-me" }, encoding: "utf8", timeout: 20000 });
  expect(weak.status).not.toBe(0);
  expect(weak.stderr).toMatch(/too little variety/);
  expect(weak.stderr).toMatch(/placeholder/);
  expect(weak.stderr).not.toContain("a".repeat(40));
});

test("start-up fails in production without config", async () => {
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync("node", ["server.js"], { env: { PATH: process.env.PATH!, NODE_ENV: "production" }, encoding: "utf8", timeout: 20000 });
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/Invalid configuration/);
});

// Issue #2 (M8W-08): the home page's Featured shelf shows the catalog's listings (the mock catalog has some), never the old placeholder.
test("the home page shows listings from the catalog under Featured", async ({ page }) => {
  await page.goto("/");
  const shelf = page.getByRole("list", { name: "Featured listings" });
  await expect(shelf.getByRole("link").first()).toBeVisible();
  expect(await shelf.getByRole("listitem").count()).toBeGreaterThan(0);
  await expect(page.getByText("Listings are on their way")).toHaveCount(0);
});
