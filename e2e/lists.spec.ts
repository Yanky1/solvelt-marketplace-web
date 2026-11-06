import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { csrfFor, newVerifiedUser, signIn, waitHydrated } from "./helpers";

const A = "/p/classic-braided-challah";
const GUEST_KEY = "solvelt.user.recently-viewed";

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

async function saveToNewList(page: Page, name: string) {
  await page.goto(A);
  await waitHydrated(page);
  await page.getByText("Save to a list", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Create and save" })).toBeVisible();
  await page.getByLabel("New list").fill(name);
  await page.getByRole("button", { name: "Create and save" }).click();
  await expect(page.getByText(`${name} · Saved`)).toBeVisible();
}

test("a guest's recently viewed lives in this browser, and a guest is asked to sign in to save", async ({ page }) => {
  await page.goto(A);
  await waitHydrated(page);
  await page.getByText("Save to a list", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  expect(await page.evaluate((k) => sessionStorage.getItem(k), GUEST_KEY)).toContain("classic-braided-challah");
  await page.goto("/");
  await waitHydrated(page);
  const shelf = page.getByTestId("recently-viewed");
  await expect(shelf.getByRole("link", { name: /Classic Braided Challah/ })).toBeVisible();
  // only catalog data is kept: no name, email or token
  const raw = await page.evaluate((k) => sessionStorage.getItem(k) ?? "", GUEST_KEY);
  expect(raw).not.toMatch(/@|token|csrf/i);
});

test("signing in moves the guest's list into the account once and empties the browser copy", async ({ page }) => {
  await page.goto(A);
  await waitHydrated(page);
  await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), GUEST_KEY)).not.toBeNull();
  const email = await newVerifiedUser(page, "lmerge");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), GUEST_KEY)).toBeNull();
  await page.goto("/");
  await expect(page.getByTestId("recently-viewed").getByRole("link", { name: /Classic Braided Challah/ })).toBeVisible();
});

test("the sign-out button itself clears what this browser kept (the request is blocked, so no later check can do it)", async ({ page }) => {
  await signedIn(page, "lout");
  await page.goto(A);
  await waitHydrated(page);
  await page.evaluate((k) => sessionStorage.setItem(k, JSON.stringify([{ id: "x1", slug: "x", type: "product", title: "X", priceFromCents: 1, priceToCents: 1, currency: "USD", available: true, brandName: "", sellerName: "", image: null }])), GUEST_KEY);
  await page.goto("/account");
  await waitHydrated(page);
  await page.route("**/sign-out*", (route) => route.abort());   // the page stays, the user is still signed in: only the button's own handler can have cleared the key
  await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
  // the aborted request can make the page reload: a poll that lands in the middle of that retries (and the key is still gone afterwards: nothing but the button's handler cleared it)
  await expect.poll(async () => { try { return await page.evaluate((k) => sessionStorage.getItem(k), GUEST_KEY); } catch { return "navigating"; } }).toBeNull();
});

test("a different person signing in on the same browser does not inherit the previous guest's list", async ({ page }) => {
  await page.goto(A);
  await waitHydrated(page);
  await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k), GUEST_KEY)).not.toBeNull();
  const email = await newVerifiedUser(page, "lshared");
  await page.goto("/sign-in");
  await waitHydrated(page);
  // somebody else was signed in on this browser before (the marker names them), set right before this sign-in so only the order of the merge and the cleanup decides the outcome
  await page.evaluate(() => localStorage.setItem("solvelt.device.storage-owner", "someone-else"));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/");
  await waitHydrated(page);
  await expect(page.getByTestId("recently-viewed")).toHaveCount(0);
  const mine = await page.request.get("/recently-viewed");
  expect(((await mine.json()) as { items: unknown[] }).items).toEqual([]);
});

test("every wishlist and recently-viewed post is refused without a valid csrf token", async ({ page, baseURL }) => {
  await signedIn(page, "lcsrf");
  const csrf = await csrfFor(page.request, "/account/wishlists");
  const body = { intent: "add", listingId: "x1", wishlistId: "w1", name: "n", ids: "a" };
  for (const path of ["/wishlists/panel", "/recently-viewed", "/account/wishlists", "/account/wishlists/abc"]) {
    const post = (api: typeof page.request, form: Record<string, string>, origin?: string) => api.post(path, { form, headers: origin ? { origin } : {}, maxRedirects: 0 });
    expect((await post(page.request, body, baseURL!)).status(), `${path} no token`).toBe(403);
    expect((await post(page.request, { ...body, csrf: "forged" }, baseURL!)).status(), `${path} forged`).toBe(403);
    expect([400, 403], `${path} evil origin`).toContain((await post(page.request, { ...body, csrf }, "https://evil.example")).status());
    expect((await post(page.request, { ...body, csrf })).status(), `${path} no origin`).toBe(403);
  }
});

