import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { newVerifiedUser, PASSWORD, signIn, signUp, uniqueEmail, waitHydrated } from "./helpers";

/**
 * Test mode (M9). These run against the demo pair of servers (web on 3101 started with NODE_ENV=test and DEMO_ENABLED, mock API on 5081 with MOCK_DEMO=1; see
 * playwright.config.ts), on desktop and mobile. The default pair (3100/5080) stays in normal mode and is used here to prove that nothing shows there.
 */
const DEMO_API = "http://localhost:5081";
const NORMAL = "http://localhost:3100";
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
async function noViolations(page: Page) {
  const results = await axe(page);
  expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), null, 1)).toEqual([]);
}

/** A verified, signed-in user of the demo servers: sign up through the form, verify through the test-only endpoint of the mock (the mail goes to the other mock's outbox). */
async function demoUser(page: Page, tag: string) {
  const email = uniqueEmail(tag);
  await signUp(page, email, "Dana Levi");
  const res = await page.request.post(`${DEMO_API}/api/v1/demo/verify`, { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(204);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

async function normalModePage(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: NORMAL });
  return { ctx, page: await ctx.newPage() };
}

test.describe("test mode is on (API and web agree)", () => {
  test("every page carries the TEST MODE badge", async ({ page }) => {
    for (const path of ["/", "/sign-in", "/search"]) {
      await page.goto(path);
      await expect(page.getByTestId("test-mode-badge"), path).toHaveText("TEST MODE");
    }
  });

  test("fill, look, remove with a confirmation, fill again", async ({ page }) => {
    await demoUser(page, "demo-flow");
    await expect(page.getByTestId("test-mode-badge")).toBeVisible();
    await page.getByRole("link", { name: "demo data" }).click();
    await expect(page).toHaveURL(/\/account\/demo$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demo data");
    await expect(page.getByRole("button", { name: "Fill with demo data" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Remove demo data" })).toHaveCount(0);       // nothing to remove yet
    await noViolations(page);

    await page.getByRole("button", { name: "Fill with demo data" }).click();
    await expect(page).toHaveURL(/\/account\/demo\?done=filled$/);
    await expect(page.locator("main").getByRole("status")).toContainText("Demo data added");
    const counts = page.getByLabel("What is in your account as demo data");
    await expect(counts.getByText("Orders")).toBeVisible();
    await expect(counts.locator("div", { hasText: "Orders" }).locator("dd")).toHaveText("3");
    await expect(counts.locator("div", { hasText: "Bookings" }).locator("dd")).toHaveText("2");
    await expect(page.getByRole("button", { name: "Fill with demo data" })).toHaveCount(0);   // a second press has nothing to do: the button is gone
    await noViolations(page);

    // the confirmation: it can be cancelled, and it says what stays
    await page.getByRole("link", { name: "Remove demo data" }).click();
    await expect(page).toHaveURL(/\/account\/demo\/remove$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Remove demo data?");
    await expect(page.getByText("Anything that is really yours stays exactly as it is.")).toBeVisible();
    await noViolations(page);
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/account\/demo$/);
    await expect(counts.locator("div", { hasText: "Orders" }).locator("dd")).toHaveText("3");   // cancelled: nothing was removed

    await page.getByRole("link", { name: "Remove demo data" }).click();
    await page.getByRole("button", { name: "Remove demo data" }).click();
    await expect(page).toHaveURL(/\/account\/demo\?done=removed$/);
    await expect(page.locator("main").getByRole("status")).toContainText("Demo data removed");
    await expect(counts.locator("div", { hasText: "Orders" }).locator("dd")).toHaveText("0");
    await expect(page.getByRole("button", { name: "Fill with demo data" })).toBeVisible();     // and it can be filled again
    await page.goto("/account/demo/remove");
    await expect(page).toHaveURL(/\/account\/demo$/);                                          // nothing to remove: back to the status page
  });

  test("an unknown notice key shows nothing", async ({ page }) => {
    await demoUser(page, "demo-notice");
    await page.goto("/account/demo?done=%3Cb%3Ehacked%3C%2Fb%3E");
    await expect(page.locator("main").getByRole("status")).toHaveCount(0);
  });

  test("the account page points at the demo data page only in test mode", async ({ page }) => {
    await demoUser(page, "demo-link");
    await expect(page.getByRole("link", { name: "demo data" })).toHaveAttribute("href", "/account/demo");
  });

  test("verify this account: an unverified account can skip the email step, with the password", async ({ page }) => {
    const email = uniqueEmail("demo-verify");
    await signUp(page, email, "Dana Levi");
    await signIn(page, email);
    await expect(page.getByText("Please verify your email address first")).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify this account and sign in" })).toBeVisible();
    await noViolations(page);
    // the wrong password gets the same answer as a wrong sign-in, and verifies nothing
    await page.getByLabel("Password").fill("not the password at all");
    await page.getByRole("button", { name: "Verify this account and sign in" }).click();
    await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
    await waitHydrated(page);
    // the right one verifies and signs in
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Verify this account and sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Hello");
  });

  test("the API's limit on fill is said with its wait, not shown as an error page (LOW-5)", async ({ page }) => {
    await demoUser(page, "demo-limitfill");
    await page.goto("/account/demo");
    await waitHydrated(page);
    await page.getByRole("button", { name: "Fill with demo data" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("Too many attempts. Please wait about 42 seconds and try again.");
    await expect(page).toHaveURL(/\/account\/demo$/);
    await expect(page.getByRole("button", { name: "Fill with demo data" })).toBeVisible();     // still there to try again
  });

  test("the API's limit on remove is said with its wait on the confirmation page (LOW-5)", async ({ page }) => {
    await demoUser(page, "demo-limitremove");
    await page.goto("/account/demo");
    await waitHydrated(page);
    await page.getByRole("button", { name: "Fill with demo data" }).click();
    await expect(page).toHaveURL(/done=filled$/);
    await page.goto("/account/demo/remove");
    await waitHydrated(page);
    await page.getByRole("button", { name: "Remove demo data" }).click();
    await expect(page.locator("main").getByRole("alert")).toContainText("about 42 seconds");
    await expect(page).toHaveURL(/\/account\/demo\/remove$/);
  });

  test("verify this account when the API has switched test mode off since the page was drawn: it says so and keeps the verify prompt (LOW-5)", async ({ page }) => {
    const email = uniqueEmail("demooff");
    await signUp(page, email, "Dana Levi");
    await signIn(page, email);
    await expect(page.getByRole("button", { name: "Verify this account and sign in" })).toBeVisible();
    await waitHydrated(page);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Verify this account and sign in" }).click();
    await expect(page.getByText("Test mode is switched off, so this account cannot be verified without email.")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText("We could not sign you in right now")).toHaveCount(0);
  });

  test("a listing the portal marks as demo wears a Demo pill on its card and its page, and no other does", async ({ page }) => {
    await page.goto("/search?q=challah");
    const demoCard = page.locator(".listing-card", { hasText: "Classic Braided Challah" });
    await expect(demoCard.getByTestId("demo-pill")).toHaveText("Demo");
    await expect(page.locator(".listing-card", { hasText: "Whole Wheat Challah" }).getByTestId("demo-pill")).toHaveCount(0);
    await demoCard.getByRole("link").first().click();
    await expect(page.getByTestId("demo-pill")).toHaveText("Demo");
    await page.goto("/p/whole-wheat-challah");
    await expect(page.getByTestId("demo-pill")).toHaveCount(0);
  });

  test("the demo routes need a sign-in", async ({ page }) => {
    await page.goto("/account/demo");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fdemo$/);
    await page.goto("/account/demo/remove");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fdemo%2Fremove$/);
  });
});

test.describe("normal mode (the default servers): nothing of test mode shows", () => {
  test("no badge anywhere and no verify button for an unverified account", async ({ browser }) => {
    const { ctx, page } = await normalModePage(browser);
    try {
      for (const path of ["/", "/sign-in", "/search"]) {
        await page.goto(path);
        await expect(page.getByTestId("test-mode-badge"), path).toHaveCount(0);
      }
      const email = uniqueEmail("demo-off-unverified");
      await signUp(page, email, "Dana Levi");
      await signIn(page, email);
      await expect(page.getByText("Please verify your email address first")).toBeVisible();
      await expect(page.getByRole("button", { name: "Verify this account and sign in" })).toHaveCount(0);
    } finally { await ctx.close(); }
  });

  test("a signed-in user gets 404 for the demo pages and no link to them", async ({ browser }) => {
    const { ctx, page } = await normalModePage(browser);
    try {
      const email = await newVerifiedUser(page, "demo-off");
      await signIn(page, email);
      await expect(page).toHaveURL(/\/account$/);
      await expect(page.getByRole("link", { name: "demo data" })).toHaveCount(0);
      expect((await page.goto("/account/demo"))!.status()).toBe(404);
      expect((await page.goto("/account/demo/remove"))!.status()).toBe(404);
    } finally { await ctx.close(); }
  });

  test("the Demo pill belongs to the listing, not to test mode: it shows here too", async ({ browser }) => {
    const { ctx, page } = await normalModePage(browser);
    try {
      await page.goto("/search?q=challah");
      await expect(page.locator(".listing-card", { hasText: "Classic Braided Challah" }).getByTestId("demo-pill")).toHaveText("Demo");
    } finally { await ctx.close(); }
  });
});
