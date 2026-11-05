import AxeBuilder from "@axe-core/playwright";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { PASSWORD, signIn, signUp, uniqueEmail, verifyEmail } from "./helpers";
import { gid } from "./mock-catalog.mjs";

const CHALLAH = "/p/classic-braided-challah";
const v = (slug: string, i: number) => gid(`v:${slug}:${i}`);

test.describe("product page", () => {
  test("a description is plain text: HTML and Markdown in it are shown as typed and nothing runs", async ({ page }) => {
    await page.goto("/p/silver-plated-shabbat-candlesticks");
    const text = page.locator("main");
    await expect(text).toContainText("**Not bold** [not a link](https://example.test) <b>not bold either</b><img src=x onerror=\"window.__xss=1\"><script>window.__xss=1</script>");
    await expect(page.locator("main b, main strong, main a[href='https://example.test'], main img[src='x']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  });

  test("shows the product with price, stock, kosher info, delivery, details and questions", async ({ page }) => {
    await page.goto(CHALLAH);
    await expect(page.getByRole("heading", { level: 1, name: "Classic Braided Challah" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Challah Corner" })).toHaveAttribute("href", "/b/challah-corner");
    await expect(page.getByRole("link", { name: "Mazel Bakery" })).toHaveAttribute("href", /^\/s\//);
    // the first variant that can be bought: Small, reduced from $7.50
    const price = page.locator(".pdp-price");
    await expect(price).toContainText("$6.50");
    await expect(price).toContainText("$7.50");
    await expect(price).toContainText("In stock");
    await expect(page.getByRole("list", { name: "Kosher information" })).toContainText("Kosher: OU");
    await expect(page.getByRole("list", { name: "Delivery options" })).toContainText("Ships to you");
    await expect(page.getByRole("list", { name: "Delivery options" })).toContainText("Local delivery");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Food & Drink");
    await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Bakery" })).toHaveAttribute("href", "/c/bakery");
    // specs list the seller's attributes except kosher and delivery (they have their own places)
    await expect(page.locator(".specs")).toContainText("Weight");
    await expect(page.locator(".specs")).not.toContainText("Kosher");
    await expect(page.locator(".specs")).not.toContainText("Delivery");
    const faq = page.getByText("Is this kosher?");
    await faq.click();
    await expect(page.getByText("certified by OU")).toBeVisible();
  });

  test("the add-to-cart slot is a real form with a quantity and the CSRF token (the cart exists now, decision M3W-01)", async ({ page }) => {
    await page.goto(CHALLAH);
    const slot = page.getByTestId("add-to-cart-slot");
    await expect(slot.getByRole("button", { name: /^Add Classic Braided Challah, .*, to cart$/ })).toBeEnabled();
    await expect(slot.getByLabel("Quantity")).toHaveValue("1");
    await expect(slot).toHaveAttribute("action", "/cart/items");
    await expect(slot.locator('input[name="csrf"]')).toHaveCount(1);
    await expect(slot).not.toContainText("The cart opens soon");
  });

  test("has a title, description, canonical, Open Graph and Twitter tags, and is indexable", async ({ page, baseURL }) => {
    await page.goto(`${CHALLAH}?variant=${v("classic-braided-challah", 1)}`);
    await expect(page).toHaveTitle("Classic Braided Challah | Solvelt");
    const meta = (sel: string) => page.locator(`head ${sel}`).first().getAttribute("content");
    expect(await meta('meta[name="description"]')).toBe("Hand-braided, baked fresh every Thursday.");
    await expect(page.locator('head link[rel="canonical"]')).toHaveAttribute("href", `${baseURL}${CHALLAH}`);      // the variant is not part of the canonical address
    expect(await meta('meta[property="og:type"]')).toBe("product");
    expect(await meta('meta[property="og:title"]')).toBe("Classic Braided Challah | Solvelt");
    expect(await meta('meta[property="og:url"]')).toBe(`${baseURL}${CHALLAH}`);
    expect(await meta('meta[property="og:image"]')).toBe(`${baseURL}/img/${gid("i:classic-braided-challah:0")}?w=1200`);
    expect(await meta('meta[property="product:price:amount"]')).toBe("6.50");
    expect(await meta('meta[name="twitter:card"]')).toBe("summary_large_image");
    await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
  });

  test("has Product and BreadcrumbList structured data that match the page", async ({ page, baseURL }) => {
    await page.goto(CHALLAH);
    const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(blocks).toHaveLength(2);
    const [product, crumbs] = blocks.map((b) => JSON.parse(b));
    expect(product["@type"]).toBe("Product");
    expect(product.name).toBe("Classic Braided Challah");
    expect(product.offers.map((o: { name: string; price: string; availability: string }) => [o.name, o.price, o.availability.split("/").pop()])).toEqual([
      ["Small", "6.50", "InStock"], ["Large", "9.50", "InStock"], ["Extra large", "12.50", "OutOfStock"],
    ]);
    expect(product.brand.name).toBe("Challah Corner");
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Home", "Food & Drink", "Bakery", "Classic Braided Challah"]);
    expect(crumbs.itemListElement.at(-1).item).toBe(`${baseURL}${CHALLAH}`);
  });

  test("a service is a Service, asks where the visitor is before offering times, and says how it is offered", async ({ page }) => {
    await page.goto("/p/deep-house-cleaning");
    await expect(page.getByTestId("booking-slot")).toContainText("Your postal code");
    await expect(page.getByTestId("booking-slot").getByRole("button", { name: "Show times" })).toBeVisible();
    await expect(page.getByTestId("booking-slot").getByRole("form", { name: /^Book / })).toHaveCount(0);   // nothing to submit before a time is chosen
    await expect(page.getByTestId("add-to-cart-slot")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "How this service is offered" })).toContainText("Comes to you");
    await expect(page.getByRole("heading", { name: "About this service" })).toBeVisible();
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent())!);
    expect(ld["@type"]).toBe("Service");
    expect(ld.provider.name).toBe("Hudson Home Services");
  });

  test("a sold-out listing says so and offers no cart button", async ({ page }) => {
    await page.goto("/p/sold-out-honey-cake");
    await expect(page.locator(".pdp-price")).toContainText("Sold out");
    await expect(page.getByTestId("add-to-cart-slot")).toHaveCount(0);
    await expect(page.getByText("Please check back later")).toBeVisible();
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent())!);
    expect(ld.offers[0].availability).toContain("OutOfStock");
  });
});

test.describe("variants", () => {
  test("choosing an option updates price and address without adding a history entry or scrolling", async ({ page }) => {
    await page.goto("/");
    await page.goto(CHALLAH);
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    const group = page.getByRole("group", { name: "Choose an option" });
    await expect(group.getByRole("radio", { name: /Small/ })).toBeChecked();
    await expect(group.getByRole("radio", { name: /Extra large/ })).toBeDisabled();
    await expect(group).toContainText("Sold out");
    await group.getByRole("radio", { name: /Large/ }).check();
    await expect(page).toHaveURL(new RegExp(`\\?variant=${v("classic-braided-challah", 1)}$`));
    await expect(page.locator(".pdp-price")).toContainText("$9.50");
    await expect(page.locator(".pdp-price")).toContainText("for Large");
    await expect(page.locator(".pdp-price")).not.toContainText("$7.50");
    await page.goBack();                                            // the choice replaced the entry: back leaves the page, not the choice
    await expect(page).toHaveURL(/\/$/);
  });

  test("the radios work from the keyboard", async ({ page }) => {
    await page.goto(CHALLAH);
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    await page.getByRole("radio", { name: /Small/ }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".pdp-price")).toContainText("$9.50");
  });

  test("a sold-out option in the address shows as sold out, with no cart button", async ({ page }) => {
    await page.goto(`${CHALLAH}?variant=${v("classic-braided-challah", 2)}`);
    await expect(page.locator(".pdp-price")).toContainText("Sold out");
    await expect(page.getByTestId("add-to-cart-slot")).toHaveCount(0);
    await expect(page.getByText("Choose another option.")).toBeVisible();
  });

  test("an unknown variant in the address is ignored", async ({ page }) => {
    await page.goto(`${CHALLAH}?variant=nonsense`);
    await expect(page.locator(".pdp-price")).toContainText("$6.50");
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });
    test("the server renders the chosen option and a button to change it", async ({ page }) => {
      await page.goto(`${CHALLAH}?variant=${v("classic-braided-challah", 1)}`);
      await expect(page.locator(".pdp-price")).toContainText("$9.50");
      await expect(page.getByRole("radio", { name: /Large/ })).toBeChecked();
      await page.getByRole("radio", { name: /Small/ }).check({ force: true });
      await page.getByRole("button", { name: "Show price" }).click();
      await expect(page).toHaveURL(new RegExp(`\\?variant=${v("classic-braided-challah", 0)}$`));
      await expect(page.locator(".pdp-price")).toContainText("$6.50");
    });
  });
});

