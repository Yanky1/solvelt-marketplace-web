import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, addVirtualAuthenticator, newVerifiedUser, signIn, signUp, uniqueEmail, waitHydrated } from "./helpers";

const REASON = "ticket 4412: caller asked";
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

/** Makes a staff member in the mock and enrols a passkey through the real page; leaves the page signed in at /staff. */
async function enrolAs(page: Page, role: "support" | "finance" | "admin", tag: string) {
  await addVirtualAuthenticator(page);
  const seed = (await (await page.request.get(`${MOCK}/__test/staff-seed?role=${role}&tag=${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)).json()) as { id: string; email: string; secret: string };
  await page.goto("/staff/enrol");
  await waitHydrated(page);
  await page.getByLabel("One-time secret").fill(seed.secret);
  await page.getByRole("button", { name: "Create my passkey" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await expect(page.getByRole("heading", { name: "Staff", exact: true })).toBeVisible();
  return seed;
}
const stale = (page: Page, staffId: string) => page.request.get(`${MOCK}/__test/staff-stale?staffId=${staffId}`);
const state = async (page: Page, staffId: string) => (await (await page.request.get(`${MOCK}/__test/staff-state?staffId=${staffId}`)).json()) as { audit: { action: string; reason: string; targetId: string | null }[] };

test("a member enrols a passkey with the one-time secret, is signed in, signs out and signs in again; the secret works once", async ({ page }) => {
  const seed = await enrolAs(page, "support", "enrol");
  await expect(page.getByText("support", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
  await waitHydrated(page);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  // the secret is used up
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/staff\/sign-in$/);
  await page.goto("/staff/enrol");
  await waitHydrated(page);
  await page.getByLabel("One-time secret").fill(seed.secret);
  await page.getByRole("button", { name: "Create my passkey" }).click();
  await expect(page.getByText(/invalid, used or expired/)).toBeVisible();
});

test("the staff area is never indexed or cached, and every page asks for sign-in first", async ({ page, request }) => {
  const r = await request.get("/staff/sign-in");
  expect(r.headers()["cache-control"]).toContain("no-store");
  expect(r.headers()["x-robots-tag"]).toContain("noindex");
  expect(await r.text()).toContain('content="noindex, nofollow"');
  expect(await (await request.get("/robots.txt")).text()).toContain("Disallow: /staff");
  for (const path of ["/staff", "/staff/buyers", "/staff/orders", "/staff/queues", "/staff/accounts", "/staff/audit"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/staff/sign-in\\?next=${encodeURIComponent(path).replace(/\//g, "%2F")}`));
  }
});

test("the staff session and the buyer session are separate: neither opens the other's pages", async ({ page }) => {
  const email = await newVerifiedUser(page, "sep");
  await signIn(page, email);
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto("/staff/buyers");
  await expect(page).toHaveURL(/\/staff\/sign-in/);       // a signed-in buyer is nobody here
  await enrolAs(page, "support", "sep");
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Hello, Dana Levi" })).toBeVisible();   // the buyer is still the buyer
  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name)).toEqual(expect.arrayContaining(["solvelt_staff", "solvelt_session"]));
  const staff = cookies.find((c) => c.name === "solvelt_staff")!;
  expect(staff.httpOnly).toBe(true);
  expect(staff.sameSite).toBe("Strict");
  // a staff-only browser is no buyer: clear the buyer cookie and /account asks for sign-in
  await page.context().clearCookies({ name: "solvelt_session" });
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "Staff", exact: true })).toBeVisible();
});

