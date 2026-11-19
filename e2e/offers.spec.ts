// Quantity offers (portal C18; decisions Q-W1..Q-W10): the listing badge, the cart messages, the checkout discount and $0 gift line, the 409 offer_changed notice and the confirmation page, against the mock API.
// The mock returns FIXED figures that mirror the API's own test fixtures (a 100-cent pack, "10+ at 95c, 20+ at 90c, a free Card wallet from 10"; 25 units = 2250, discount 250): nothing here does tier maths.
import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { newVerifiedUser, waitHydrated } from "./helpers";
import { gid } from "./mock-catalog.mjs";

const MOCK = "http://localhost:5080";
const PACKS = "/p/tiered-card-packs";
const variant = (i: number) => gid(`v:tiered-card-packs:${i}`);
const WCAG = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

/** Adds `qty` units of one pack variant (0 = Pack A, 1 = Pack B) from the product page; the cart keeps a line per variant (the API limits a line to 20). */
async function addPack(page: Page, which: 0 | 1, qty: number) {
  await page.goto(`${PACKS}?variant=${variant(which)}`);
  await waitHydrated(page);
  await page.getByRole("spinbutton", { name: "Quantity" }).fill(String(qty));
  await page.getByRole("button", { name: /^Add to cart, Blitz Card Pack, / }).click();
  await expect(page).toHaveURL(/\/cart\?notice=added$/);
}

const newEmail = () => `guest-${randomBytes(6).toString("hex")}@example.com`;
async function fillDetails(page: Page, email: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Dana Guest");
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Brooklyn");
  await page.getByLabel("State / region").fill("NY");
  await page.getByLabel("Postal code").fill("11201");
}
async function toReview(page: Page, email: string) {
  await page.goto("/checkout");
  await waitHydrated(page);
  await fillDetails(page, email);
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  await expect(page.getByTestId("checkout-review")).toBeVisible();
}
type MockOrder = { number: string; guestEmail?: string };
const ordersOf = async (page: Page, email: string): Promise<MockOrder[]> => ((await (await page.request.get(`${MOCK}/__test/checkout-orders`)).json()) as MockOrder[]).filter((o) => o.guestEmail === email);

/** Axe in light AND dark: the theme cookie is set, the page reloaded, and the real palette asserted (axe stays green if a theme block is deleted). */
async function axeBothThemes(page: Page, context: BrowserContext, baseURL: string, what: string) {
  for (const theme of ["light", "dark"] as const) {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL }]);
    await page.reload();
    await waitHydrated(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations, `${what} (${theme}): ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`).toEqual([]);
  }
}

/** Axe in light AND dark on the page as it is now (a checkout step lives in an action result and a reload would lose it): the theme is the same `data-theme` attribute the server renders from the cookie,
 *  the real palette is asserted, and the other helper above covers the cookie round trip on pages that survive a reload. */
async function axeThemesNow(page: Page, what: string) {
  await page.evaluate(() => window.scrollTo(0, 0));                                // a sticky header over a scrolled field is a scroll artifact (axe: "partially obscured"), not a layout fault
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations, `${what} (${theme}): ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`).toEqual([]);
  }
}

