import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, newVerifiedUser, signIn } from "./helpers";

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

async function seed(page: Page, email: string, status: "new" | "shipped" | "delivered") {
  const r = await page.request.get(`${MOCK}/__test/seed-order?email=${encodeURIComponent(email)}&status=${status}`);
  expect(r.ok()).toBeTruthy();
  return (await r.json()) as { number: string; sellerOrderNumber: string };
}

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  for (const path of ["/account/orders", "/account/orders/MP-1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  }
});

test("the list shows my orders with their status and links to the detail page", async ({ page }) => {
  const email = await signedIn(page, "olist");
  await page.goto("/account/orders");
  await expect(page.getByRole("heading", { name: "No orders yet" })).toBeVisible();
  const o = await seed(page, email, "shipped");
  await page.goto("/account/orders");
  const item = page.getByRole("listitem").filter({ hasText: o.number });
  await expect(item.getByText("Shipped", { exact: true })).toBeVisible();
  await expect(item.getByText("Classic challah and 1 more")).toBeVisible();
  await item.getByRole("link", { name: `Order ${o.number}` }).click();
  await expect(page.getByRole("heading", { name: `Order ${o.number}` })).toBeVisible();
});

test("an order that has not shipped can be cancelled (reason needed) and then shows the request", async ({ page }) => {
  const email = await signedIn(page, "ocancel");
  const o = await seed(page, email, "new");
  await page.goto(`/account/orders/${o.number}`);
  await page.getByText("Cancel this order").click();
  await page.getByRole("button", { name: "Request cancellation" }).click();
  await expect(page.getByText("Choose a reason.").first()).toBeVisible();
  await page.getByLabel("Why do you want to cancel?").selectOption("changed_mind");
  await page.getByRole("button", { name: "Request cancellation" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your cancellation request was sent to the seller." })).toBeVisible();
  await expect(page.getByText("Cancellation request:")).toBeVisible();
  await expect(page.getByText("Cancel this order")).toHaveCount(0);        // one open request per seller order
});

test("a shipped order shows tracking, can be confirmed once and can be returned within the shipped quantity", async ({ page }) => {
  const email = await signedIn(page, "oship");
  const o = await seed(page, email, "shipped");
  await page.goto(`/account/orders/${o.number}`);
  const track = page.getByRole("link", { name: "9400111" });
  await expect(track).toHaveAttribute("href", /^https:\/\/tools\.usps\.com\//);
  await expect(track).toHaveAttribute("rel", /noopener/);
  await page.getByText("Tracking history").click();
  await expect(page.getByText(/Departed facility, Brooklyn, NY/)).toBeVisible();

  await page.getByRole("button", { name: "I received this order" }).click();
  await expect(page.getByRole("status").filter({ hasText: "We told the seller you received it." })).toBeVisible();
  await expect(page.getByRole("button", { name: "I received this order" })).toHaveCount(0);

  await page.getByText("Return items", { exact: true }).click();
  await page.getByRole("button", { name: "Request return" }).click();                       // nothing chosen
  await expect(page.getByText("Choose at least one item and how many to return.").first()).toBeVisible();
  await page.getByLabel(/Classic challah.*how many/).fill("1");
  await page.getByLabel("Reason").selectOption("damaged");
  await page.getByRole("button", { name: "Request return" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your return request was sent to the seller." })).toBeVisible();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  // the form went out with an Idempotency-Key (one return however often it is sent)
  const seen = (await (await page.request.get(`${MOCK}/__test/seen`)).json()) as { path: string; idem: string | null }[];
  const ret = seen.filter((s) => s.path.endsWith("/return-requests") && s.path.includes(o.number) && "idem" in s);   // the mock records each call twice: once generically, once with the key
  expect(ret.length).toBe(1);
  expect(ret[0]!.idem).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  // a refreshed label link is shown as a link to the portal, with rel=noopener
  await page.getByRole("button", { name: "Get a new return label link" }).click();
  await expect(page.getByRole("link", { name: "Print your return label" })).toHaveAttribute("rel", /noopener/);
  // the second return asks for more than is left (1 of 2): the API refuses and the page says so
  await page.getByText("Return items", { exact: true }).click();
  await page.getByLabel(/Classic challah.*how many/).fill("2");
  await page.getByLabel("Reason").selectOption("damaged");
  await page.getByRole("button", { name: "Request return" }).click();
  await expect(page.getByText(/can no longer be returned in that quantity/)).toBeVisible();
});

test("proof-of-delivery images are served through our own address with nosniff and no caching", async ({ page }) => {
  const email = await signedIn(page, "oproof");
  const o = await seed(page, email, "delivered");
  await page.goto(`/account/orders/${o.number}`);
  const img = page.getByRole("img", { name: "Proof of delivery 1 of 1" });
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
  const src = (await img.getAttribute("src"))!;
  expect(src.startsWith(`/account/orders/${o.number}/proof/`)).toBeTruthy();
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["cache-control"]).toContain("no-store");
  expect(res.headers()["content-security-policy"]).toContain("default-src 'none'");
  await expect(page.getByText(/Delivered .*left at: front door/)).toBeVisible();
});

test("another buyer's order is a 404 and so is its proof image", async ({ page, browser }) => {
  const email = await signedIn(page, "oown");
  const o = await seed(page, email, "delivered");
  const ctx2 = await browser.newContext({ baseURL: page.url().split("/account")[0] });
  const page2 = await ctx2.newPage();
  await signedIn(page2, "oother");
  expect((await page2.goto(`/account/orders/${o.number}`))!.status()).toBe(404);
  expect((await page2.request.get(`/account/orders/${o.number}/proof/sh-${o.number}/0`)).status()).toBe(404);
  await ctx2.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: orders pages (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    const email = await signedIn(page, `oaxe${theme}`);
    const o = await seed(page, email, "delivered");
    const n = await seed(page, email, "new");
    for (const path of ["/account/orders", `/account/orders/${o.number}`, `/account/orders/${n.number}`]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      // open every disclosure so the forms are checked too
      for (const d of await page.locator("details").all()) await d.evaluate((el: HTMLDetailsElement) => { el.open = true; });
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, `${path}: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((x) => x.target) })))}`).toEqual([]);
    }
  });
}
