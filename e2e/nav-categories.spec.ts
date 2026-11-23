import { expect, test } from "@playwright/test";

/**
 * W3 item 3 (DESIGN W3-03): the header's links come from the catalog's TOP-LEVEL categories, in the portal's order, rendered on the server (the mock's order: Food & Drink, Home & Judaica,
 * Services, Gifts). A fixed link a category already names (Services) is not shown twice; Categories and Brands stay.
 */
const TOP = ["Food & Drink", "Home & Judaica", "Services", "Gifts"];

test("the header lists the top-level categories in the portal's order, in the server-rendered HTML", async ({ request }) => {
  const html = await (await request.get("/")).text();
  const nav = /<nav[^>]*aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";
  const labels = [...nav.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], m[2]!.replace(/&amp;/g, "&")]);
  expect(labels).toEqual([
    ["/c/food-drink", "Food & Drink"], ["/c/home-judaica", "Home & Judaica"], ["/c/services", "Services"], ["/c/gifts", "Gifts"],
    ["/categories", "Categories"], ["/brands", "Brands"],
  ]);
});

test("a category link opens that category", async ({ page, isMobile }) => {
  test.skip(isMobile, "the desktop bar; the mobile menu has its own test");
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home & Judaica" }).click();
  await expect(page).toHaveURL(/\/c\/home-judaica$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Home & Judaica");
});

test("the mobile menu lists every top-level category, then Categories and Brands", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the drawer is the mobile header");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  const menu = page.getByRole("navigation", { name: "Mobile" });
  await expect(menu.getByRole("link")).toHaveText([...TOP, "Categories", "Brands"]);
  await menu.getByRole("link", { name: "Gifts" }).click();
  await expect(page).toHaveURL(/\/c\/gifts$/);
});