test.describe("quantity offers", () => {
  test("the listing shows the offer badge, passes axe in light and dark, and stays out of the listings and the search", async ({ page, context, baseURL }) => {
    await page.goto(PACKS);
    const badges = page.getByTestId("offer-badges");
    await expect(badges).toContainText("Buy 10+, $0.95 each");
    await expect(badges).toContainText("Free Card wallet from 10");
    await axeBothThemes(page, context, baseURL!, PACKS);
    // the dedicated listing is reachable by its address only: it is in no category page, no search and no listing page, so the existing 26 generated listings (two pages of 24) are untouched.
    // (Read through the web, never straight from the mock: a direct call has no forwarding headers and would break the specs that check the API sees signed ones.)
    for (const path of ["/search?q=blitz", "/search", "/c/gifts", "/c/gifts?page=2"]) {
      await page.goto(path);
      await expect(page.locator('a[href="/p/tiered-card-packs"]')).toHaveCount(0);
    }
    await page.goto("/c/gifts?page=2");
    await expect(page.getByText("Gift Box 01")).toBeVisible();                       // the generated gift boxes still run over two pages
  });

  test("the cart says how many more reach the next price, then the free gift, then the next step, and never prices anything itself", async ({ page }) => {
    await addPack(page, 0, 3);
    const offer = page.getByTestId("cart-offer");
    await expect(offer).toContainText("Add 7 more for $0.95 each");
    await expect(offer).not.toContainText("Free gift");
    await expect(page.getByTestId("cart-subtotal")).toHaveText("$3.00");           // 3 x $1.00, no discount yet
    await waitHydrated(page);
    await page.getByLabel(/^Quantity of Blitz Card Pack/).fill("10");
    await page.getByRole("button", { name: "Update" }).click();
    await expect(page.getByTestId("cart-notice")).toContainText("updated");
    await expect(offer).toContainText("Free gift included: Card wallet");
    await expect(offer).toContainText("Add 10 more for $0.90 each");
    await expect(page.getByTestId("cart-subtotal")).toHaveText("$9.50");           // 10 at the 95c step: the server's figure
  });

  test("25 units over two lines cost $22.50, the checkout shows the discount and a $0 gift line, and the confirmation marks the gift", async ({ page, context, baseURL }) => {
    await addPack(page, 0, 20);
    await addPack(page, 1, 5);                                                       // the cart limits a line to 20: 25 units are two lines
    await expect(page.getByTestId("cart-line")).toHaveCount(2);
    await expect(page.getByTestId("cart-subtotal")).toHaveText("$22.50");
    await expect(page.getByTestId("cart-offer")).toContainText("Free gift included: Card wallet");
    await expect(page.getByTestId("cart-offer")).not.toContainText("Add ");          // already at the best step
    await axeBothThemes(page, context, baseURL!, "/cart with offers");
    const email = newEmail();
    await toReview(page, email);
    await expect(page.getByTestId("checkout-line-discount")).toHaveCount(2);
    await expect(page.getByTestId("checkout-discount")).toContainText("$2.50");
    const gift = page.getByTestId("checkout-gift-line");
    await expect(gift).toHaveCount(1);
    await expect(gift).toContainText("Card wallet");
    await expect(gift).toContainText("$0.00");
    await expect(page.getByTestId("checkout-gift-unavailable")).toHaveCount(0);
    await axeThemesNow(page, "/checkout review with offers");
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await expect(page.getByTestId("payment-step")).toBeVisible();
    const mine = (await ordersOf(page, email))[0]!;
    expect(mine).toBeTruthy();
    await page.request.get(`${MOCK}/__test/pay?number=${encodeURIComponent(mine.number)}&status=placed`);
    await page.getByRole("button", { name: /^Pay / }).click();
    await expect(page).toHaveURL(new RegExp(`/checkout/confirmation/${mine.number}`));
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "placed");
    await expect(page.getByTestId("order-gift-line")).toHaveCount(1);
    await expect(page.getByTestId("order-gift-line")).toContainText("Free gift");
    await expect(page.getByTestId("order-line-discount")).toHaveCount(2);
    await expect(page.getByTestId("order-gift-unavailable")).toHaveCount(0);
    await axeBothThemes(page, context, baseURL!, "the confirmation page with a gift");
  });

  test("an offer that changed after the quote shows the offer_changed notice with the fresh quote, charges nothing, and the placed order says the gift was unavailable", async ({ page }) => {
    await addPack(page, 0, 10);
    const email = newEmail();
    await toReview(page, email);
    await expect(page.getByTestId("checkout-gift-line")).toHaveCount(1);
    await page.request.get(`${MOCK}/__test/offer-changed?email=${encodeURIComponent(email)}`);
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    const notice = page.getByText(/A quantity offer in your cart changed/);
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Nothing was charged");
    await expect(page.getByTestId("payment-step")).toHaveCount(0);
    expect(await ordersOf(page, email)).toHaveLength(0);                             // nothing was created
    await expect(page.getByTestId("checkout-gift-line")).toHaveCount(0);             // the fresh quote has no gift ...
    await expect(page.getByTestId("checkout-gift-unavailable")).toContainText("Gift unavailable");   // ... and says so
    await axeThemesNow(page, "the offer_changed notice");
    await page.getByRole("button", { name: /^Place order and pay/ }).click();        // the buyer confirms the new quote
    await expect(page.getByTestId("payment-step")).toBeVisible();
    const mine = (await ordersOf(page, email))[0]!;
    await page.request.get(`${MOCK}/__test/pay?number=${encodeURIComponent(mine.number)}&status=placed`);
    await page.getByRole("button", { name: /^Pay / }).click();
    await expect(page).toHaveURL(new RegExp(`/checkout/confirmation/${mine.number}`));
    await expect(page.getByTestId("order-gift-unavailable")).toContainText("A free gift was not available");
    await expect(page.getByTestId("order-gift-line")).toHaveCount(0);
  });

  test("a gift the seller cannot include is said in the cart as 'Gift unavailable' and the offer step still shows", async ({ page, context, baseURL }) => {
    const email = await newVerifiedUser(page, "offer-gift");
    await page.request.get(`${MOCK}/__test/offer-gift-unavailable?email=${encodeURIComponent(email)}`);
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("correct horse battery staple");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/account$/);
    await addPack(page, 0, 10);
    const offer = page.getByTestId("cart-offer");
    await expect(offer).toContainText("Gift unavailable: Card wallet");
    await expect(offer).not.toContainText("Free gift included");
    await expect(offer).toContainText("Add 10 more for $0.90 each");
    await expect(page.getByTestId("cart-subtotal")).toHaveText("$9.50");             // the discount is unaffected: only the gift is out
    await axeBothThemes(page, context, baseURL!, "/cart with an unavailable gift");
  });
});
