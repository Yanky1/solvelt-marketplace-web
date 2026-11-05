import { expect, test } from "@playwright/test";

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);

test.describe("robots and sitemaps", () => {
  test("robots.txt keeps private areas and the suggestion route out, leaves /search crawlable (it says noindex itself), and names the sitemap", async ({ request, baseURL }) => {
    const res = await request.get("/robots.txt");
    expect(res.headers()["content-type"]).toContain("text/plain");
    const body = await res.text();
    for (const line of ["Disallow: /account", "Disallow: /cart", "Disallow: /checkout", "Disallow: /search/suggest", `Sitemap: ${baseURL}/sitemap.xml`]) expect(body).toContain(line);
    expect(body).not.toMatch(/^Disallow: \/search$/m);
    expect(body).not.toMatch(/^Disallow: \/img/m);
  });

  test("the index lists the static sitemap and a page of each kind", async ({ request, baseURL }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<sitemapindex");
    expect(locs(xml)).toEqual(["static", "listings", "categories", "brands"].map((k) => `${baseURL}/sitemaps/${k}/1.xml`));
  });

  test("child sitemaps list absolute addresses with dates, and validators let a crawler ask for changes only", async ({ request, baseURL }) => {
    const listings = await request.get("/sitemaps/listings/1.xml");
    expect(listings.status()).toBe(200);
    const xml = await listings.text();
    expect(xml).toContain(`<loc>${baseURL}/p/classic-braided-challah</loc><lastmod>2026-09-04T09:00:00Z</lastmod>`);
    expect(xml).not.toContain("retired-spice-gift-set");                                   // an unlisted listing is not offered
    expect(listings.headers()["cache-control"]).toBe("public, max-age=300");
    expect(listings.headers()["last-modified"]).toBeTruthy();
    const etag = listings.headers()["etag"]!;
    const again = await request.get("/sitemaps/listings/1.xml");
    expect(again.headers()["etag"]).toBe(etag);
    const cached = await request.get("/sitemaps/listings/1.xml", { headers: { "If-None-Match": etag } });
    expect(cached.status()).toBe(304);
    expect(await cached.text()).toBe("");
    expect(locs(await (await request.get("/sitemaps/categories/1.xml")).text())).toContain(`${baseURL}/c/bakery`);
    expect(locs(await (await request.get("/sitemaps/brands/1.xml")).text())).toContain(`${baseURL}/b/challah-corner`);
    expect(locs(await (await request.get("/sitemaps/static/1.xml")).text())).toEqual([`${baseURL}/`, `${baseURL}/categories`, `${baseURL}/services`, `${baseURL}/brands`]);
  });

  test("no sitemap sets a cookie or shows anything about a visitor", async ({ request }) => {
    for (const path of ["/sitemap.xml", "/sitemaps/static/1.xml", "/sitemaps/listings/1.xml", "/robots.txt"]) {
      const res = await request.get(path);
      expect(res.headers()["set-cookie"], path).toBeUndefined();
      expect(res.headers()["vary"] ?? "", path).not.toMatch(/cookie/i);
    }
  });

  test("unknown kinds, pages and spellings are 404", async ({ request }) => {
    for (const path of ["/sitemaps/nope/1.xml", "/sitemaps/listings/0.xml", "/sitemaps/listings/1", "/sitemaps/listings/2.xml", "/sitemaps/static/2.xml", "/sitemaps/listings/1.xml.gz", "/sitemaps/%00/1.xml", "/sitemaps/listings/9999.xml"]) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });

  test("every address the sitemaps offer is a real page that names itself as its canonical address", async ({ request, baseURL }) => {
    const index = locs(await (await request.get("/sitemap.xml")).text());
    const pages: string[] = [];
    for (const child of index) pages.push(...locs(await (await request.get(child.replace(baseURL!, ""))).text()));
    expect(pages.length).toBeGreaterThan(40);                                              // 31 listings, categories, brands and the static pages
    for (const url of pages) {
      const res = await request.get(url.replace(baseURL!, ""));
      expect(res.status(), url).toBe(200);
      const html = await res.text();
      expect(html, url).not.toMatch(/<meta name="robots" content="noindex/);                // nothing offered to crawlers says "do not index"
      if (url !== `${baseURL}/categories`) expect(html, url).toContain(`<link rel="canonical" href="${url}"`);
    }
  });
});

test.describe("structured data on the home page", () => {
  test("describes the site and how to search it", async ({ page, baseURL }) => {
    await page.goto("/");
    const blocks = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((t) => JSON.parse(t));
    const site = blocks.find((b) => b["@type"] === "WebSite");
    expect(site.url).toBe(`${baseURL}/`);
    expect(site.potentialAction.target.urlTemplate).toBe(`${baseURL}/search?q={search_term_string}`);
    expect(blocks.find((b) => b["@type"] === "Organization").name).toBe("Solvelt Market");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}/`);
  });
});

test.describe("the categories page", () => {
  test("links to every category page and works from the home page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Browse categories" }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All categories");
    const food = page.getByRole("region", { name: /Food & Drink/ });
    await expect(food.getByRole("link", { name: /Bakery/ })).toHaveAttribute("href", "/c/bakery");
    await expect(page.getByRole("link", { name: /^Gifts/ })).toHaveAttribute("href", "/c/gifts");
    await food.getByRole("link", { name: /Bakery/ }).click();
    await expect(page).toHaveURL(/\/c\/bakery$/);
  });
});
