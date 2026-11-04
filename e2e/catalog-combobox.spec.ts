import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const box = (page: import("@playwright/test").Page) => page.getByRole("combobox", { name: "Search Solvelt" });

test.describe("header search suggestions", () => {
  test("typing offers products, brands and categories; the keyboard picks one", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await box(page).fill("chal");
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(list.getByRole("option").first()).toContainText("Classic Braided Challah");
    await expect(box(page)).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowDown");
    await expect(box(page)).toHaveAttribute("aria-activedescendant", (await list.getByRole("option").first().getAttribute("id"))!);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/p\/classic-braided-challah$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Classic Braided Challah");
  });

  test("a click works, and Escape closes without losing the text", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await box(page).fill("bak");
    await expect(page.getByRole("option", { name: /Bakery/ })).toBeVisible();          // Escape closes an open list; with none open the browser's own "clear the field" would run
    await page.keyboard.press("Escape");
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
    await expect(box(page)).toHaveValue("bak");
    await box(page).fill("bake");
    await page.getByRole("option", { name: /Bakery/ }).click();
    await expect(page).toHaveURL(/\/c\/bakery$/);
  });

  test("Enter without choosing a suggestion searches, and the box then shows the search", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await box(page).fill("challah");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=challah$/);
    await expect(box(page)).toHaveValue("challah");
    await expect(page.locator("#results-heading")).toHaveText("2 results");
  });

  test("text that is too short, or matches nothing, offers nothing", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await box(page).fill("c");
    await page.waitForTimeout(400);
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
    await box(page).fill("zzzz");
    await page.waitForTimeout(400);
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("works without JavaScript: it is a plain search form", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await ctx.newPage();
    await page.goto("/");
    await page.getByRole("combobox", { name: "Search Solvelt" }).fill("challah");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?q=challah$/);
    await expect(page.locator("#results-heading")).toHaveText("2 results");
    await ctx.close();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the open list has no axe violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
      await box(page).fill("chal");
      await expect(page.getByRole("option").first()).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    });
  }

  test("the list fits the screen and its rows are big enough to tap", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
    await box(page).fill("chal");
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("option").first()).toBeVisible();
    const vp = page.viewportSize()!;
    const l = await list.boundingBox();
    expect(l!.x).toBeGreaterThanOrEqual(0);
    expect(l!.x + l!.width).toBeLessThanOrEqual(vp.width);
    const row = await list.getByRole("option").first().boundingBox();
    expect(row!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("the suggest route", () => {
  test("answers JSON that is never cached, and nothing for text that is too short", async ({ request }) => {
    const res = await request.get("/search/suggest?q=chal");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect((await res.json()).suggestions.map((s: { slug: string }) => s.slug)).toEqual(["classic-braided-challah", "challah-corner"]);
    const none = await request.get("/search/suggest?q=c");
    expect((await none.json()).suggestions).toEqual([]);
    expect((await (await request.get("/search/suggest")).json()).suggestions).toEqual([]);
  });

  test("cleans and bounds what it is given, and only reads", async ({ request }) => {
    const long = await request.get("/search/suggest?q=" + encodeURIComponent("x".repeat(5000)));
    expect(long.status()).toBe(200);
    expect((await long.json()).query.length).toBeLessThanOrEqual(100);
    const ctl = await request.get("/search/suggest?q=" + encodeURIComponent("ch\u0000al\u2028"));
    expect((await ctl.json()).query).toBe("ch al");
    const post = await request.post("/search/suggest", { data: { q: "chal" } });
    expect(post.status()).toBeGreaterThanOrEqual(400);
    expect(post.status()).toBeLessThan(500);
  });
});
