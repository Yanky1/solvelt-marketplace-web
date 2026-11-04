import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { csrfFor, MOCK, newVerifiedUser, PASSWORD, mailedToken, signIn, signUp, uniqueEmail, verifyEmail } from "./helpers";

// Tokens of one user only: tests run in parallel against one mock, so never look at (or revoke) other users' sessions.
const tokens = async (request: import("@playwright/test").APIRequestContext, email?: string) =>
  (await (await request.get(`${MOCK}/__test/tokens${email ? `?email=${encodeURIComponent(email)}` : ""}`)).json()) as string[];

test("sign up, verify email, sign in, see the account, sign out", async ({ page }) => {
  const email = await newVerifiedUser(page, "flow", "Dana Levi");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole("heading", { name: "Hello, Dana Levi" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account of Dana Levi" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
});

test("the API session token never reaches the browser (cookie value, HTML, .data, JS storage)", async ({ page, context, request }) => {
  const email = await newVerifiedUser(page, "leak");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const live = await tokens(request, email);
  expect(live.length).toBeGreaterThan(0);

  const cookies = await context.cookies();
  const session = cookies.find((c) => /solvelt_session$/.test(c.name));
  expect(session, "session cookie").toBeTruthy();
  expect(session!.httpOnly).toBe(true);
  expect(session!.sameSite).toBe("Lax");
  const html = await page.content();
  const data = await (await page.request.get("/account.data")).text();
  const visible = [html, data, JSON.stringify(cookies), await page.evaluate(() => document.cookie + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))].join("\n");
  for (const t of live) expect(visible).not.toContain(t);
  expect(await page.evaluate(() => document.cookie)).not.toContain("solvelt_session");
  expect(visible).not.toMatch(/tok_[0-9a-f]{16}/);
});

test("sign-in errors are generic, and unverified accounts are told to verify", async ({ page }) => {
  const email = uniqueEmail("generic");
  await signUp(page, email);
  await signIn(page, email);
  await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("verify your email");
  const unknown = await (async () => { await signIn(page, uniqueEmail("nobody")); return (await page.getByRole("group", { name: "There is a problem" }).textContent()) ?? ""; })();
  await verifyEmail(page, email);
  await signIn(page, email, "wrong password entirely");
  const wrong = (await page.getByRole("group", { name: "There is a problem" }).textContent()) ?? "";
  expect(wrong).toBe(unknown); // same message for an unknown address and a wrong password
  expect(wrong).toContain("Email or password is incorrect.");
});

test("client-side validation messages are tied to the fields", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Email")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Password")).toHaveAccessibleDescription(/12 characters/);
});

test("every mutating auth action rejects missing, forged and cross-site CSRF", async ({ request, baseURL }) => {
  const csrf = await csrfFor(request);
  const body = { email: "a@example.test", password: "x", displayName: "A", token: "t", scope: "all" };
  for (const path of ["/sign-in", "/sign-up", "/sign-out", "/verify-email", "/forgot-password", "/reset-password", "/theme"]) {
    const post = (form: Record<string, string>, origin: string) => request.post(path, { form, headers: { origin }, maxRedirects: 0 });
    expect((await post(body, baseURL!)).status(), `${path} no token`).toBe(403);
    expect((await post({ ...body, csrf: "forged" }, baseURL!)).status(), `${path} forged`).toBe(403);
    // React Router rejects a foreign Origin itself (400) before our action runs; our own check is the 403 backstop.
    expect([400, 403], `${path} evil origin`).toContain((await post({ ...body, csrf }, "https://evil.example")).status());
    expect((await request.post(path, { form: { ...body, csrf }, maxRedirects: 0 })).status(), `${path} no origin`).toBe(403);
  }
});

test("a CSRF token from another session is rejected", async ({ request, playwright, baseURL }) => {
  const other = await playwright.request.newContext({ baseURL });
  const foreign = await csrfFor(other);
  await csrfFor(request);
  const res = await request.post("/sign-out", { form: { csrf: foreign, scope: "this" }, headers: { origin: baseURL! }, maxRedirects: 0 });
  expect(res.status()).toBe(403);
  await other.dispose();
});

test("?next= is honoured for same-site paths only", async ({ page, baseURL }) => {
  const email = await newVerifiedUser(page, "next");
  for (const bad of ["//evil.example", "https://evil.example/x", "/\t/evil.example", "/\\evil.example"]) {
    await signIn(page, email, PASSWORD, `/sign-in?next=${encodeURIComponent(bad)}`);
    await expect(page).toHaveURL(/\/account$/);
    expect(new URL(page.url()).origin).toBe(baseURL);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  }
  await signIn(page, email, PASSWORD, `/sign-in?next=${encodeURIComponent("/account?tab=x")}`);
  await expect(page).toHaveURL(/\/account\?tab=x$/);
});

