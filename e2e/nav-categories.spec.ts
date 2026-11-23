import AxeBuilder from "@axe-core/playwright";
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

test("the category row is reachable by keyboard, with a visible focus ring that the scroll box does not clip", async ({ page, isMobile }) => {
  test.skip(isMobile, "the row is for wide screens");
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/");
  const row = page.getByRole("navigation", { name: "Shop by category" });
  const first = row.getByRole("link").first();
  for (let i = 0; i < 40 && !(await first.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  const ring = await first.evaluate((el) => { const s = getComputedStyle(el); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), offset: parseFloat(s.outlineOffset) }; });
  expect(ring.style).not.toBe("none");
  expect(ring.width).toBeGreaterThan(0);
  // the ring's outer edge (width + offset) stays inside the row's scroll box, top and bottom
  const fits = await first.evaluate((el, extra) => { const box = el.parentElement!.getBoundingClientRect(), r = el.getBoundingClientRect(); return r.top - extra >= box.top - 0.5 && r.bottom + extra <= box.bottom + 0.5; }, ring.width + ring.offset);
  expect(fits).toBe(true);
  await page.keyboard.press("Tab");
  await expect(row.getByRole("link").nth(1)).toBeFocused();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: the category row (${theme})`, async ({ page, context, baseURL, isMobile }) => {
    test.skip(isMobile, "the row is for wide screens");
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    await page.goto("/");
    await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
    await page.getByRole("navigation", { name: "Shop by category" }).getByRole("link").first().focus();
    const results = await new AxeBuilder({ page }).include(".catbar").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations.map((x) => ({ id: x.id, nodes: x.nodes.map((n) => n.target) })), null, 1)).toEqual([]);
  });
}