test("buyer lookup is masked, and the break-glass reveal sends a stale passkey check to confirm and then works", async ({ page }) => {
  const buyer = uniqueEmail("lookup");
  await signUp(page, buyer);   // through the real form: every API call the mock sees must carry the signed forwarding headers (auth.spec checks them all)
  const seed = await enrolAs(page, "support", "lookup");
  await page.goto("/staff/buyers");
  await waitHydrated(page);
  await page.getByLabel("Value").fill(buyer);
  await page.getByLabel("Reason").fill(REASON);
  await page.getByRole("button", { name: "Look up" }).click();
  const card = page.getByTestId("buyer-card");
  await expect(card.getByRole("heading", { name: "Dana L." })).toBeVisible();
  await expect(card).not.toContainText(buyer);
  expect((await axe(page)).violations).toEqual([]);
  // reveal: the passkey check is old, so the page sends the person to confirm first
  await stale(page, seed.id);
  await card.getByLabel("email").check();
  await card.getByLabel("Reason").nth(2).fill(REASON);
  await card.getByRole("button", { name: "Reveal" }).click();
  await expect(page).toHaveURL(/\/staff\/confirm\?next=%2Fstaff%2Fbuyers$/);
  await page.getByRole("button", { name: "Confirm with my passkey" }).click();
  await expect(page).toHaveURL(/\/staff\/buyers$/);
  await page.getByLabel("Value").fill(buyer);
  await page.getByLabel("Reason").first().fill(REASON);
  await page.getByRole("button", { name: "Look up" }).click();
  const card2 = page.getByTestId("buyer-card");
  await card2.getByLabel("email").check();
  await card2.getByLabel("Reason").nth(2).fill(REASON);
  await card2.getByRole("button", { name: "Reveal" }).click();
  await expect(page.getByTestId("revealed")).toContainText(buyer);
  const audit = (await state(page, seed.id)).audit.map((a) => a.action);
  expect(audit).toEqual(expect.arrayContaining(["buyer.lookup", "buyer.reveal", "staff.step_up"]));
  // lock
  await card2.getByLabel("Reason").nth(0).fill(REASON);
  await card2.getByRole("button", { name: "Lock this account" }).click();
  await expect(card2.getByRole("button", { name: "Unlock this account" })).toBeVisible();
});

