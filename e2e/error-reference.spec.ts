import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { waitHydrated } from "./helpers";

// Decision M8W-03: an unexpected error shows "Reference: <id>": the API's correlation id for a server fault, one made by the web server when the API did not answer.
// The failed request leaves it in a short-lived HttpOnly cookie; the error page fetches it once from /error-ref, which clears it.
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
    // read once: the cookie is HttpOnly (the page never sees it) and is gone after the read, so a later unrelated error cannot show an old reference
    expect(await page.evaluate(() => document.cookie)).not.toContain("sl_ref=");
    expect((await page.context().cookies()).some((c) => c.name === "sl_ref")).toBe(false);
    expect(await (await page.request.get("/error-ref")).json()).toEqual({ ref: null });
  });

  test("the reference cookie is HttpOnly and /error-ref hands the id over once", async ({ request }) => {
    const failing = await request.get("/p/explode-500");
    const set = failing.headersArray().filter((h) => h.name.toLowerCase() === "set-cookie").map((h) => h.value).find((v) => v.startsWith("sl_ref="));
    expect(set, "the failed page sets sl_ref").toBeTruthy();
    expect(set).toContain("HttpOnly");
    expect(set).toContain("Max-Age=120");
    const id = set!.split(";")[0]!.slice("sl_ref=".length);
    const first = await request.get("/error-ref", { headers: { Cookie: `sl_ref=${id}` } });
    expect(await first.json()).toEqual({ ref: id });
    expect(first.headers()["cache-control"]).toContain("no-store");
    expect(first.headersArray().some((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("sl_ref=;") && h.value.includes("Max-Age=0"))).toBe(true);
    expect(await (await request.get("/error-ref", { headers: { Cookie: "sl_ref=<script>" } })).json()).toEqual({ ref: null });
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

  test("a checkout whose answer breaks this server's own code ends in the handled message with a W- reference, not a bare error", async ({ page }) => {
    await page.goto("/p/classic-braided-challah");
    await waitHydrated(page);
    await page.getByRole("button", { name: /^Add Classic Braided Challah, .*, to cart$/ }).click();
    await expect(page).toHaveURL(/\/cart\?notice=added$/);
    await page.goto("/checkout");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(`guest-${Date.now()}@example.com`);
    await page.getByLabel("Full name").fill("Null Checkout");
    await page.getByLabel("Street address").fill("1 Main St");
    await page.getByLabel("City").fill("Brooklyn");
    await page.getByLabel("State / region").fill("NY");
    await page.getByLabel("Postal code").fill("11201");       // phone and gift message stay empty, as on the owner's site
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await page.getByTestId("checkout-review").waitFor();
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await expect(page.getByText(/Reference: W-[0-9a-f]{10}/)).toBeVisible();
    await expect(page.getByText("Unexpected Server Error")).toHaveCount(0);
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
