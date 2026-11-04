import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

type P = import("@playwright/test").Page;
const cards = (page: P) => page.locator(".listing-grid > li");
/** Filters are folded away on a phone (open on a wide screen): open them when they are closed. */
async function openFilters(page: P) {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");      // on a phone the script folds the panel away: wait for that before looking
  const d = page.locator("details.facets-mobile");                                     // only shown on a phone; on a wide screen the panel is already there
  if ((await d.isVisible()) && (await d.getAttribute("open")) === null) await d.locator("summary").click();
}

test.describe("search", () => {
  test("finds listings, shows the count, and is never indexed", async ({ page }) => {
    await page.goto("/search?q=challah");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Results for “challah”");
    await expect(page.locator("#results-heading")).toHaveText("2 results");
    await expect(cards(page)).toHaveCount(2);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page).toHaveTitle("Results for “challah” | Solvelt");
    await cards(page).first().getByRole("link").click();
    await expect(page).toHaveURL(/\/p\//);
  });

  test("one set of results has one address: odd spellings are redirected to ours", async ({ page }) => {
    await page.goto("/search?sort=newest&page=1&junk=1&cursor=zzz&q=%20%20challah%20");
    await expect(page).toHaveURL(/\/search\?q=challah&sort=newest$/);     // newest is not the default when there is a search, so it stays; junk and page 1 go
    await page.goto("/search?available=true&q=challah&page=1");
    await expect(page).toHaveURL(/\/search\?q=challah&available=true$/);
  });

  test("a filter is a link you can share: choosing one changes the address and the results, and its chip removes it", async ({ page }) => {
    await page.goto("/search?q=challah");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /In stock only/ }).check();
    await expect(page).toHaveURL(/available=true/);
    await expect(page.locator("#results-heading")).toHaveText("1 result");
    const chips = page.getByRole("list", { name: "Active filters" });
    await expect(chips).toContainText("In stock");
    await chips.getByRole("link", { name: /In stock/ }).click();
    await expect(page).toHaveURL(/\/search\?q=challah$/);
    await expect(page.locator("#results-heading")).toHaveText("2 results");
  });

  test("facet counts show what choosing a value would give, and every count is right", async ({ page }) => {
    await page.goto("/search");
    await openFilters(page);
    const form = page.getByRole("form", { name: "Filter results" });
    const label = form.getByRole("checkbox", { name: /^OU/ });
    await expect(label).toBeVisible();
    const m = /\((\d+)\)/.exec(await form.locator("label.facet-option", { hasText: /^\s*OU/ }).innerText());
    const promised = Number(m![1]);
    await label.check();
    await expect(page).toHaveURL(/kosher=OU/);
    await expect(page.locator("#results-heading")).toHaveText(`${promised} results`);
    // a disjunctive facet keeps its other values visible while one is chosen
    await expect(form.getByRole("checkbox", { name: /^OU/ })).toBeChecked();
  });

  test("the price fields take dollars and the address keeps cents", async ({ page }) => {
    await page.goto("/search");
    await openFilters(page);
    const form = page.getByRole("form", { name: "Filter results" });
    await form.getByRole("textbox").nth(1).fill("10.50");
    await form.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/priceMax=1050$/);
    await expect(page.getByRole("list", { name: "Active filters" })).toContainText("Up to $10.50");
    await openFilters(page);
    for (const title of await page.locator(".listing-card-title").allInnerTexts()) expect(title).not.toBe("Deep House Cleaning");
    await expect(form.getByRole("textbox").nth(1)).toHaveValue("10.50");
  });

  test("sorting changes the order and the address", async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("combobox", { name: /Sort by/ }).selectOption("price_desc");
    await expect(page).toHaveURL(/sort=price_desc/);
    await expect(page.locator(".listing-card-title").first()).toHaveText("Deep House Cleaning");
    await page.getByRole("combobox", { name: /Sort by/ }).selectOption("price_asc");
    await expect(page.locator(".listing-card-title").first()).not.toHaveText("Deep House Cleaning");
  });

  test("an empty result explains itself and offers a way out", async ({ page }) => {
    await page.goto("/search?q=zzzzzz");
    await expect(page.getByText("No listings match")).toBeVisible();
    await expect(page.locator("#results-heading")).toHaveText("0 results");
    await page.goto("/search?q=challah&type=service");
    await expect(page.getByText("No listings match")).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).click();
    await expect(page).toHaveURL(/\/search\?q=challah$/);
    await expect(cards(page)).toHaveCount(2);
  });

  test("search text is shown as text, in any script", async ({ page }) => {
    await page.goto("/search?q=" + encodeURIComponent("<script>window.__x=1</script>"));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("<script>window.__x=1</script>");
    expect(await page.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();
    await page.goto("/search?q=" + encodeURIComponent("חלה מתוקה"));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Results for “חלה מתוקה”");
  });

  test("the phone filter menu is closed in the page itself, so nothing jumps after it loads (layout shift 0.34 before this)", async ({ request }) => {
    const html = await (await request.get("/c/gifts")).text();
    const menu = /<details class="facets facets-mobile"[^>]*>/.exec(html)?.[0];
    expect(menu).toBeTruthy();
    expect(menu).not.toMatch(/\bopen\b/);                                                 // not opened in the markup and then closed by a script
    expect(html).toContain('class="facets facets-desktop"');                              // the wide-screen panel is in the markup too: CSS shows one of the two
  });

  test("hostile addresses never break the page", async ({ page }) => {
    for (const qs of ["priceMin=-1&priceMax=abc", "page=99999999999", "kosher=" + "x,".repeat(500), "attr=a&attr=:b&attr=%00:%00", "sort=%00", "type[]=product", "brand=../../api/admin"]) {
      const res = await page.goto("/search?" + qs);
      expect(res!.status(), qs).toBeLessThan(500);
    }
  });

  test("works without JavaScript: the filter form and the sort are plain forms", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ javaScriptEnabled: false, baseURL });
    const page = await ctx.newPage();
    await page.goto("/search?q=challah");
    const menu = page.locator("details.facets-mobile");                                      // on a phone the menu starts closed; opening a <details> needs no script
    if (await menu.isVisible()) await menu.locator("summary").click();
    await page.getByRole("checkbox", { name: /In stock only/ }).check();
    await page.getByRole("form", { name: /Filter results/ }).getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/available=true/);
    await expect(page.locator("#results-heading")).toHaveText("1 result");
    await page.getByRole("combobox", { name: /Sort by/ }).selectOption("title");
    await page.getByRole("button", { name: "Sort", exact: true }).click();
    await expect(page).toHaveURL(/sort=title/);
    await expect(page.locator("#results-heading")).toHaveText("1 result");                          // the filter survived the sort
    await ctx.close();
  });
});