test("a role sees only what it may: finance cannot reveal, support has no staff accounts page", async ({ page }) => {
  const buyer = uniqueEmail("fin");
  await signUp(page, buyer);   // through the real form: every API call the mock sees must carry the signed forwarding headers (auth.spec checks them all)
  await enrolAs(page, "finance", "fin");
  await expect(page.getByRole("link", { name: "Staff accounts" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Audit log" })).toHaveCount(0);
  await page.goto("/staff/buyers");
  await waitHydrated(page);
  await page.getByLabel("Value").fill(buyer);
  await page.getByLabel("Reason").fill(REASON);
  await page.getByRole("button", { name: "Look up" }).click();
  const card = page.getByTestId("buyer-card");
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: "Reveal" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Lock this account" })).toHaveCount(0);
  const denied = await page.goto("/staff/accounts");
  expect(denied?.status()).toBe(403);
});

test("an order: support sees no Stripe ids, finance sees them and retries a failed refund once", async ({ page, browser }) => {
  await enrolAs(page, "support", "ord");
  await page.goto("/staff/orders");
  await waitHydrated(page);
  await page.getByLabel("Order number").fill("MP-1001");
  await page.getByLabel("Reason").fill(REASON);
  await page.getByRole("button", { name: "Look up" }).click();
  const card = page.getByTestId("order-card");
  await expect(card.getByRole("heading", { name: "MP-1001" })).toBeVisible();
  await expect(card).not.toContainText("pi_fake");
  await expect(card.getByRole("button", { name: "Retry this refund" })).toHaveCount(0);
  const ctx = await browser.newContext();
  const fin = await ctx.newPage();
  await enrolAs(fin, "finance", "ord-fin");
  await fin.goto("/staff/orders");
  await waitHydrated(fin);
  await fin.getByLabel("Order number").fill("MP-1001");
  await fin.getByLabel("Reason").fill(REASON);
  await fin.getByRole("button", { name: "Look up" }).click();
  const fcard = fin.getByTestId("order-card");
  await expect(fcard).toContainText("pi_fake_000001");
  await expect(fcard).not.toContainText("Evergreen");
  await fcard.getByLabel("Reason").fill(REASON);
  await fcard.getByRole("button", { name: "Retry this refund" }).click();
  await expect(fin.getByText("Queued again.")).toBeVisible();
  await ctx.close();
});

test("queues: stuck orders, outbox, parked events and Stripe failures show by role, and an admin retries with a reason", async ({ page }) => {
  await enrolAs(page, "admin", "queues");
  await page.goto("/staff/queues");
  await expect(page.getByRole("link", { name: "Stuck orders" })).toBeVisible();
  await expect(page.getByText("MP-2002")).toBeVisible();
  await expect(page.getByText("invalid_shipping_speed")).toBeVisible();
  await page.getByRole("link", { name: "Outbox" }).click();
  await expect(page.getByText("Payloads are never shown.")).toBeVisible();
  await expect(page.getByRole("cell", { name: "dead" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Portal events" }).click();
  await expect(page.getByText("evt-parked-1")).toBeVisible();
  // a dead booking confirm needs a person: it is listed with its booking, the amount and what to do
  const confirm = page.getByRole("region", { name: "Dead booking confirms", exact: true });
  await expect(confirm.getByRole("rowheader", { name: /BK-7001/ })).toBeVisible();
  await expect(confirm).toContainText("$125.00");
  await expect(confirm).toContainText("needs a person");
  await expect(confirm).toContainText("confirm_unexpected_403");
  await confirm.getByText("What to do").click();
  await expect(confirm.getByText(/Stripe dashboard/)).toBeVisible();
  await waitHydrated(page);
  await confirm.getByText("Retry the confirm…").click();
  await confirm.getByLabel("Reason").fill(REASON);
  await confirm.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(confirm.getByText("Queued again.")).toBeVisible();
  await page.getByRole("link", { name: "Stripe failures" }).click();
  await expect(page.getByText("evt_a").first()).toBeVisible();
  await page.getByRole("link", { name: "Outbox" }).click();
  await waitHydrated(page);
  await page.getByText("Retry…").click();
  await page.getByLabel("Reason").fill(REASON);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Queued again.")).toBeVisible();
});

test("an admin adds a staff member: the one-time link is shown once, works once, and the audit log records it", async ({ page, browser }) => {
  const admin = await enrolAs(page, "admin", "adm");
  await page.goto("/staff/accounts");
  await waitHydrated(page);
  const email = `new-${Date.now()}@staff.example`;
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Name").fill("Newbie Staff");
  await page.locator("#reason-create").fill("ticket 77: new support hire");
  await page.getByRole("button", { name: "Create and get the link" }).click();
  const link = await page.getByTestId("enrol-link").locator("code").innerText();
  expect(link).toMatch(/\/staff\/enrol#ste_/);
  await page.goto("/staff/accounts");
  await expect(page.getByTestId("enrol-link")).toHaveCount(0);   // shown once, never again
  await expect(page.getByText(email)).toBeVisible();
  // the new member opens the link in their own browser
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await addVirtualAuthenticator(other);
  await other.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await waitHydrated(other);
  await other.getByRole("button", { name: "Create my passkey" }).click();
  await expect(other).toHaveURL(/\/staff$/);
  await expect(other.getByText("support", { exact: true }).first()).toBeVisible();
  await ctx.close();
  await page.goto("/staff/audit");
  await expect(page.getByRole("cell", { name: "staff.create" }).first()).toBeVisible();
  expect((await state(page, admin.id)).audit.some((a) => a.action === "staff.create" && a.reason === "ticket 77: new support hire")).toBe(true);
});

test("a reason that holds an email address is refused and nothing happens", async ({ page }) => {
  await enrolAs(page, "support", "reasons");
  await page.goto("/staff/buyers");
  await waitHydrated(page);
  await page.getByLabel("Value").fill("someone@example.test");
  await page.getByLabel("Reason").fill("caller dana@example.test asked");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByText(/Say why|no email address/i).first()).toBeVisible();
  await expect(page.getByTestId("buyer-card")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`the staff pages pass axe and can be photographed (${theme})`, async ({ page, context, baseURL }, info) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    await enrolAs(page, "admin", `axe-${theme}`);
    const shots = process.env.STAFF_SHOTS === "1";
    const form = info.project.name === "mobile" ? "mobile" : "desktop";
    for (const [name, path] of [["home", "/staff"], ["buyers", "/staff/buyers"], ["orders", "/staff/orders"], ["queues", "/staff/queues"], ["dead-letters", "/staff/queues?tab=dead-letters"], ["accounts", "/staff/accounts"], ["audit", "/staff/audit"]] as const) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const results = await axe(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${path}: no horizontal page scroll`).toBe(true);
      expect(results.violations, `${path}: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`).toEqual([]);
      if (shots) await page.screenshot({ path: `docs/screenshots/staff-${name}-${form}-${theme}.png`, fullPage: true });
    }
    await page.context().clearCookies({ name: "solvelt_staff" });
    await page.goto("/staff/sign-in");
    expect((await axe(page)).violations).toEqual([]);
    if (shots) await page.screenshot({ path: `docs/screenshots/staff-sign-in-${form}-${theme}.png`, fullPage: true });
  });
}
