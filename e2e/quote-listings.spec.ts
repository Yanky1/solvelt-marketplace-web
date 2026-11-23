import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { waitHydrated } from "./helpers";

/**
 * W3 item 1 (API decision W3-01, DESIGN W3-01): a service the seller prices per job is listed with "Request a quote" instead of a price, never "$0" or "From $0";
 * it comes last in both price sorts, a price filter leaves it out, and its page offers the quote form with no price, no variant picker and no Offer price for search engines.
 */
const KITCHEN = "/p/custom-kitchen-remodel";
const card = (page: import("@playwright/test").Page) => page.locator(".listing-card").filter({ hasText: "Custom Kitchen Remodel" });

test.describe("services priced by quote", () => {
  test("the search card says Request a quote and shows no price", async ({ page }) => {
    await page.goto("/search?type=service");
    const c = card(page);
    await expect(c).toHaveCount(1);
    await expect(c.getByTestId("request-quote")).toHaveText("Request a quote");
    await expect(c).not.toContainText("$");
    await expect(c.getByRole("link")).toHaveAttribute("href", KITCHEN);
    await expect(page.locator(".listing-card").filter({ hasText: "Deep House Cleaning" })).toContainText("$");    // a priced service still shows its price
  });

  test("it comes after every priced listing in both price orders", async ({ page }) => {
    for (const sort of ["price_asc", "price_desc"]) {
      await page.goto(`/search?type=service&sort=${sort}`);
      const titles = await page.locator(".listing-card-title").allTextContents();
      expect(titles.at(-1), sort).toBe("Custom Kitchen Remodel");
    }
  });

  test("a price filter leaves it out, and the price range never starts at zero", async ({ page }) => {
    await page.goto("/search?type=service&priceMin=0");
    await expect(page.locator(".listing-card").filter({ hasText: "Deep House Cleaning" })).toHaveCount(1);
    await expect(card(page)).toHaveCount(0);
    await page.goto("/search?type=service&priceMax=1000000");
    await expect(card(page)).toHaveCount(0);
    await page.goto("/search?type=service");
    await expect(page.locator("main")).not.toContainText("$0.00");
  });

  test("its page offers the quote form with no price, no options and no price for search engines", async ({ page }) => {
    await page.goto(KITCHEN);
    await waitHydrated(page);
    await expect(page.getByRole("heading", { level: 1, name: "Custom Kitchen Remodel" })).toBeVisible();
    await expect(page.getByTestId("quote-price")).toContainText("request a quote");
    await expect(page.getByTestId("quote-price")).toContainText("Taking quote requests");
    await expect(page.locator(".pdp-buy")).not.toContainText("$");
    await expect(page.getByRole("form", { name: /^Ask for a quote/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Add to cart/ })).toHaveCount(0);
    await expect(page.locator('meta[property="product:price:amount"]')).toHaveCount(0);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent())!);
    expect(ld["@type"]).toBe("Service");
    expect(ld).not.toHaveProperty("offers");
  });
});

for (const theme of ["light", "dark"] as const) {
  for (const path of [KITCHEN, "/search?type=service"]) {
    test(`axe: ${path} (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
      await page.goto(path);
      await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, JSON.stringify(results.violations.map((x) => ({ id: x.id, nodes: x.nodes.map((n) => n.target) })), null, 1)).toEqual([]);
    });
  }
}
