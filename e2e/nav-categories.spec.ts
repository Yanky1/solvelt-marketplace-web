import { expect, test } from "@playwright/test";

/**
 * W3 item 3 (DESIGN W3-03): a category row under the top bar lists the catalog's TOP-LEVEL categories, in the portal's order, rendered on the server (the mock's order: Food & Drink,
 * Home & Judaica, Services, Gifts). The top bar keeps Categories and Brands (Services is a category, so it is not shown twice); the mobile menu lists everything.
 */
const TOP = ["Food & Drink", "Home & Judaica", "Services", "Gifts"];

test("the header lists the top-level categories in the portal's order, in the server-rendered HTML", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const links = (label: string) => {
    const nav = new RegExp(`<nav[^>]*aria-label="${label}"[^>]*>([\\s\\S]*?)</nav>`).exec(html)?.[1] ?? "";
    return [...nav.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]!.replace(/&amp;/g, "&")]);
  };
  expect(links("Shop by category")).toEqual([["/c/food-drink", "Food & Drink"], ["/c/home-judaica", "Home & Judaica"], ["/c/services", "Services"], ["/c/gifts", "Gifts"]]);
  expect(links("Main")).toEqual([["/categories", "Categories"], ["/brands", "Brands"]]);   // Services is a category: not twice
});

test("on a wide screen the category row fits without scrolling the page", async ({ page, isMobile }) => {
  test.skip(isMobile, "the row is for wide screens");
  for (const width of [1280, 1024, 900]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Shop by category" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `width ${width}`).toBe(true);
  }
});

test("a category link opens that category", async ({ page, isMobile }) => {
  test.skip(isMobile, "the desktop bar; the mobile menu has its own test");
  await page.goto("/");
  await page.getByRole("navigation", { name: "Shop by category" }).getByRole("link", { name: "Home & Judaica" }).click();
  await expect(page).toHaveURL(/\/c\/home-judaica$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Home & Judaica");
});

test("the mobile menu lists every top-level category, then Categories and Brands, and the row is hidden", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the drawer is the mobile header");
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Shop by category" })).toBeHidden();
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("navigation", { name: "Mobile" });
  await expect(menu.getByRole("link")).toHaveText([...TOP, "Categories", "Brands"]);
  await menu.getByRole("link", { name: "Gifts" }).click();
  await expect(page).toHaveURL(/\/c\/gifts$/);
});
