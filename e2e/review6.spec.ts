import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { spawn } from "node:child_process";
import { addVirtualAuthenticator, csrfFor, getAssertion, mailedToken, MOCK, newVerifiedUser, PASSWORD, signIn, tokensOf, uniqueEmail, waitHydrated } from "./helpers";

// Client IPs that select a mock API variant (see IP in e2e/mock-api.mjs). The E2E web server trusts X-Forwarded-For from localhost.
const IP = { ANON_RPID_EVIL: "198.51.100.61", ANON_BOTH_DIFFER: "198.51.100.62", ANON_BOTH_DIFFER_REV: "198.51.100.63", ANON_RP_ONLY_EVIL: "198.51.100.64", ANON_BOTH_SAME: "198.51.100.65", REG_BOTH_DIFFER: "198.51.100.66", REG_BOTH_SAME: "198.51.100.67", REG_LENIENT: "198.51.100.68", REG_5XX: "198.51.100.69", SIGNIN_LENIENT: "198.51.100.70" };
const as = (ip: string, origin: string) => ({ origin, "x-forwarded-for": ip });

async function signedIn(page: Page, tag: string, name = "Dana Levi") {
  const email = await newVerifiedUser(page, tag, name);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

type Issued = { challengeId: string; options: Record<string, unknown> };

test.describe("rp id is checked for the ceremony that uses it (anonymous sign-in options)", () => {
  const post = (request: APIRequestContext, csrf: string, ip: string, baseURL: string) =>
    request.post("/passkeys/sign-in-options", { form: { csrf }, headers: as(ip, baseURL) });

  for (const [name, ip] of [["rpId is evil", IP.ANON_RPID_EVIL], ["rp.id good but rpId evil (the bypass)", IP.ANON_BOTH_DIFFER], ["rp.id evil but rpId good", IP.ANON_BOTH_DIFFER_REV]] as const) {
    test(`refused: ${name}`, async ({ request, baseURL }) => {
      const res = await post(request, await csrfFor(request), ip, baseURL!);
      expect(res.status()).toBe(502);
      expect(res.headers()["set-cookie"]).toBeUndefined(); // no challenge was bound
      expect(await res.text()).not.toContain("evil.example");
    });
  }

  test("an unused rp object with a hostile id is not forwarded (the browser ignores it, but nothing unchecked goes out)", async ({ request, baseURL }) => {
    const res = await post(request, await csrfFor(request), IP.ANON_RP_ONLY_EVIL, baseURL!);
    expect(res.status()).toBe(200);
    const { options } = (await res.json()) as Issued;
    expect(options).not.toHaveProperty("rp");
    expect(JSON.stringify(options)).not.toContain("evil.example");
  });

  test("when both are present and equal, only rpId is forwarded", async ({ request, baseURL }) => {
    const res = await post(request, await csrfFor(request), IP.ANON_BOTH_SAME, baseURL!);
    expect(res.status()).toBe(200);
    const { options } = (await res.json()) as Issued;
    expect(options.rpId).toBe("localhost");
    expect(options).not.toHaveProperty("rp");
  });
});

test.describe("rp id is checked for registration options too", () => {
  test("rp.id good but rpId evil is refused; equal ids forward only rp.id", async ({ page, baseURL }) => {
    await signedIn(page, "rpreg");
    const csrf = await csrfFor(page.request, "/account/passkeys");
    const bad = await page.request.post("/account/passkeys/options", { form: { csrf }, headers: as(IP.REG_BOTH_DIFFER, baseURL!) });
    expect(bad.status()).toBe(502);
    expect(bad.headers()["set-cookie"]).toBeUndefined();
    const same = await page.request.post("/account/passkeys/options", { form: { csrf }, headers: as(IP.REG_BOTH_SAME, baseURL!) });
    expect(same.status()).toBe(200);
    const { options } = (await same.json()) as Issued;
    expect((options.rp as { id: string }).id).toBe("localhost");
    expect(options).not.toHaveProperty("rpId");
  });
});

test.describe("the confirm page limits wrong passwords per session", () => {
  const wrong = (page: Page, csrf: string, baseURL: string) =>
    page.request.post("/account/confirm", { form: { csrf, password: "definitely not it", next: "/account/passkeys" }, headers: { origin: baseURL }, maxRedirects: 0 });

  test("5 wrong passwords end the session; the counter cannot be reset by the client", async ({ page, request, baseURL }) => {
    const email = await signedIn(page, "lock");
    expect(await tokensOf(request, email)).toHaveLength(1);
    const csrf = await csrfFor(page.request, "/account/confirm");
    for (let i = 1; i <= 4; i++) expect((await wrong(page, csrf, baseURL!)).status(), `attempt ${i}`).toBe(401);
    expect(await tokensOf(request, email)).toHaveLength(1); // still signed in after 4
    const fifth = await wrong(page, csrf, baseURL!);
    expect(fifth.status()).toBe(302);
    expect(fifth.headers()["location"]).toBe("/sign-in?notice=confirm-locked");
    expect(await tokensOf(request, email)).toEqual([]); // the API session was revoked
    await page.goto("/account");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  });

  test("a correct password resets the count; a 429 from the API is not counted as a wrong password", async ({ page, baseURL }) => {
    await signedIn(page, "lockreset");
    let csrf = await csrfFor(page.request, "/account/confirm");
    for (let i = 0; i < 3; i++) expect((await wrong(page, csrf, baseURL!)).status()).toBe(401);
    const limited = await page.request.post("/account/confirm", { form: { csrf, password: "trigger-429", next: "" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(limited.status()).toBe(429);
    const ok = await page.request.post("/account/confirm", { form: { csrf, password: PASSWORD, next: "/account/passkeys" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(ok.status()).toBe(302);
    expect(ok.headers()["location"]).toBe("/account/passkeys");
    csrf = await csrfFor(page.request, "/account/confirm"); // new session, new token, count back to zero
    for (let i = 0; i < 4; i++) expect((await wrong(page, csrf, baseURL!)).status(), `after reset, attempt ${i + 1}`).toBe(401);
  });

  test("in the browser: the lockout lands on sign-in with an explanation", async ({ page }) => {
    await signedIn(page, "lockui");
    await page.goto("/account/confirm");
    await waitHydrated(page);
    for (let i = 1; i <= 4; i++) {
      await page.getByLabel("Password").fill("wrong password " + i);
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("That password is not correct.");
    }
    await page.getByLabel("Password").fill("wrong password 5");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page).toHaveURL(/\/sign-in\?notice=confirm-locked$/);
    await expect(page.getByRole("alert")).toContainText("Too many incorrect passwords");
  });
});

test.describe("adding a passkey needs a recent sign-in as well (O-11)", () => {
  test("after the window: options are refused, register redirects, and the page sends the user to confirm", async ({ browser }, testInfo: TestInfo) => {
    const port = 3205 + testInfo.parallelIndex;
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
      await signedIn(page, "addreauth");
      await page.waitForTimeout(2500); // longer than the 2 s window
      const csrf = await csrfFor(page.request, "/account/passkeys");

      const options = await page.request.post("/account/passkeys/options", { form: { csrf }, headers: { origin } });
      expect(options.status()).toBe(403);
      expect(await options.json()).toMatchObject({ code: "reauth_required", redirectTo: "/account/confirm?next=%2Faccount%2Fpasskeys" });
      expect(options.headers()["set-cookie"]).toBeUndefined(); // no challenge was issued

      const register = await page.request.post("/account/passkeys", { form: { csrf, intent: "register", challengeId: "x", credential: "{}", name: "n" }, headers: { origin }, maxRedirects: 0 });
      expect(register.status()).toBe(302);
      expect(register.headers()["location"]).toBe("/account/confirm?next=%2Faccount%2Fpasskeys");

      await page.goto("/account/passkeys");
      await waitHydrated(page);
      await page.getByRole("button", { name: "Add a passkey" }).click();
      await expect(page).toHaveURL(/\/account\/confirm\?next=%2Faccount%2Fpasskeys$/);
      await waitHydrated(page);
      await page.getByLabel("Password").fill(PASSWORD);
      await page.getByRole("button", { name: "Confirm" }).click();
      await expect(page).toHaveURL(/\/account\/passkeys$/);
      await waitHydrated(page);
      await page.getByLabel("Passkey name").fill("After confirm");
      await page.getByRole("button", { name: "Add a passkey" }).click();
      await expect(page.locator("main li").filter({ hasText: "After confirm" })).toBeVisible();
    } finally {
      await context.close();
      child.kill();
    }
  });
});

test.describe("the challenge binding is dropped on every path", () => {
  test("a signed-in session's failed passkey sign-in still drops it (the sign-in loader redirect must not swallow the cookie)", async ({ page, baseURL }) => {
    await addVirtualAuthenticator(page);
    const email = await signedIn(page, "dropa");
    await page.goto("/account/passkeys");
    await waitHydrated(page);
    await page.getByRole("button", { name: "Add a passkey" }).click();
    await expect(page.locator("main li").filter({ hasText: "My passkey" })).toBeVisible();
    const [token] = await tokensOf(page.request, email);

    const csrf = await csrfFor(page.request, "/account");
    const issued = (await (await page.request.post("/passkeys/sign-in-options", { form: { csrf }, headers: { origin: baseURL! } })).json()) as Issued;
    // 1) a garbage credential: the API refuses, we are signed in already, so the response is a redirect.
    const bad = await page.request.post("/sign-in", { form: { csrf, intent: "passkey", challengeId: issued.challengeId, credential: "{}", next: "" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(bad.status()).toBe(302);
    expect(bad.headers()["set-cookie"]).toMatch(/solvelt_session=/); // the cookie that drops the binding came through
    // 2) the REAL credential for that same challenge must no longer be accepted. The API here would accept it (lenient
    //    variant: no single use), so only the web-side binding can refuse; no new API session may appear.
    const credential = JSON.stringify(await getAssertion(page, issued.options));
    await page.request.post("/sign-in", { form: { csrf, intent: "passkey", challengeId: issued.challengeId, credential, next: "" }, headers: as(IP.SIGNIN_LENIENT, baseURL!), maxRedirects: 0 });
    expect(await tokensOf(page.request, email)).toEqual([token]);
  });

  test("an API failure while registering drops it too (failAccount carries the cookie)", async ({ page, baseURL }) => {
    await signedIn(page, "dropb");
    const csrf = await csrfFor(page.request, "/account/passkeys");
    const issued = (await (await page.request.post("/account/passkeys/options", { form: { csrf }, headers: { origin: baseURL! } })).json()) as Issued;
    const fail = await page.request.post("/account/passkeys", { form: { csrf, intent: "register", challengeId: issued.challengeId, credential: "{}", name: "n" }, headers: as(IP.REG_5XX, baseURL!), maxRedirects: 0 });
    expect(fail.status()).toBe(503);
    expect(fail.headers()["set-cookie"]).toMatch(/solvelt_session=/);
    // Same challenge again, against an API that would accept anything: only the web-side binding can refuse it now.
    const again = await page.request.post("/account/passkeys", { form: { csrf, intent: "register", challengeId: issued.challengeId, credential: "{}", name: "n" }, headers: as(IP.REG_LENIENT, baseURL!), maxRedirects: 0 });
    expect(again.status()).toBe(400);
  });

  test("a sign-in challenge cannot complete a registration even against an API that accepts any ceremony", async ({ page, baseURL }) => {
    await signedIn(page, "kind2");
    const csrf = await csrfFor(page.request, "/account/passkeys");
    const issued = (await (await page.request.post("/passkeys/sign-in-options", { form: { csrf }, headers: { origin: baseURL! } })).json()) as Issued;
    const res = await page.request.post("/account/passkeys", { form: { csrf, intent: "register", challengeId: issued.challengeId, credential: "{}", name: "n" }, headers: as(IP.REG_LENIENT, baseURL!), maxRedirects: 0 });
    expect(res.status()).toBe(400); // lenient API would answer 201: this refusal is the web-side kind check
    expect(await res.text()).toContain("does not belong to this session");
  });
});

test.describe("name fields are cleaned on every route that takes them", () => {
  test("profile name and sign-up name lose control and bidi characters but keep real names intact", async ({ page, browser, baseURL }) => {
    await signedIn(page, "cleanprof");
    const csrf = await csrfFor(page.request, "/account/profile");
    const save = await page.request.post("/account/profile", { form: { csrf, displayName: "Dana\u202e\u200b\u0007 \u05e9\u05c1\u05b8\u05dc\u05d5\u05b9\u05dd \u{1f468}\u200d\u{1f469}\u200d\u{1f467}", phone: "+972\u202e 50 123 4567" }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(save.status()).toBe(302);
    await page.goto("/account/profile");
    await expect(page.getByLabel("Name")).toHaveValue("Dana \u05e9\u05c1\u05b8\u05dc\u05d5\u05b9\u05dd \u{1f468}\u200d\u{1f469}\u200d\u{1f467}");
    await expect(page.getByLabel("Phone (optional)")).toHaveValue("+972 50 123 4567");

    const ctx = await browser.newContext({ baseURL });
    const anon = await ctx.newPage();
    const email = uniqueEmail("cleansignup");
    const csrf2 = await csrfFor(anon.request, "/sign-up");
    const res = await anon.request.post("/sign-up", { form: { csrf: csrf2, displayName: "A\u202eB\u2028C", email, password: PASSWORD }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(res.status()).toBe(302);
    await anon.goto(`/verify-email?token=${await mailedToken(anon.request, "verify", email)}`);
    await anon.getByRole("button", { name: "Verify email" }).click();
    await expect(anon.getByRole("heading", { name: "Email verified" })).toBeVisible();
    await signIn(anon, email);
    await expect(anon.getByRole("heading", { name: "Hello, ABC" })).toBeVisible();
    await ctx.close();
  });
});