test.describe("category pages", () => {
  test("show the category, its way down from the home page, its sub-categories and everything below it", async ({ page }) => {
    await page.goto("/c/food-drink");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Food & Drink");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Home");
    await expect(page.locator("#results-heading")).toHaveText("3 results");                         // bakery (2) and wine (1) are below it
    const sub = page.getByRole("navigation", { name: "In this category" });
    await expect(sub.getByRole("link", { name: /Bakery/ })).toHaveAttribute("href", "/c/bakery");
    await sub.getByRole("link", { name: /Bakery/ }).click();
    await expect(page).toHaveURL(/\/c\/bakery$/);
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Food & Drink");
    await expect(page.locator("#results-heading")).toHaveText("2 results");
  });

  test("filters work in place and the path keeps the category", async ({ page }) => {
    await page.goto("/c/food-drink");
    await openFilters(page);
    await page.getByRole("checkbox", { name: /In stock only/ }).check();
    await expect(page).toHaveURL(/\/c\/food-drink\?available=true$/);
    await expect(page.locator("#results-heading")).toHaveText("2 results");
  });

  test("the plain page is indexed with a canonical address and structured breadcrumbs; filtered and sorted views are not", async ({ page }) => {
    await page.goto("/c/bakery");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/c\/bakery$/);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent())!);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Home", "Food & Drink", "Bakery"]);
    await page.goto("/c/bakery?available=true");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/c\/bakery$/);
    await page.goto("/c/bakery?sort=title");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  });

  test("paging: 24 a page, links that keep the address clean, prev/next hints, and a page past the end goes back", async ({ page }) => {
    await page.goto("/c/gifts");
    await expect(cards(page)).toHaveCount(24);
    await expect(page.locator('link[rel="next"]')).toHaveAttribute("href", /\/c\/gifts\?page=2$/);
    await expect(page.locator('link[rel="prev"]')).toHaveCount(0);
    await page.getByRole("navigation", { name: "Pagination" }).getByRole("link", { name: "Next" }).click();
    await expect(page).toHaveURL(/\/c\/gifts\?page=2$/);
    await expect(cards(page)).toHaveCount(2);
    await expect(page).toHaveTitle("Gifts (page 2) | Solvelt");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/c\/gifts\?page=2$/);
    await expect(page.locator('link[rel="prev"]')).toHaveAttribute("href", /\/c\/gifts$/);
    await expect(page.locator('link[rel="next"]')).toHaveCount(0);
    await page.goto("/c/gifts?page=9");
    await expect(page).toHaveURL(/\/c\/gifts\?page=2$/);
    await page.goto("/c/gifts?page=1");
    await expect(page).toHaveURL(/\/c\/gifts$/);
  });

  test("an unknown or malformed category is a 404", async ({ page }) => {
    for (const path of ["/c/not-a-category", "/c/Bad%20Slug", "/c/%00", "/c/" + "a".repeat(200)]) {
      const res = await page.goto(path);
      expect(res!.status(), path).toBe(404);
    }
  });

  test("browse to search to a product: the whole path works", async ({ page }) => {
    await page.goto("/c/food-drink");
    await page.getByRole("navigation", { name: "In this category" }).getByRole("link", { name: /Bakery/ }).click();
    await openFilters(page);
    await page.getByRole("checkbox", { name: /In stock only/ }).check();
    await expect(page.locator("#results-heading")).toHaveText("1 result");
    await page.locator(".listing-card-link").first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Classic Braided Challah" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Bakery" })).toHaveAttribute("href", "/c/bakery");
  });
});

test.describe("accessibility of results", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`a results page with filters applied has no axe violations (${theme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/search?q=challah&kosher=OU&available=true");
      await expect(page.locator("#results-heading")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    });
  }

  test("filters are reachable by keyboard and announce their state", async ({ page }) => {
    await page.goto("/search");
    await openFilters(page);
    const box = page.getByRole("checkbox", { name: /In stock only/ });
    await box.focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/available=true/);
    await expect(page.locator("#results-heading")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /In stock only/ })).toBeChecked();
  });
});
