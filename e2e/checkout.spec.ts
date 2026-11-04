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
const fillDetails = async (page: Page) => {
  await page.getByLabel("Email").fill("guest-buyer@example.com");
  await page.getByLabel("Full name").fill("Dana Guest");
  await page.getByLabel("Street address").fill("1 Main St");
  await page.getByLabel("City").fill("Brooklyn");
  await page.getByLabel("State / region").fill("NY");
  await page.getByLabel("Postal code").fill("11201");
};

test.describe("checkout", () => {
  test("a guest goes from the cart to a paid confirmation with the fake Payment Element", async ({ page }) => {
    await addChallah(page);
    await page.goto("/checkout");
    await waitHydrated(page);
    await fillDetails(page);
    await page.getByRole("button", { name: "Continue to delivery" }).click();
    await expect(page.getByTestId("checkout-review")).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => v.id))).toEqual([]);
    await expect(page.getByTestId("checkout-total")).toBeVisible();
    await page.getByRole("button", { name: /^Place order and pay/ }).click();
    await expect(page.getByTestId("payment-step")).toBeVisible();
    await expect(page.getByLabel("Card number")).toBeVisible();
    const orders = await (await page.request.get("http://localhost:5080/__test/checkout-orders")).json();
    const mine = orders.find((o: { guestEmail?: string }) => o.guestEmail === "guest-buyer@example.com");
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
});
