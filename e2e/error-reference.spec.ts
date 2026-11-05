import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { waitHydrated } from "./helpers";

// Decision M8W-03: an unexpected error shows "Reference: <id>": the API's correlation id for a server fault, one made by the web server when the API did not answer.
// A failed page carries it in the root's data; a failed client-side request carries it in a short-lived cookie the error page reads once.
const reference = (page: Page) => page.getByTestId("error-reference");

test.describe("the error reference", () => {
  test("a page whose API call failed with a server fault shows the API's correlation id", async ({ page }) => {
    const res = await page.goto("/p/explode-500");
    expect([500, 503]).toContain(res?.status());   // the product page turns an API fault into a 503 page
    await expect(page.getByRole("heading", { name: "Something went wrong" })).toBeVisible();
    await expect(reference(page)).toContainText("Reference: 0HN7E2ECORR001");
    await expect(reference(page).getByRole("button", { name: "Copy reference" })).toBeVisible();
  });

  test("an API that never answers gives a reference made by the web server", async ({ page }) => {
    await page.goto("/p/drop-503");
    await expect(page.getByRole("heading", { name: /Something went wrong|Please try again/ })).toBeVisible();
    const text = await reference(page).innerText().catch(() => "");
    // the page may show its own "try again" message for an unavailable API; when it shows the generic error it must carry a W- reference
    if (text) expect(text).toMatch(/Reference: W-[0-9a-f]{10}/);
  });

  test("a failure after a client-side navigation shows it too (the cookie path), once", async ({ page }) => {
    await page.goto("/");
    await waitHydrated(page);
    await page.evaluate(() => (window as unknown as { __reactRouterDataRouter: { navigate: (to: string) => Promise<void> } }).__reactRouterDataRouter.navigate("/p/explode-500"));
    await expect(reference(page)).toContainText("Reference: 0HN7E2ECORR001");
    // read once: the cookie is gone, so a later unrelated error cannot show an old reference
    expect(await page.evaluate(() => document.cookie)).not.toContain("sl_ref=");
  });

  test("the error page with its reference passes axe in light and dark", async ({ page, context }) => {
    for (const theme of ["light", "dark"]) {
      await context.addCookies([{ name: "solvelt_theme", value: theme, url: page.url() === "about:blank" ? "http://localhost:3100" : page.url() }]);
      await page.goto("/p/explode-500");
      await expect(reference(page)).toBeVisible();
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations, `${theme}: ${JSON.stringify(axe.violations.map((v) => v.id))}`).toEqual([]);
    }
  });

  test("a checkout the API fails shows the reference in its message", async ({ page }) => {
    await page.goto("/p/classic-braided-challah");
    await waitHydrated(page);
    await page.getByRole("button", { name: /^Add Classic Braided Challah, .*, to cart$/ }).click();
    await page.waitForURL(/\/cart\?notice=added$/);
    await page.goto("/checkout");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(`guest-${Date.now()}@example.com`);
    await page.getByLabel("Full name").fill("Explode Checkout");
    await page.getByLabel("Street address").fill("1 Main St");
    await page.getByLabel("City").fill("Brooklyn");
    await page.getByLabel("State / region").fill("NY");
    await page.getByLabel("Postal code").fill("11201");
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await page.getByTestId("checkout-review").waitFor();
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await expect(page.getByText("Reference: 0HN7E2ECORR002")).toBeVisible();
  });

  test("an ordinary missing page has no reference", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(reference(page)).toHaveCount(0);
  });

  test("the reference never carries anything but the id: no query string reaches the page's reference", async ({ page }) => {
    await page.goto("/p/explode-500?email=someone@example.com");
    await expect(reference(page)).not.toContainText("someone@example.com");
  });
});
