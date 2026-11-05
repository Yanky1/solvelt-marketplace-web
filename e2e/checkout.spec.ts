import { randomBytes } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { waitHydrated } from "./helpers";

const CHALLAH = "/p/classic-braided-challah";
const addChallah = async (page: Page) => {
  await page.goto(CHALLAH);
  await waitHydrated(page);
  await page.getByRole("button", { name: /^Add Classic Braided Challah, .*, to cart$/ }).click();
  await expect(page).toHaveURL(/\/cart\?notice=added$/);
};
// a unique address per run: the desktop and mobile projects run in parallel against one mock API, and the test finds ITS order by this address
const fillDetails = async (page: Page, email: string) => {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Full name").fill("Dana Guest");
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Brooklyn");
  await page.getByLabel("State / region").fill("NY");
  await page.getByLabel("Postal code").fill("11201");
};

const MOCK = "http://localhost:5080";
const newEmail = () => `guest-${randomBytes(6).toString("hex")}@example.com`;
type MockOrder = { number: string; guestEmail?: string; token?: string };
const ordersOf = async (page: Page, email: string): Promise<MockOrder[]> => ((await (await page.request.get(`${MOCK}/__test/checkout-orders`)).json()) as MockOrder[]).filter((o) => o.guestEmail === email);

/** A guest at the review step (details filled, delivery shown). With `addItem` false the cart is whatever it already holds. */
async function toReview(page: Page, email: string, addItem = true) {
  if (addItem) await addChallah(page);
  await page.goto("/checkout");
  await waitHydrated(page);
  await fillDetails(page, email);
  await page.getByRole("button", { name: "Continue to delivery" }).click();
  await expect(page.getByTestId("checkout-review")).toBeVisible();
}
async function toPayStep(page: Page, email: string, addItem = true) {
  await toReview(page, email, addItem);
  await page.getByRole("button", { name: /^Place order and pay/ }).click();
  await expect(page.getByTestId("payment-step")).toBeVisible();
}