test("save a product to a new list, see it in the account, share it, view it anonymously, stop sharing", async ({ page, browser }) => {
  await signedIn(page, "lshare");
  await saveToNewList(page, "Gifts for Dad");
  await page.goto("/account/wishlists");
  await expect(page.getByRole("link", { name: "Gifts for Dad" })).toBeVisible();
  await expect(page.getByText("1 item · private")).toBeVisible();
  await page.getByRole("link", { name: "Gifts for Dad" }).click();
  await expect(page.getByRole("link", { name: "Classic Braided Challah" })).toBeVisible();

  await page.getByRole("button", { name: "Create a share link" }).click();
  const link = page.getByLabel("Share link");
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  expect(url).toMatch(/\/wishlists\/shared\/[A-Za-z0-9_-]{43}$/);
  await page.reload();
  await expect(page.getByLabel("Share link")).toHaveCount(0);   // shown once
  await expect(page.getByText("Anyone with the link can see this list")).toBeVisible();

  const anon = await browser.newContext();
  const ap = await anon.newPage();
  const r = await ap.goto(new URL(new URL(url).pathname, page.url()).toString());
  expect(r?.status()).toBe(200);
  expect(r?.headers()["x-robots-tag"]).toContain("noindex");
  expect(r?.headers()["referrer-policy"]).toMatch(/no-referrer$/);   // the last (strictest) value wins; the page also sets it in a meta tag
  await expect(ap.getByRole("heading", { name: "Gifts for Dad" })).toBeVisible();
  await expect(ap.getByRole("link", { name: /Classic Braided Challah/ })).toBeVisible();

  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByText("This list is private.")).toBeVisible();
  expect((await ap.goto(new URL(new URL(url).pathname, page.url()).toString()))?.status()).toBe(404);
  await anon.close();
});

test("a duplicate name is refused, and removing an item and deleting the list work", async ({ page }) => {
  await signedIn(page, "lown");
  await saveToNewList(page, "Mine");
  await page.goto("/account/wishlists");
  await page.getByLabel("New list").fill("mine");
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByText("You already have a list with that name.")).toBeVisible();
  await page.getByRole("link", { name: "Mine" }).click();
  await expect(page).toHaveURL(/\/account\/wishlists\/[a-f0-9]+$/);
  const listUrl = page.url();

  await page.getByRole("button", { name: /Remove Classic Braided Challah from Mine/ }).click();
  await expect(page.getByRole("heading", { name: "This list is empty" })).toBeVisible();
  await page.getByRole("button", { name: "Delete this list, Mine" }).click();
  await expect(page).toHaveURL(/\/account\/wishlists$/);
  expect((await page.goto(listUrl))?.status()).toBe(404);
});

test("another signed-in buyer gets a 404 for someone else's list", async ({ page, browser }) => {
  await signedIn(page, "lowner");
  await saveToNewList(page, "Private");
  await page.goto("/account/wishlists");
  await page.getByRole("link", { name: "Private" }).click();
  await expect(page).toHaveURL(/\/account\/wishlists\/[a-f0-9]+$/);
  const listUrl = page.url();
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const op = await other.newPage();
  const email = await newVerifiedUser(op, "lintruder");
  await signIn(op, email);
  await expect(op).toHaveURL(/\/account$/);
  expect((await op.goto(new URL(listUrl).pathname))?.status()).toBe(404);
  await other.close();
});

test("the delete-list button's accessible name starts with its visible text and axe's label-content-name-mismatch (WCAG 2.5.3) finds nothing on the list page (sweep issue #5)", async ({ page }) => {
  await signedIn(page, "ldelname");
  await saveToNewList(page, "Named list");
  await page.goto("/account/wishlists");
  await page.getByRole("link", { name: "Named list" }).click();
  const button = page.getByRole("button", { name: /^Delete this list/ });         // the visible words come first (voice control says "click Delete this list")
  await expect(button).toHaveText("Delete this list");
  await expect(button).toHaveAccessibleName("Delete this list, Named list");      // and the list's name stays as the context
  const results = await new AxeBuilder({ page }).withTags(["wcag21a"]).analyze();   // the tag the UI sweep ran: it holds label-content-name-mismatch
  expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: wishlist pages and the save box (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    await signedIn(page, `laxe${theme}`);
    await saveToNewList(page, "Axe list");
    const check = async () => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
    };
    await check();   // the product page with the box open
    await page.goto("/account/wishlists");
    await check();
    await page.getByRole("link", { name: "Axe list" }).click();
    await expect(page.getByRole("link", { name: "Classic Braided Challah" })).toBeVisible();
    await page.getByRole("button", { name: "Create a share link" }).click();
    const shareUrl = await page.getByLabel("Share link").inputValue();
    await check();                                              // the list page with its share link open
    await page.goto(new URL(shareUrl).pathname);
    await expect(page.getByRole("heading", { name: "Axe list" })).toBeVisible();
    await check();                                              // the public shared page
    await page.goto("/");
    await waitHydrated(page);
    await expect(page.getByTestId("recently-viewed")).toBeVisible();
    await check();                                              // the shelf
    await page.goto("/account/wishlists");
    await page.getByRole("link", { name: "Axe list" }).click();
    await page.getByRole("button", { name: /Remove Classic Braided Challah/ }).click();
    await expect(page.getByRole("heading", { name: "This list is empty" })).toBeVisible();
    await check();                                              // the empty list
    await page.getByRole("button", { name: "Delete this list, Axe list" }).click();
    await expect(page.getByRole("heading", { name: "No lists yet" })).toBeVisible();
    await check();                                              // the empty lists page
  });
}
