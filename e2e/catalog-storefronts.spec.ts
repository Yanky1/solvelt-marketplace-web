import { expect, test } from "@playwright/test";
import { gid } from "./mock-catalog.mjs";

const MAZEL = gid("s:mazel");
type P = import("@playwright/test").Page;
async function openFilters(page: P) {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const d = page.locator("details.facets-mobile");                                     // only shown on a phone; on a wide screen the panel is already there
  if ((await d.isVisible()) && (await d.getAttribute("open")) === null) await d.locator("summary").click();
}

test.describe("brand page", () => {
  test("shows the brand's own listings, who sells it, and its categories", async ({ page }) => {
    await page.goto("/b/challah-corner");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Challah Corner");
    await expect(page.locator("#results-heading")).toHaveText("2 results");
    await expect(page.getByRole("link", { name: "Mazel Bakery" })).toHaveAttribute("href", `/s/${MAZEL}`);
    for (const title of await page.locator(".listing-card-title").allInnerTexts()) expect(["Classic Braided Challah", "Honey Cake for Rosh Hashanah"]).toContain(title);
    await expect(page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: /Bakery/ })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/b\/challah-corner$/);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(ld.map((t) => JSON.parse(t)["@type"])).toEqual(["Brand", "BreadcrumbList"]);
  });

  test("the brand stays fixed while filters change, and its own filter is not offered", async ({ page }) => {
    await page.goto("/b/challah-corner");
    await openFilters(page);
    await expect(page.getByRole("form", { name: "Filter results" }).getByText("Any brand")).toHaveCount(0);
    await page.getByRole("checkbox", { name: /In stock only/ }).check();
    await expect(page).toHaveURL(/\/b\/challah-corner\?available=true$/);
    await expect(page.locator("#results-heading")).toHaveText("1 result");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/b\/challah-corner$/);
  });

  test("an id in the address goes to the slug, and an unknown brand is a 404", async ({ page }) => {
    await page.goto(`/b/${gid("b:challah-corner")}?available=true`);
    await expect(page).toHaveURL(/\/b\/challah-corner\?available=true$/);
    for (const path of ["/b/nope", "/b/Bad%20Slug", "/b/%00"]) expect((await page.goto(path))!.status(), path).toBe(404);
  });

  test("the product page links to its brand page", async ({ page }) => {
    await page.goto("/p/classic-braided-challah");
    await page.getByRole("link", { name: "Challah Corner" }).click();
    await expect(page).toHaveURL(/\/b\/challah-corner$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Challah Corner");
  });
});

test.describe("seller page", () => {
  test("shows the seller's brands and all of its listings, and the brand links go to the brand pages", async ({ page }) => {
    await page.goto(`/s/${MAZEL}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mazel Bakery");
    await expect(page.locator("#results-heading")).toHaveText("2 results");
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);                      // the plain seller page is indexed
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/s/${MAZEL}$`));
    const brands = page.getByRole("navigation", { name: "Brands by Mazel Bakery" });
    await brands.getByRole("link", { name: /Challah Corner/ }).click();
    await expect(page).toHaveURL(/\/b\/challah-corner$/);
  });

  test("filters keep the seller; the brand filter is still offered", async ({ page }) => {
    await page.goto(`/s/${gid("s:judaica")}`);
    await openFilters(page);
    await expect(page.getByRole("form", { name: "Filter results" }).getByText("Any brand")).toBeVisible();
    await page.getByRole("checkbox", { name: /In stock only/ }).check();
    await expect(page).toHaveURL(new RegExp(`/s/${gid("s:judaica")}\\?available=true$`));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  });

  test("an unknown or malformed seller is a 404", async ({ page }) => {
    for (const path of ["/s/not-a-guid", `/s/${gid("s:nobody")}`, "/s/%00", "/s/" + "a".repeat(100)]) expect((await page.goto(path))!.status(), path).toBe(404);
  });

  test("an upper-case id is accepted", async ({ page }) => {
    const res = await page.goto(`/s/${MAZEL.toUpperCase()}`);
    expect(res!.status()).toBeLessThan(400);
  });
});
