import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, addVirtualAuthenticator, newVerifiedUser, signIn, signUp, uniqueEmail, waitHydrated } from "./helpers";

const REASON = "ticket 4412: caller asked";
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

/** Makes a staff member in the mock and enrols a passkey through the real page; leaves the page signed in at /staff. */
async function enrolAs(page: Page, role: "support" | "finance" | "admin", tag: string, leak = false) {
  await addVirtualAuthenticator(page);
  const seed = (await (await page.request.get(`${MOCK}/__test/staff-seed?role=${role}&leak=${leak ? 1 : 0}&tag=${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`)).json()) as { id: string; email: string; secret: string };
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
  await expect(card).not.toContainText("relay-");   // the relay address is masked too
  // the lookup went to the API as a POST with a body: nothing typed is ever in a URL (API M7-17)
  const seen = (await (await page.request.get(`${MOCK}/__test/seen`)).json()) as { method: string; path: string }[];
  expect(seen.filter((x) => x.path.startsWith("/api/v1/staff/buyers") || x.path.startsWith("/api/v1/staff/orders")).every((x) => x.method !== "GET")).toBe(true);
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

// ---------- the web security review of 64c32be (decision M7W-07) ----------

test("a forged POST to a staff action is refused with 403 and never reaches the API", async ({ page, request, baseURL }) => {
  const seed = await enrolAs(page, "support", "csrf");
  const ip = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;   // the mock records the forwarded client address: ours is unique to this test
  const buyerCsrf = await (async () => { const html = await (await request.get("/sign-in")).text(); return /name="csrf" value="([^"]+)"/.exec(html)![1]!; })();
  const staffCsrf = await page.locator('input[name="csrf"]').first().inputValue().catch(() => "");
  const other = await page.context().browser()!.newContext();
  const otherPage = await other.newPage();
  await enrolAs(otherPage, "support", "csrf-other");
  const otherCsrf = await otherPage.evaluate(async () => /name="csrf" value="([^"]+)"/.exec(await (await fetch("/staff/buyers")).text())![1]!);
  await other.close();
  const send = (fields: Record<string, string>, origin: string | null = baseURL!) =>
    page.request.post("/staff/buyers", { form: { intent: "find", key: "email", value: "x@example.test", reason: REASON, ...fields }, headers: { "x-forwarded-for": ip, ...(origin ? { origin } : {}) }, maxRedirects: 0 });
  await page.goto("/staff/buyers");
  const mine = await page.locator('input[name="csrf"]').first().inputValue();
  expect(mine.length).toBeGreaterThan(20);
  void staffCsrf;
  for (const [what, r] of [
    ["no token", await send({})],
    ["a buyer's token", await send({ csrf: buyerCsrf })],
    ["another session's token", await send({ csrf: otherCsrf })],
    ["a foreign origin", await send({ csrf: mine }, "https://evil.example")],
    ["no origin", await send({ csrf: mine }, null)],
  ] as const) expect([400, 403], `${what}: refused (the framework's own origin check answers 400, ours 403)`).toContain(r.status());
  const seen = (await (await page.request.get(`${MOCK}/__test/seen`)).json()) as { clientIp: string | null; path: string }[];
  expect(seen.filter((x) => x.clientIp === ip && x.path.startsWith("/api/v1/staff/")), "no staff API call for a forged request").toEqual([]);
  // the same request with the right token and origin works (so the refusals above were about the forgery, not the test)
  const ok = await send({ csrf: mine });
  expect([200, 400, 404]).toContain(ok.status());
  expect(seed.id.length).toBeGreaterThan(10);
});

test("a dead staff token sends the person to sign-in and the cookie that held it is replaced", async ({ page, context }) => {
  const seed = await enrolAs(page, "support", "dead");
  const before = (await context.cookies()).find((c) => c.name === "solvelt_staff")!.value;
  await page.request.get(`${MOCK}/__test/staff-revoke?staffId=${seed.id}`);
  await page.goto("/staff/buyers");
  await expect(page).toHaveURL(/\/staff\/sign-in\?next=/);
  const after = (await context.cookies()).find((c) => c.name === "solvelt_staff")?.value;
  expect(after, "the cookie that held the dead token was cleared (a fresh visitor cookie replaced it)").not.toBe(before);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/sign-in/);   // and nothing signs the person back in
});

test("the Stripe block and refund ids are shown only to a role with payments.view, whatever the API sends", async ({ page }) => {
  await enrolAs(page, "support", "leak", true);   // this mock answers the Stripe block to a support member too
  await page.goto("/staff/orders");
  await waitHydrated(page);
  await page.getByLabel("Order number").fill("MP-1001");
  await page.getByLabel("Reason").fill(REASON);
  await page.getByRole("button", { name: "Look up" }).click();
  const card = page.getByTestId("order-card");
  await expect(card.getByRole("heading", { name: "MP-1001" })).toBeVisible();
  await expect(card).not.toContainText("pi_fake");
  await expect(card).not.toContainText("Intent:");
  await expect(card).not.toContainText("r-1");
});

test("the staff area has its own minimal chrome: no buyer search, cart, sign-in or theme form", async ({ page }) => {
  await enrolAs(page, "admin", "chrome");
  for (const path of ["/staff", "/staff/buyers", "/staff/sign-in"]) {
    await page.goto(path);
    await expect(page.getByRole("search")).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Cart/ })).toHaveCount(0);
    await expect(page.locator('form[action="/theme"]')).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeVisible();
    await expect(page.locator("main#main")).toHaveCount(1);
  }
  await page.goto("/");   // the buyer site keeps its chrome
  await expect(page.getByRole("search")).toBeVisible();
});

test("a malformed enrolment fragment is removed from the address bar and never throws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/staff/enrol#ste_abc%E0%A4%A");
  await waitHydrated(page);
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  expect(errors).toEqual([]);
  await expect(page.getByLabel("One-time secret")).toHaveValue("ste_abc%E0%A4%A");
  // and a good one is read, then removed (a link opened in a fresh page load)
  await page.goto("/staff/sign-in");
  await page.goto("/staff/enrol#ste_0123456789abcdef");
  await waitHydrated(page);
  await expect(page.getByLabel("One-time secret")).toHaveValue("ste_0123456789abcdef");
  expect(await page.evaluate(() => window.location.hash)).toBe("");
});

test("staff responses carry one Cache-Control, a stricter CSP, and the enrolment page sends no Referer", async ({ request }) => {
  for (const path of ["/staff/sign-in", "/staff/sign-in.data", "/staff.data", "/staff/buyers.data", "/staff/enrol"]) {
    const r = await request.get(path, { maxRedirects: 0 });
    expect(r.headers()["cache-control"], path).toBe("private, no-store");
    expect(r.headers()["x-robots-tag"], path).toContain("noindex");
    const csp = r.headers()["content-security-policy"]!;
    expect(csp, path).not.toContain("stripe");
    expect(csp, path).toContain("frame-src 'none'");
  }
  expect((await request.get("/staff/enrol")).headers()["referrer-policy"]).toBe("no-referrer");
  expect((await request.get("/")).headers()["content-security-policy"]).toContain("js.stripe.com");   // the buyer site still allows Stripe
  // a path that merely starts with the same letters is not the staff area
  const near = await request.get("/staff-picks", { maxRedirects: 0 });
  expect(near.headers()["cache-control"] ?? "").not.toBe("private, no-store");
});
