import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { addVirtualAuthenticator, csrfFor, getAssertion, mailedToken, MOCK, newVerifiedUser, PASSWORD, signIn, tokensOf, uniqueEmail, waitHydrated } from "./helpers";

const passkeyRow = (page: Page, name: string) => page.locator("main li").filter({ hasText: name });

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

async function registerPasskey(page: Page, name: string) {
  await page.goto("/account/passkeys");
  await waitHydrated(page);
  await page.getByLabel("Passkey name").fill(name);
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(passkeyRow(page, name)).toBeVisible();
}

const optionsFor = async (request: APIRequestContext, path: string, csrf: string, origin: string) =>
  request.post(path, { form: { csrf }, headers: { origin } });

test.describe("passkey challenges are bound to the browser session", () => {
  test("a challenge minted in another session cannot be redeemed; the owner can redeem it once", async ({ page, playwright, baseURL }) => {
    await addVirtualAuthenticator(page);
    const email = await signedIn(page, "bind");
    await registerPasskey(page, "Bound key");
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/sign-in");
    await waitHydrated(page);

    const sessionX = await playwright.request.newContext({ baseURL });
    const sessionY = await playwright.request.newContext({ baseURL });
    const sessionZ = await playwright.request.newContext({ baseURL });
    try {
      const csrfX = await csrfFor(sessionX);
      const issued = (await (await optionsFor(sessionX, "/passkeys/sign-in-options", csrfX, baseURL!)).json()) as { challengeId: string; options: Record<string, unknown> };
      const credential = JSON.stringify(await getAssertion(page, issued.options));
      const submit = (ctx: APIRequestContext, csrf: string) =>
        ctx.post("/sign-in", { form: { csrf, intent: "passkey", challengeId: issued.challengeId, credential, next: "" }, headers: { origin: baseURL! }, maxRedirects: 0 });

      // Session Y never asked for this challenge: refused, and nothing is signed in.
      expect((await submit(sessionY, await csrfFor(sessionY))).status()).toBe(401);
      expect(await tokensOf(page.request, email)).toEqual([]);
      // The session that asked for it can use it, once.
      expect((await submit(sessionX, csrfX)).status()).toBe(302);
      expect(await tokensOf(page.request, email)).toHaveLength(1);
      // Replay: a fresh session is refused outright; the (now signed-in) session gets bounced by the sign-in page's own
      // redirect, but no new login happens either way: the API session list never changes.
      const [issuedToken] = await tokensOf(page.request, email);
      expect((await submit(sessionZ, await csrfFor(sessionZ))).status()).toBe(401);
      const replay = await submit(sessionX, await csrfFor(sessionX, "/account"));
      expect(replay.headers()["set-cookie"]).toBeUndefined();
      expect(await tokensOf(page.request, email)).toEqual([issuedToken]);
    } finally {
      await Promise.all([sessionX.dispose(), sessionY.dispose(), sessionZ.dispose()]);
    }
  });

  test("a sign-in challenge cannot complete a registration, and a failed attempt burns the challenge", async ({ page, baseURL }) => {
    await addVirtualAuthenticator(page);
    await signedIn(page, "kind");
    await registerPasskey(page, "Key one");
    const csrf = await csrfFor(page.request, "/account/passkeys");
    const issued = (await (await optionsFor(page.request, "/passkeys/sign-in-options", csrf, baseURL!)).json()) as { challengeId: string; options: Record<string, unknown> };
    const credential = JSON.stringify(await getAssertion(page, issued.options));
    const wrong = await page.request.post("/account/passkeys", { form: { csrf, intent: "register", challengeId: issued.challengeId, credential, name: "x" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(wrong.status()).toBe(400); // wrong ceremony for the bound challenge
    // The binding was dropped by that attempt: the same challenge no longer works for sign-in either (no new API session).
    const again = await page.request.post("/sign-in", { form: { csrf, intent: "passkey", challengeId: issued.challengeId, credential, next: "" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(again.headers()["set-cookie"]).toBeUndefined(); // a successful sign-in would have rotated the session cookie
  });

  test("passkey sign-in over an existing session revokes the previous API token", async ({ page, baseURL }) => {
    await addVirtualAuthenticator(page);
    const email = await signedIn(page, "pkrevoke");
    await registerPasskey(page, "Revoke key");
    const [old] = await tokensOf(page.request, email);
    const csrf = await csrfFor(page.request, "/account");
    const issued = (await (await optionsFor(page.request, "/passkeys/sign-in-options", csrf, baseURL!)).json()) as { challengeId: string; options: Record<string, unknown> };
    const credential = JSON.stringify(await getAssertion(page, issued.options));
    const res = await page.request.post("/sign-in", { form: { csrf, intent: "passkey", challengeId: issued.challengeId, credential, next: "" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const after = await tokensOf(page.request, email);
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(old);
  });

  test("options responses are never cached and carry the session binding cookie", async ({ page, request, baseURL }) => {
    await signedIn(page, "optcache");
    const reg = await optionsFor(page.request, "/account/passkeys/options", await csrfFor(page.request, "/account/passkeys"), baseURL!);
    expect(reg.status()).toBe(200);
    expect(reg.headers()["cache-control"]).toBe("private, no-store");
    expect(reg.headers()["set-cookie"]).toMatch(/solvelt_session=.*HttpOnly/);
    const anon = await optionsFor(request, "/passkeys/sign-in-options", await csrfFor(request), baseURL!);
    expect(anon.status()).toBe(200);
    expect(anon.headers()["cache-control"]).toBe("private, no-store");
    expect(anon.headers()["set-cookie"]).toMatch(/solvelt_session=.*HttpOnly/);
  });

  test("options whose rp id points elsewhere are never forwarded (fail closed)", async ({ page, baseURL }) => {
    const email = uniqueEmail("badrp-x");
    await page.goto("/sign-up");
    await page.getByLabel("Name").fill("Bad Rp");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/verify-email\?sent=1$/);
    await page.goto(`/verify-email?token=${await mailedToken(page.request, "verify", email)}`);
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
    await signIn(page, email);
    await expect(page).toHaveURL(/\/account$/);
    const res = await optionsFor(page.request, "/account/passkeys/options", await csrfFor(page.request, "/account/passkeys"), baseURL!);
    expect(res.status()).toBe(502);
    expect(await res.text()).not.toContain("evil.example");
    expect(res.headers()["set-cookie"]).toBeUndefined();
    await addVirtualAuthenticator(page);
    await page.goto("/account/passkeys");
    await waitHydrated(page);
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.getByRole("alert")).toContainText("could not set up a passkey");
  });
});

test.describe("removing a passkey needs a recent sign-in", () => {
  test("after the window, Remove asks for the password first; then it works", async ({ browser }, testInfo) => {
    const port = 3195 + testInfo.parallelIndex;
    const origin = `http://localhost:${port}`;
    const child = spawn("node", ["server.js"], {
      env: {
        PATH: process.env.PATH!, NODE_ENV: "production", PORT: String(port), API_BASE_URL: MOCK, PUBLIC_ORIGIN: origin, REAUTH_WINDOW_SECONDS: "2",
        SESSION_COOKIE_SECRET: "Pq8Vn2Ws6Zk0Jd4Lc9Rb3Hm7Ty1Fg5XeA8u", WEB_FORWARDING_KEY: "Mh3Xt7Bk1Qw5Zn9Vs2Dj6Lc0Rf4Pg8YaE1o",
      },
      stdio: "ignore",
    });
    const context = await browser.newContext({ baseURL: origin });
    const page = await context.newPage();
    try {
      for (let i = 0; i < 60; i++) { try { if ((await fetch(`${origin}/healthz`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
      await addVirtualAuthenticator(page);
      const email = await signedIn(page, "reauth");
      await registerPasskey(page, "Fresh key");
      const [first] = await tokensOf(page.request, email);

      await page.waitForTimeout(2500); // longer than the 2 s window
      await page.goto("/account/passkeys");
      await waitHydrated(page);
      await passkeyRow(page, "Fresh key").getByRole("button", { name: /Remove passkey/ }).click();
      await expect(page).toHaveURL(/\/account\/confirm\?next=%2Faccount%2Fpasskeys$/);
      await page.goto("/account/passkeys");
      await expect(passkeyRow(page, "Fresh key")).toBeVisible(); // nothing was removed by the redirect

      await page.goto("/account/confirm?next=%2Faccount%2Fpasskeys");
      await waitHydrated(page);
      await page.getByLabel("Password").fill("not the password at all");
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("That password is not correct.");
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page).toHaveURL(/\/account\/passkeys$/);
      const after = await tokensOf(page.request, email);
      expect(after).toHaveLength(1);
      expect(after[0]).not.toBe(first); // confirming issued a fresh API session and revoked the old one

      await passkeyRow(page, "Fresh key").getByRole("button", { name: /Remove passkey/ }).click();
      await expect(page.getByRole("heading", { name: "No passkeys yet" })).toBeVisible();
    } finally {
      await context.close();
      child.kill();
    }
  });

  test("the confirm page needs a session, and ignores an off-site next", async ({ page, baseURL }) => {
    await page.goto("/account/confirm");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fconfirm$/);
    await signedIn(page, "confirmnext");
    await page.goto(`/account/confirm?next=${encodeURIComponent("//evil.example")}`);
    await waitHydrated(page);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page).toHaveURL(/\/account$/);
    expect(new URL(page.url()).origin).toBe(baseURL);
  });

  test("a failed removal says so (not 'add')", async ({ page }) => {
    await addVirtualAuthenticator(page);
    await signedIn(page, "delfail");
    await registerPasskey(page, "undeletable");
    await passkeyRow(page, "undeletable").getByRole("button", { name: /Remove passkey/ }).click();
    const summary = page.getByRole("group", { name: "There is a problem" });
    await expect(summary).toContainText("could not remove that passkey");
    await expect(summary).not.toContainText("add");
  });
});

test.describe("ids never reach API paths as dot segments", () => {
  for (const bad of [".", "..", "%2e%2e", "a%2fb", "x y"]) {
    test(`id ${JSON.stringify(bad)} is a 404 and never calls the API`, async ({ page, request, baseURL }) => {
      const email = await signedIn(page, "dots");
      const [token] = await tokensOf(request, email);
      const tail = token!.slice(-8);
      const csrf = await csrfFor(page.request, "/account/addresses");
      const decoded = decodeURIComponent(bad);
      for (const [path, form] of [
        ["/account/addresses", { csrf, id: decoded, intent: "delete" }],
        ["/account/addresses", { csrf, id: decoded, intent: "default" }],
        ["/account/passkeys", { csrf, id: decoded, intent: "delete" }],
      ] as const) {
        const res = await page.request.post(path, { form, headers: { origin: baseURL! }, maxRedirects: 0 });
        expect(res.status(), `${path} ${JSON.stringify(decoded)}`).toBe(404);
      }
      // (The URL parser itself resolves "." and ".." before a request is sent, so only ids that survive in a path are probed.)
      if (!/^(\.|\.\.|%2e%2e)$/.test(bad)) expect((await page.request.get(`/account/addresses/${bad}`)).status()).toBe(404);
      const seen = (await (await request.get(`${MOCK}/__test/seen`)).json()) as { path: string; method: string; tokenTail: string }[];
      const mine = seen.filter((s) => s.tokenTail === tail).map((s) => s.path);
      expect(mine.some((p) => p === "/api/v1/account/default" || p === "/api/v1/account/" || p === "/api/v1/account")).toBe(false);
    });
  }
});

test("profile?saved=1 hydrates without errors", async ({ page }) => {
  await signedIn(page, "savedhyd");
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("/account/profile?saved=1");
  await waitHydrated(page);
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
  expect(problems).toEqual([]);
});

test("account documents are no-store, including the edit page and the 404 for someone else's address", async ({ page, browser, baseURL }) => {
  await signedIn(page, "nostore2");
  await page.goto("/account/addresses/new");
  await page.getByLabel("Full name").fill("Owner");
  await page.getByLabel("Street address").fill("1 Main");
  await page.getByLabel("City").fill("Haifa");
  await page.getByLabel("Postal code").fill("1");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page).toHaveURL(/\/account\/addresses$/);
  const id = (await page.getByRole("link", { name: /Edit address for Owner/ }).getAttribute("href"))!.split("/").pop()!;
  expect((await page.request.get(`/account/addresses/${id}`)).headers()["cache-control"]).toBe("private, no-store");

  const ctx = await browser.newContext({ baseURL });
  const other = await ctx.newPage();
  await signedIn(other, "nostore3");
  const res = await other.request.get(`/account/addresses/${id}`);
  expect(res.status()).toBe(404);
  expect(res.headers()["cache-control"]).toBe("private, no-store");
  expect((await other.request.get("/account/addresses/doesnotexist1")).headers()["cache-control"]).toBe("private, no-store");
  await ctx.close();
});

test("control and bidi characters are stripped from names and addresses", async ({ page, baseURL }) => {
  await addVirtualAuthenticator(page);
  await signedIn(page, "bidi");
  const csrf = await csrfFor(page.request, "/account/addresses/new");
  const res = await page.request.post("/account/addresses/new", {
    form: { csrf, intent: "save", fullName: "a\u0000b\u202eevil\u0007", line1: "1\u2066 Main\u2069", city: "Hai\u0085fa", postalCode: "3\u200f1", country: "IL" },
    headers: { origin: baseURL! }, maxRedirects: 0,
  });
  expect(res.status()).toBe(302);
  await page.goto("/account/addresses");
  const text = await page.locator("main").innerText();
  expect(text).toContain("abevil");
  expect(text).toContain("1 Main");
  // eslint-disable-next-line no-control-regex
  expect(text).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/);
  await page.goto("/account/passkeys");
  await waitHydrated(page);
  await page.getByLabel("Passkey name").fill("key\u202eevil");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(passkeyRow(page, "keyevil")).toBeVisible(); // stored without the override character
  expect(await page.locator("main li").first().innerText()).not.toMatch(/[\u202a-\u202e]/);
});

test("resend-verification stays generic when the API errors", async ({ page }) => {
  const ask = async (address: string) => {
    await page.goto("/resend-verification");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(address);
    await page.getByRole("button", { name: "Send new link" }).click();
    return (await page.locator("p[role='status']").textContent()) ?? "";
  };
  const normal = await ask(uniqueEmail("ghost"));
  const boom = await ask(uniqueEmail("resend-boom"));
  expect(boom).toBe(normal);
  expect(boom).not.toMatch(/error|down|unavailable|try again/i);
});