test.describe("gallery and images", () => {
  test("the main photo is the eager high-priority image; switching and zooming work", async ({ page }) => {
    await page.goto(CHALLAH);
    await page.waitForFunction(() => document.documentElement.dataset.hydrated === "true");
    const main = page.locator(".gallery-main img");
    await expect(main).toHaveAttribute("fetchpriority", "high");
    await expect(main).toHaveAttribute("loading", "eager");
    await expect(main).toHaveAttribute("alt", "Classic Braided Challah, photo 1");
    expect(await main.getAttribute("srcset")).toContain("1200w");
    await page.getByRole("button", { name: "Show photo 2 of 3" }).click();
    await expect(main).toHaveAttribute("alt", "Classic Braided Challah, photo 2");
    await page.getByRole("button", { name: "Zoom photo 2 of 3" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("img.gallery-zoom")).toBeVisible();
    await expect(dialog.locator("img.gallery-zoom")).toHaveAttribute("src", new RegExp(`/img/${gid("i:classic-braided-challah:1")}\\?w=1600`));
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("the image route serves a picture for a valid id and width and refuses anything else", async ({ request }) => {
    const id = gid("i:classic-braided-challah:0");
    const ok = await request.get(`/img/${id}?w=640&h=480`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toBe("image/jpeg");                                 // no Accept header for WebP: JPEG (the real resizer, see img.spec.ts)
    expect(ok.headers()["cache-control"]).toMatch(/public/);
    const m = await sharp(await ok.body()).metadata();
    expect([m.width, m.height]).toEqual([480, 480]);                                          // a square picture inside a 640 x 480 box: the box is a maximum, the shape is kept
    expect((await request.get(`/img/${id}?w=641&h=480`)).status()).toBe(400);              // only the served widths
    expect((await request.get(`/img/${id}?w=640&h=99999`)).status()).toBe(400);
    expect((await request.get(`/img/${id}`)).status()).toBe(400);
    expect((await request.get(`/img/not-a-guid?w=640`)).status()).toBe(404);
    expect((await request.get(`/img/..%2F..%2Fetc%2Fpasswd?w=640`)).status()).toBe(404);
  });
});

test.describe("redirects, gone and not found", () => {
  test("an id address redirects permanently to the slug and keeps the query", async ({ request }) => {
    const res = await request.get(`/p/${gid("l:classic-braided-challah")}?variant=x`, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toBe("/p/classic-braided-challah?variant=x");
  });

  test("a listing that is gone is a 410 page that tells engines not to index it", async ({ page }) => {
    const res = await page.goto("/p/retired-spice-gift-set");
    expect(res?.status()).toBe(410);
    await expect(page.getByRole("heading", { name: "This item is no longer available" })).toBeVisible();
    await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", "noindex");
    expect(res?.headers()["cache-control"]).toMatch(/no-store/);
  });

  test("an unknown listing is a 404 and a malformed address never reaches the API", async ({ page, request }) => {
    expect((await page.goto("/p/no-such-listing"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect((await request.get("/p/a%2Fb")).status()).toBe(404);
    expect((await request.get("/p/" + "a".repeat(200))).status()).toBe(404);
    expect((await request.get("/p/x%07y")).status()).toBe(404);
  });
});

test.describe("caching, privacy and the API boundary (W2-01, O-12)", () => {
  test("HTML is private and varies by cookie for visitors and signed-in users alike; the signed-in header is not in the anonymous page", async ({ page, request }) => {
    const anon = await request.get(CHALLAH);
    expect(anon.headers()["cache-control"]).toBe("private, no-cache");
    expect(anon.headers().vary).toMatch(/Cookie/i);
    expect(await anon.text()).not.toContain("Dana");

    const email = uniqueEmail("pdp");
    await signUp(page, email);
    await verifyEmail(page, email);
    await signIn(page, email);
    await page.waitForURL(/\/account/);
    const res = await page.goto(CHALLAH);
    expect(res?.headers()["cache-control"]).toBe("private, no-cache");
    expect(res?.headers().vary).toMatch(/Cookie/i);
    await expect(page.getByRole("link", { name: "Account of Dana Levi" })).toBeVisible();
    expect(PASSWORD.length).toBeGreaterThan(0);
  });

  test("the single-fetch data response is private too", async ({ request }) => {
    const res = await request.get(`${CHALLAH}.data`);
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toBe("private, no-cache");
    expect(res.headers().vary).toMatch(/Cookie/i);
  });

  test("the catalog call carries no session: a signed-in user's token never goes to a public page's API call", async ({ page, request }) => {
    const email = uniqueEmail("pdp-tok");
    await signUp(page, email);
    await verifyEmail(page, email);
    await signIn(page, email);
    await page.waitForURL(/\/account/);
    await page.goto("/p/deep-house-cleaning");
    const seen = (await (await request.get("http://localhost:5080/__test/seen")).json()) as { path: string; hasAuth: boolean }[];
    const catalogCalls = seen.filter((s) => s.path === "/api/v1/catalog/listings/deep-house-cleaning");
    expect(catalogCalls.length).toBeGreaterThan(0);
    expect(catalogCalls.every((c) => !c.hasAuth)).toBe(true);
  });

  test("the web server does not proxy the API: /api/* is not served", async ({ request }) => {
    for (const p of ["/api/v1/catalog/categories", "/api/v1/catalog/listings", "/api/admin/outbox", "/api/portal/webhooks", "/api/v1/account/me"]) {
      const res = await request.get(p);
      expect(res.status(), p).toBe(404);
      expect(res.headers()["content-type"] ?? "", p).not.toMatch(/application\/json/);
    }
  });
});

for (const theme of ["light", "dark"] as const) {
  for (const path of [CHALLAH, "/p/sold-out-honey-cake", "/p/deep-house-cleaning", "/p/retired-spice-gift-set", `${CHALLAH}?variant=${v("classic-braided-challah", 1)}`]) {
    test(`axe: ${path} (${theme})`, async ({ page, context, baseURL }) => {
      await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
      await page.goto(path);
      await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, JSON.stringify(results.violations.map((x) => ({ id: x.id, nodes: x.nodes.map((n) => n.target) })), null, 1)).toEqual([]);
    });
  }
}
