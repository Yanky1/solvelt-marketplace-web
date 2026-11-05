import { expect, test } from "@playwright/test";

type P = import("@playwright/test").Page;
async function openFilters(page: P) {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const d = page.locator("details.facets-mobile");
  if ((await d.isVisible()) && (await d.getAttribute("open")) === null) await d.locator("summary").click();
}

test.describe("services page", () => {
  test("lists only services, is indexable, and has its own breadcrumb", async ({ page }) => {
    await page.goto("/services");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Services");
    const count = Number((await page.locator("#results-heading").innerText()).split(" ")[0]!.replace(/,/g, ""));
    expect(count).toBeGreaterThan(0);
    const cards = await page.locator(".listing-card").count();
    expect(cards).toBeGreaterThan(0);
    await expect(page.locator(".listing-card-kind")).toHaveCount(cards);                   // every card is a service
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/services$/);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.map((t) => JSON.parse(t)["@type"])).toEqual(["BreadcrumbList"]);
  });

  test("the type is fixed by the path: no type filter, no type in the address, ?type=product is redirected away", async ({ page }) => {
    await page.goto("/services");
    await openFilters(page);
    await expect(page.getByRole("form", { name: /Filter results/ }).locator("legend", { hasText: "Type" })).toHaveCount(0);
    await page.goto("/services?type=product");
    await expect(page).toHaveURL(/\/services$/);
    await page.goto("/services?type=service&sort=price_asc");
    await expect(page).toHaveURL(/\/services\?sort=price_asc$/);
  });

  test("sort and filters keep it a services page, and make it noindex with the plain page as canonical", async ({ page }) => {
    await page.goto("/services?sort=price_asc");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/services$/);
    await expect(page.locator(".filter-chips")).toHaveCount(0);                                 // a sort is not a filter, and the type is not shown as one
    const prices = await page.locator(".listing-card").count();
    expect(prices).toBeGreaterThan(0);
  });

  test("a search term stays on /services", async ({ page }) => {
    await page.goto("/services?q=zzzzzz");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Services for");
    await expect(page.locator("#results-heading")).toHaveText("0 results");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  });
});

test.describe("brands index", () => {
  test("lists every brand A to Z and links to the storefront", async ({ page }) => {
    await page.goto("/brands");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("All brands");
    const letters = await page.getByRole("navigation", { name: "Jump to a letter" }).getByRole("link").allInnerTexts();
    expect(letters.length).toBeGreaterThan(1);
    expect([...letters].sort()).toEqual(letters);
    await expect(page.getByRole("link", { name: /Challah Corner/ })).toHaveAttribute("href", "/b/challah-corner");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/brands$/);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.map((t) => JSON.parse(t)["@type"])).toEqual(["BreadcrumbList"]);
  });

  test("a brand link opens its storefront", async ({ page }) => {
    await page.goto("/brands");
    await page.getByRole("link", { name: /Challah Corner/ }).click();
    await expect(page).toHaveURL(/\/b\/challah-corner$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Challah Corner");
  });
});
