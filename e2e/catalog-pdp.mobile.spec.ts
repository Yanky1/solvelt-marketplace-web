import { expect, test } from "@playwright/test";

test("the product page fits a phone: no sideways scrolling, big enough targets, the cart slot reachable", async ({ page }) => {
  await page.goto("/p/classic-braided-challah");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const name of [/Small/, /Large/]) {
    const box = await page.getByRole("radio", { name }).locator("xpath=ancestor::label").boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByTestId("add-to-cart-slot")).toBeVisible();
  const main = await page.locator(".gallery-main img").boundingBox();
  expect(main!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});
