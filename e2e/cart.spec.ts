import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { csrfFor, newVerifiedUser, signIn, waitHydrated } from "./helpers";
import { gid } from "./mock-catalog.mjs";

const CHALLAH = "/p/classic-braided-challah";
const addChallah = async (page: Page) => {
  await page.goto(CHALLAH);
  await waitHydrated(page);
  await page.getByRole("button", { name: /^Add Classic Braided Challah, .*, to cart$/ }).click();
  await expect(page).toHaveURL(/\/cart\?notice=added$/);
};

test.describe("cart", () => {
  test("a guest adds from the product page, sees the line and the header count, and the cart token never reaches the browser", async ({ page, context }) => {
    await addChallah(page);
    await expect(page.getByTestId("cart-notice")).toContainText("Added to your cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("cart-line")).toContainText("Classic Braided Challah");
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    await expect(page.getByRole("link", { name: "Cart, 1 item" })).toBeVisible();
    // the guest token lives only in the sealed HttpOnly cookie: not in the HTML, the .data answer, document.cookie or any storage (decision M3W-01)
    const html = await page.content();
    expect(html).not.toMatch(/cart_[0-9a-f]{20}/);
    const dataRes = await page.request.get("/cart.data");
    expect(await dataRes.text()).not.toMatch(/cart_[0-9a-f]{20}/);
    expect(await dataRes.text()).not.toContain("cartToken");
    expect(await page.evaluate(() => document.cookie)).not.toContain("solvelt_session");
    const cookie = (await context.cookies()).find((c) => c.name.endsWith("solvelt_session"));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.value ?? "").not.toMatch(/cart_/);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toMatch(/cart/i);
    // still there after a reload, and the response is private
    const res = await page.reload();
    expect(res?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
  });

  test("quantity changes and removal work and an emptied cart says so", async ({ page }) => {
    await addChallah(page);
    await waitHydrated(page);
    await page.getByLabel(/^Quantity of Classic Braided Challah/).fill("3");
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page.getByTestId("cart-notice")).toContainText("updated");
    await expect(page.getByTestId("cart-count")).toHaveText("3");
    await page.getByRole("button", { name: /^Remove Classic Braided Challah/ }).click();
    await expect(page.getByTestId("cart-notice")).toContainText("Removed");
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    await expect(page.getByTestId("cart-count")).toHaveText("0");
  });

  test("an item that cannot be bought is refused with a plain message and a forged request needs the CSRF token", async ({ page, baseURL }) => {
    await page.goto(CHALLAH);
    const csrf = await csrfFor(page.request, CHALLAH);
    const origin = { origin: baseURL! };
    const noToken = await page.request.post("/cart/items", { form: { variantId: gid("v:classic-braided-challah:0"), qty: "1" }, headers: origin, maxRedirects: 0 });
    expect(noToken.status()).toBe(403);                                                  // a right origin but no token
    const noOrigin = await page.request.post("/cart/items", { form: { csrf, variantId: gid("v:classic-braided-challah:0"), qty: "1" }, maxRedirects: 0 });
    expect(noOrigin.status()).toBe(403);                                                 // a token but no origin
    // a variant that does not exist: the cart says "not available", nothing is added
    const res = await page.request.post("/cart/items", { form: { csrf, variantId: gid("v:no-such-listing:9"), qty: "1" }, headers: origin, maxRedirects: 0 });
    expect(res.status(), await res.text()).toBe(302);
    expect(res.headers()["location"]).toBe("/cart?notice=unavailable");
    // out-of-range quantities and malformed ids are 400s, never forwarded
    expect((await page.request.post("/cart/items", { form: { csrf, variantId: gid("v:classic-braided-challah:0"), qty: "99" }, headers: origin, maxRedirects: 0 })).status()).toBe(400);
    expect((await page.request.post("/cart/items", { form: { csrf, variantId: "../../x", qty: "1" }, headers: origin, maxRedirects: 0 })).status()).toBe(400);
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
  });

  test("signing in merges the guest cart into the account's, and the header keeps the count", async ({ page }) => {
    await addChallah(page);
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    const email = await newVerifiedUser(page, "cartmerge");
    await signIn(page, email);
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    await page.goto("/cart");
    await expect(page.getByTestId("cart-line")).toHaveCount(1);
    await expect(page.getByTestId("cart-line")).toContainText("Classic Braided Challah");
  });

  test("signing in on a browser with no guest cart shows the count of the account's cart in the header", async ({ page, browser }) => {
    const email = await newVerifiedUser(page, "cartfresh");
    await signIn(page, email);
    await expect(page).toHaveURL(/\/account$/);
    await addChallah(page);
    await expect(page.getByTestId("cart-count")).toHaveText("1");
    // a different browser: no cookie, no guest cart, only the account's cart at the API
    const other = await browser.newContext({ baseURL: page.url() });
    const page2 = await other.newPage();
    await signIn(page2, email);
    await expect(page2).toHaveURL(/\/account$/);
    await expect(page2.getByTestId("cart-count")).toHaveText("1");
    await other.close();
  });

  test("the cart page has no accessibility violations, empty or full", async ({ page }) => {
    await page.goto("/cart");
    await expect(page.getByRole("heading", { name: "Your cart is empty" })).toBeVisible();
    let results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations.map((v) => v.id))).toEqual([]);
    await addChallah(page);
    results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))).toEqual([]);
  });
});
