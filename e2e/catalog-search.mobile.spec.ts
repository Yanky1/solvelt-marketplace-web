import { expect, test } from "@playwright/test";

test("results fit a phone: filters are folded away until asked for, no sideways scrolling, big targets", async ({ page }) => {
  await page.goto("/search?q=challah");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const facets = page.locator("details.facets");
  await expect(facets).not.toHaveAttribute("open", "");
  await expect(page.getByRole("checkbox", { name: /In stock only/ })).toBeHidden();
  await facets.locator("summary").click();
  const box = page.getByRole("checkbox", { name: /In stock only/ });
  await expect(box).toBeVisible();
  const row = await box.locator("xpath=ancestor::label").boundingBox();
  expect(row!.height).toBeGreaterThanOrEqual(44);
  await box.check();
  await expect(page).toHaveURL(/available=true/);
  await expect(page.locator("#results-heading")).toHaveText("1 result");
  const cards = await page.locator(".listing-grid > li").count();
  expect(cards).toBe(1);
  const sort = await page.getByRole("combobox", { name: /Sort by/ }).boundingBox();
  expect(sort!.height).toBeGreaterThanOrEqual(44);
});

test("two cards sit side by side on a phone", async ({ page }) => {
  await page.goto("/c/gifts");
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
  const [a, b] = await page.evaluate(() => [...document.querySelectorAll(".listing-grid > li")].slice(0, 2).map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; }));
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);          // one row
  expect(b!.x).toBeGreaterThan(a!.x);
});