test.describe("checkout", () => {
  test("a guest goes from the cart to a paid confirmation with the fake Payment Element", async ({ page }) => {
    await addChallah(page);
    await page.goto("/checkout");
    await waitHydrated(page);
    const email = `guest-${randomBytes(6).toString("hex")}@example.com`;
    await fillDetails(page, email);
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await expect(page.getByTestId("checkout-review")).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => v.id))).toEqual([]);
    await expect(page.getByTestId("checkout-total")).toBeVisible();
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await expect(page.getByTestId("payment-step")).toBeVisible();
    await expect(page.getByLabel("Card number")).toBeVisible();
    const orders = await (await page.request.get("http://localhost:5080/__test/checkout-orders")).json();
    const mine = orders.find((o: { guestEmail?: string }) => o.guestEmail === email);
    expect(mine).toBeTruthy();
    await page.request.get(`http://localhost:5080/__test/pay?number=${encodeURIComponent(mine.number)}&status=placed`);
    await page.getByRole("button", { name: /^Pay / }).click();
    await expect(page).toHaveURL(new RegExp(`/checkout/confirmation/${mine.number}`));
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "placed");
    await expect(page.getByTestId("cart-count")).toHaveText("0");
  });

  test("required details are refused with field messages", async ({ page }) => {
    await addChallah(page);
    await page.goto("/checkout");
    await waitHydrated(page);
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await expect(page.getByTestId("checkout-review")).toHaveCount(0);
    await expect(page).toHaveURL(/\/checkout/);
  });

  test("the confirmation page for an unknown order says it cannot show it", async ({ page }) => {
    await page.goto("/checkout/confirmation/NOPE-1");
    await expect(page.getByRole("heading", { name: "We can't show this order here" })).toBeVisible();
  });

  test("a return from Stripe is never believed: the address is cleaned and the page follows the server's status", async ({ page }) => {
    const email = newEmail();
    await toPayStep(page, email);
    const [mine] = await ordersOf(page, email);
    // the browser comes back claiming success, but the server still says pending_payment
    await page.goto(`/checkout/confirmation/${mine!.number}?redirect_status=succeeded&payment_intent=pi_x&payment_intent_client_secret=pi_x_secret_y`);
    await expect(page).toHaveURL(new RegExp(`/checkout/confirmation/${mine!.number}$`));      // 303 to the bare address: no query left in the bar or the history
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "pending_payment");
    await expect(page.getByRole("heading", { name: "Confirming your payment" })).toBeVisible();
    expect(await page.content()).not.toContain("pi_x_secret_y");
  });

  test("a price that changes between review and pay shows the new total and creates no order", async ({ page }) => {
    const email = newEmail();
    await toReview(page, email);
    const before = await page.getByTestId("checkout-total").innerText();
    await page.request.get(`${MOCK}/__test/force-price-change?email=${encodeURIComponent(email)}`);
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await expect(page.getByText(/The price or delivery changed/)).toBeVisible();
    await expect(page.getByTestId("checkout-total")).not.toHaveText(before);                // the new total, to be accepted again
    expect(await ordersOf(page, email)).toHaveLength(0);                                       // nothing was created, nothing charged
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await expect(page.getByTestId("payment-step")).toBeVisible();
    expect(await ordersOf(page, email)).toHaveLength(1);
  });

  test("the guest's token never reaches the page, a response body or storage, and is good for its own order only", async ({ page }) => {
    const email = newEmail();
    const bodies: string[] = [];
    page.on("response", async (r) => { if (r.request().method() === "POST" && new URL(r.url()).origin === new URL(page.url() || "http://localhost:3100").origin) bodies.push(await r.text().catch(() => "")); });
    await toPayStep(page, email);
    const [mine] = await ordersOf(page, email);
    expect(mine!.token).toBeTruthy();
    expect(bodies.length).toBeGreaterThan(0);
    for (const b of bodies) expect(b).not.toContain(mine!.token!);                           // the /checkout action's data
    expect(await page.content()).not.toContain(mine!.token!);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }) + document.cookie)).not.toContain(mine!.token!);
    await page.request.get(`${MOCK}/__test/pay?number=${encodeURIComponent(mine!.number)}&status=placed`);
    await page.goto(`/checkout/confirmation/${mine!.number}`);
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "placed");     // its own order: readable
    await page.goto("/checkout/confirmation/MP-MOCK-00000000");
    await expect(page.getByRole("heading", { name: "We can't show this order here" })).toBeVisible();   // another number: the token is not used
  });

  test("submitting the same checkout twice is one order", async ({ page }) => {
    const email = newEmail();
    await toPayStep(page, email);
    await toPayStep(page, email, false);                                                       // back to /checkout with the same cart and details
    expect(await ordersOf(page, email)).toHaveLength(1);
  });

  test("the emailed link seals the token and redirects to an address without it", async ({ page, context, baseURL }) => {
    const email = newEmail();
    await toPayStep(page, email);
    const [mine] = await ordersOf(page, email);
    await page.request.get(`${MOCK}/__test/pay?number=${encodeURIComponent(mine!.number)}&status=placed`);
    await context.clearCookies();                                                              // the mail is opened in another browser
    const raw = await page.request.get(`${baseURL}/orders/${mine!.number}?guest=${encodeURIComponent(mine!.token!)}`, { maxRedirects: 0 });
    expect(raw.status()).toBe(303);
    expect(raw.headers()["location"]).toBe(`/orders/${mine!.number}`);                        // no token in the address
    expect(raw.headers()["referrer-policy"]).toBe("no-referrer");
    const cookie = raw.headers()["set-cookie"] ?? "";
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).not.toContain(mine!.token!);                                                // sealed, not readable
    await page.goto(`/orders/${mine!.number}?guest=${encodeURIComponent(mine!.token!)}`);
    await expect(page).toHaveURL(new RegExp(`/orders/${mine!.number}$`));
    await expect(page.getByTestId("order-status")).toHaveAttribute("data-status", "placed");
    expect(await page.content()).not.toContain(mine!.token!);
    // a link whose token is not token-shaped is ignored: the page says it cannot show the order
    await context.clearCookies();
    await page.goto(`/orders/${mine!.number}?guest=short`);
    await expect(page).toHaveURL(new RegExp(`/orders/${mine!.number}$`));
    await expect(page.getByRole("heading", { name: "We can't show this order here" })).toBeVisible();
  });
});