test("signed-in pages are private and uncacheable, and the API sees signed forwarding headers", async ({ page, request }) => {
  const email = await newVerifiedUser(page, "cache");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const res = await page.request.get("/account");
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  const seen = (await (await request.get(`${MOCK}/__test/seen`)).json()) as { forwardingOk: boolean; path: string; clientIp: string | null }[];
  const mine = seen.filter((s) => s.path.startsWith("/api/v1/"));
  expect(mine.length).toBeGreaterThan(0);
  expect(mine.every((s) => s.forwardingOk && s.clientIp)).toBe(true);
});

test("sign out revokes the API session, clears user storage and keeps the theme", async ({ page, request }) => {
  const email = await newVerifiedUser(page, "out");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.evaluate(() => { localStorage.setItem("solvelt.user.cart", "1"); sessionStorage.setItem("solvelt.user.draft", "1"); localStorage.setItem("solvelt.device.pref", "keep"); });
  const before = await tokens(request, email);
  expect(before.length).toBe(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await tokens(request, email)).toEqual([]);
  expect(await page.evaluate(() => [localStorage.getItem("solvelt.user.cart"), sessionStorage.getItem("solvelt.user.draft"), localStorage.getItem("solvelt.device.pref")])).toEqual([null, null, "keep"]);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("sign out everywhere ends the other device's session too", async ({ page, browser, baseURL }) => {
  const email = await newVerifiedUser(page, "all");
  await signIn(page, email);
  const second = await (await browser.newContext({ baseURL })).newPage();
  await signIn(second, email);
  await expect(second).toHaveURL(/\/account$/);
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/$/);
  await second.goto("/account");
  await expect(second).toHaveURL(/\/sign-in\?next=/);
  await second.context().close();
});

test("a session revoked on the API side is treated as signed out and its cookie is dropped", async ({ page, request, context }) => {
  const email = await newVerifiedUser(page, "dead");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const before = await tokens(request, email);
  for (const t of before) await request.get(`${MOCK}/__test/revoke?token=${t}`); // as if expired, or revoked from elsewhere
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  // The dead token must not be kept: a fresh visitor cookie replaced it, and the page works anonymously.
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Account of Dana Levi" })).toHaveCount(0);
  expect((await context.cookies()).some((c) => /solvelt_session$/.test(c.name))).toBe(true);
});

test("forgot and reset password: same answer for unknown emails, old password stops working", async ({ page, browser, baseURL }) => {
  const email = await newVerifiedUser(page, "reset");
  const other = await (await browser.newContext({ baseURL })).newPage();
  await signIn(other, email);
  await expect(other).toHaveURL(/\/account$/);

  const ask = async (address: string) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email").fill(address);
    await page.getByRole("button", { name: "Send reset link" }).click();
    return (await page.locator("p[role='status']").textContent()) ?? "";
  };
  expect(await ask(uniqueEmail("ghost"))).toBe(await ask(email));

  const token = await mailedToken(page.request, "reset", email);
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel("New password").fill("short");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByLabel("New password")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("New password").fill("a brand new passphrase 42");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();

  await page.goto(`/reset-password?token=${token}`); // single use
  await page.getByLabel("New password").fill("another passphrase 4242");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("invalid or has expired");

  await signIn(page, email, PASSWORD);
  await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("Email or password is incorrect.");
  await signIn(page, email, "a brand new passphrase 42");
  await expect(page).toHaveURL(/\/account$/);
  await other.goto("/account");
  await expect(other).toHaveURL(/\/sign-in/); // reset signed other devices out
  await other.context().close();
});

test("verification links need a click (a GET alone consumes nothing) and set no-referrer", async ({ page }) => {
  const email = uniqueEmail("prefetch");
  await signUp(page, email);
  const token = await mailedToken(page.request, "verify", email);
  const res = await page.request.get(`/verify-email?token=${token}`);
  expect(res.headers()["referrer-policy"]).toMatch(/(^|, )no-referrer$/); // the last value wins in browsers
  await signIn(page, email);
  await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("verify your email"); // still unverified after the GET
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: signed-in account and form error states (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    const email = await newVerifiedUser(page, `axe${theme}`);
    await page.goto("/sign-in");
    await page.getByRole("button", { name: "Sign in", exact: true }).click(); // empty submit -> field errors
    await expect(page.getByRole("group", { name: "There is a problem" })).toBeVisible();
    for (const check of [async () => undefined, async () => { await signIn(page, email); await expect(page).toHaveURL(/\/account$/); }]) {
      await check();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations.map((v) => v.id)).toEqual([]);
    }
  });
}

test("sign-in and sign-out issue a new session id (no fixation): pre-login CSRF tokens stop working", async ({ page, baseURL }) => {
  const email = await newVerifiedUser(page, "fixation");
  const anonymous = await csrfFor(page.request);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  const signedIn = await csrfFor(page.request, "/account");
  expect(signedIn).not.toBe(anonymous);
  const stale = await page.request.post("/sign-out", { form: { csrf: anonymous, scope: "this" }, headers: { origin: baseURL! }, maxRedirects: 0 });
  expect(stale.status()).toBe(403); // a token minted before login (or planted by an attacker) is useless afterwards
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(await csrfFor(page.request, "/")).not.toBe(signedIn);
});
