import { expect, test, type Page } from "@playwright/test";
import { csrfFor, MOCK, mailedToken, newVerifiedUser, PASSWORD, signIn, signUp, tokensOf, uniqueEmail, waitHydrated } from "./helpers";

const SUMMARY = (page: Page) => page.getByRole("group", { name: "There is a problem" });

async function signedIn(page: Page, tag: string, name = "Dana Levi") {
  const email = await newVerifiedUser(page, tag, name);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

test.describe("sign out failures are reported, not hidden", () => {
  for (const [button, key, text] of [["Sign out everywhere", "signout-all-failed", /could not sign out your other devices/], ["Sign out", "signout-failed", /could not confirm it with the server/]] as const) {
    test(`${button}: API failure shows a notice and still clears this device`, async ({ page, request }) => {
      const email = await signedIn(page, `sof${key.length}`);
      const [token] = await tokensOf(request, email);
      await request.get(`${MOCK}/__test/fail-signout?token=${token}`);
      await page.getByRole("button", { name: button, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/sign-in\\?notice=${key}$`));
      await expect(page.getByRole("alert")).toContainText(text);
      await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible(); // this device is signed out
      await page.goto("/account");
      await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
      expect(await tokensOf(request, email)).toEqual([token]); // and the notice was truthful: the server still had the session
    });
  }
  test("unknown notice keys render nothing", async ({ page }) => {
    await page.goto("/sign-in?notice=%3Cb%3Ehacked%3C%2Fb%3E");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("main b")).toHaveCount(0);
  });
});

test("an invalid submit moves focus to one error summary; per-field messages are not announced twice", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByRole("button", { name: "Create account" }).click();
  const summary = SUMMARY(page);
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(page.locator("[role=alert]")).toHaveCount(0);
  for (const id of ["f-displayName", "f-email", "f-password"]) {
    await expect(summary.locator(`a[href="#${id}"]`)).toHaveCount(1);
    await expect(page.locator(`#${id}`)).toHaveCount(1); // the link target exists
  }
  // Fix one field and submit again: the (new) summary takes focus again.
  await page.getByLabel("Name").fill("Dana");
  await page.getByLabel("Email").fill("x");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(summary).toBeFocused();
  await expect(summary.locator('a[href="#f-displayName"]')).toHaveCount(0);
});

test("signing in over an existing session revokes the previous API token", async ({ page, request, baseURL }) => {
  const email = await signedIn(page, "overlap");
  const [first] = await tokensOf(request, email);
  const csrf = await csrfFor(page.request, "/account");
  const res = await page.request.post("/sign-in", { form: { csrf, email, password: PASSWORD, next: "" }, headers: { origin: baseURL! }, maxRedirects: 0 });
  expect(res.status()).toBe(302);
  const after = await tokensOf(request, email);
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(first);
});

test("the API's 422 text about the email is never shown on sign-up (no account enumeration)", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Dana");
  await page.getByLabel("Email").fill(`taken-422-${Date.now()}@example.test`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(SUMMARY(page)).toContainText("Enter a valid email address.");
  await expect(page.locator("body")).not.toContainText(/already registered/i);
});

for (const kind of ["verify", "reset"] as const) {
  test(`the one-time ${kind} token leaves the URL after load and the page still works`, async ({ page }) => {
    const email = uniqueEmail(`urlclean${kind}`);
    await signUp(page, email);
    if (kind === "verify") {
      const token = await mailedToken(page.request, "verify", email);
      await page.goto(`/verify-email?token=${token}`);
      await expect.poll(() => page.url()).not.toContain(token);
      expect(new URL(page.url()).search).toBe("");
      await page.getByRole("button", { name: "Verify email" }).click();
      await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
      expect(page.url()).not.toContain(token);
    } else {
      await page.goto("/verify-email?sent=1"); // reset needs a verified user
      const verify = await mailedToken(page.request, "verify", email);
      await page.goto(`/verify-email?token=${verify}`);
      await page.getByRole("button", { name: "Verify email" }).click();
      await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible(); // wait: navigating away would cancel the request
      await page.goto("/forgot-password");
      await page.getByLabel("Email").fill(email);
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.locator("p[role='status']")).toBeVisible(); // the request has finished, so the mail exists
      const token = await mailedToken(page.request, "reset", email);
      await page.goto(`/reset-password?token=${token}`);
      await expect.poll(() => page.url()).not.toContain(token);
      await page.getByLabel("New password").fill("a perfectly fine passphrase 7");
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
    }
  });
}

test("Referrer-Policy is sent exactly once: no-referrer on token pages, the default elsewhere", async ({ request }) => {
  for (const path of ["/reset-password", "/reset-password?token=x", "/verify-email?token=x", "/verify-email.data?token=x", "/reset-password.data"]) {
    expect((await request.get(path)).headers()["referrer-policy"], path).toBe("no-referrer");
  }
  for (const path of ["/", "/sign-in", "/forgot-password"]) {
    expect((await request.get(path)).headers()["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
  }
});

test("no-store survives on .data responses of private routes", async ({ page, request }) => {
  await signedIn(page, "nostore");
  for (const path of ["/account.data", "/account/profile.data", "/account/addresses.data"]) {
    expect((await page.request.get(path)).headers()["cache-control"], path).toContain("no-store");
  }
  for (const path of ["/verify-email.data?token=x", "/reset-password.data?token=x"]) {
    expect((await request.get(path)).headers()["cache-control"], path).toContain("no-store");
  }
});

test.describe("user-scoped browser storage follows the signed-in user", () => {
  test("is cleared when the session ends without the sign-out button (expiry or remote sign-out)", async ({ page, request }) => {
    const email = await signedIn(page, "storexp");
    await page.evaluate(() => { localStorage.setItem("solvelt.user.cart", "1"); sessionStorage.setItem("solvelt.user.draft", "1"); localStorage.setItem("solvelt.device.pref", "keep"); });
    for (const t of await tokensOf(request, email)) await request.get(`${MOCK}/__test/revoke?token=${t}`);
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => [localStorage.getItem("solvelt.user.cart"), sessionStorage.getItem("solvelt.user.draft"), localStorage.getItem("solvelt.device.pref")])).toEqual([null, null, "keep"]);
  });
  test("is cleared when a different person takes over the browser (no anonymous page in between)", async ({ page, browser, baseURL }) => {
    await signedIn(page, "storea");
    await page.evaluate(() => { localStorage.setItem("solvelt.user.cart", "first-user"); localStorage.setItem("solvelt.device.pref", "keep"); });
    // A second account, created elsewhere.
    const other = await (await browser.newContext({ baseURL })).newPage();
    const second = await newVerifiedUser(other, "storeb", "Someone Else");
    await other.context().close();
    // Switch accounts through the shared cookie jar, so the next page load goes straight from user 1 to user 2.
    const csrf = await csrfFor(page.request, "/account");
    const res = await page.request.post("/sign-in", { form: { csrf, email: second, password: PASSWORD, next: "" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(res.status()).toBe(302);
    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Hello, Someone Else" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => [localStorage.getItem("solvelt.user.cart"), localStorage.getItem("solvelt.device.pref")])).toEqual([null, "keep"]);
  });
});

test("expired verification link: request a new one; older links stop working; same answer for unknown emails", async ({ page }) => {
  const email = uniqueEmail("resend");
  await signUp(page, email);
  const old = await mailedToken(page.request, "verify", email);

  const ask = async (address: string) => {
    await page.goto("/resend-verification");
    await page.getByLabel("Email").fill(address);
    await page.getByRole("button", { name: "Send new link" }).click();
    return (await page.locator("p[role='status']").textContent()) ?? "";
  };
  expect(await ask(uniqueEmail("ghost"))).toBe(await ask(email));
  const fresh = await mailedToken(page.request, "verify", email);
  expect(fresh).not.toBe(old);

  await page.goto(`/verify-email?token=${old}`);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(SUMMARY(page)).toContainText("invalid or has expired");
  await expect(page.getByRole("link", { name: "Request a new verification link" })).toBeVisible();

  await page.goto(`/verify-email?token=${fresh}`);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
});

test("an unverified sign-in offers to resend the verification email", async ({ page }) => {
  const email = uniqueEmail("unv");
  await signUp(page, email);
  await signIn(page, email);
  await page.getByRole("link", { name: "Resend the verification email" }).click();
  await expect(page).toHaveURL(/\/resend-verification$/);
});

test("a stale or foreign CSRF token shows a friendly retry page, not a bare Forbidden", async ({ page }) => {
  await page.goto("/sign-in");
  // Tampering before hydration races with React resetting the field to its server value: wait for the explicit marker.
  await waitHydrated(page);
  await page.locator('input[name="csrf"]').first().evaluate((el) => { (el as HTMLInputElement).value = "stale-token-from-another-tab"; });
  await page.getByLabel("Email").fill("a@example.test");
  await page.getByLabel("Password").fill("whatever");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Please try again" })).toBeVisible();
  await expect(page.locator("body")).not.toHaveText(/^Forbidden$/);
});

test("/account asks the API for the current user once per request", async ({ page, request }) => {
  const email = await signedIn(page, "once");
  const [token] = await tokensOf(request, email);
  const tail = token!.slice(-8);
  const count = async () => ((await (await request.get(`${MOCK}/__test/seen`)).json()) as { path: string; tokenTail: string }[]).filter((s) => s.tokenTail === tail && s.path === "/api/v1/account/me").length;
  const before = await count();
  expect((await page.request.get("/account")).status()).toBe(200);
  expect((await count()) - before).toBe(1);
});

// ---- mutants the orchestrator found surviving ----
test("a signed-in visit to /sign-in never follows an off-site ?next=", async ({ page, baseURL }) => {
  await signedIn(page, "loadernext");
  for (const bad of ["//evil.example", "https://evil.example/x", "/\t/evil.example", "/\\evil.example"]) {
    await page.goto(`/sign-in?next=${encodeURIComponent(bad)}`);
    await expect(page).toHaveURL(/\/account$/);
    expect(new URL(page.url()).origin).toBe(baseURL);
  }
  await page.goto(`/sign-in?next=${encodeURIComponent("/account/profile")}`);
  await expect(page).toHaveURL(/\/account\/profile$/);
});

test("a dead API session is replaced in the cookie, not just ignored", async ({ page, request, context }) => {
  const email = await signedIn(page, "cookiechg");
  const cookie = async () => (await context.cookies()).find((c) => /solvelt_session$/.test(c.name))!.value;
  const before = await cookie();
  for (const t of await tokensOf(request, email)) await request.get(`${MOCK}/__test/revoke?token=${t}`);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  expect(await cookie()).not.toBe(before); // the sealed value holding the dead token is gone
});

test("GET /sign-out does nothing: it cannot be used to log a user out", async ({ page }) => {
  await signedIn(page, "getout");
  await page.goto("/sign-out");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: /^Account of / })).toBeVisible();
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: /^Hello, / })).toBeVisible();
  const res = await page.request.get("/sign-out", { maxRedirects: 0 });
  expect(res.status()).toBe(302);
});
