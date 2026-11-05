import { expect, test, type Browser, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { MOCK, newVerifiedUser, PASSWORD, signIn, tokensOf, waitHydrated } from "./helpers";

/**
 * The web's own step-up (BFF) for the sensitive account actions added since review5: the data download, account deletion and the password page. Each must send a person whose last
 * sign-in is older than REAUTH_WINDOW_SECONDS to the password confirmation BEFORE the API is asked anything. A second server with a 5 second window runs the part under test; the setup
 * (sign-up, sign-in) runs on the main server, whose window is 10 minutes, so a slow machine can never push the setup past the short window. Both servers share the session secret.
 */
async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

async function withShortWindowServer(browser: Browser, baseURL: string | undefined, parallelIndex: number, tag: string,
  run: (a: { page: Page; email: string; port: number; at: (p: string) => string; apiCallsOf: (email: string) => Promise<string[]> }) => Promise<void>) {
  const port = 3215 + parallelIndex;
  const origin = `http://localhost:${port}`;
  const child = spawn("node", ["server.js"], {
    env: {
      PATH: process.env.PATH!, NODE_ENV: "production", PORT: String(port), API_BASE_URL: MOCK, PUBLIC_ORIGIN: origin, REAUTH_WINDOW_SECONDS: "5",
      SESSION_COOKIE_SECRET: "Pq8Vn2Ws6Zk0Jd4Lc9Rb3Hm7Ty1Fg5XeA8u", WEB_FORWARDING_KEY: "Mh3Xt7Bk1Qw5Zn9Vs2Dj6Lc0Rf4Pg8YaE1o",
    },
    stdio: "ignore",
  });
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`${origin}/healthz`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
    const email = await signedIn(page, tag);
    await page.waitForTimeout(5500);   // longer than the 5 s window of the second server
    // the calls this account's session made that CHANGE something or export something, as the mock API saw them (the last 8 characters of the bearer token tell sessions apart)
    const apiCallsOf = async (e: string) => {
      const [token] = await tokensOf(page.request, e);
      const seen = (await (await page.request.get(`${MOCK}/__test/seen`)).json()) as { method: string; path: string; tokenTail: string }[];
      return seen.filter((s) => s.tokenTail === token!.slice(-8) && s.method !== "GET").map((s) => `${s.method} ${s.path}`);
    };
    await run({ page, email, port, at: (p) => `${origin}${p}`, apiCallsOf });
  } finally {
    await context.close();
    child.kill();
  }
}

test.describe("sensitive account actions need a recent sign-in, decided by the web before the API is asked", () => {
  test("the data download sends an old session to the password page and asks the API for nothing", async ({ browser, baseURL }, testInfo) => {
    await withShortWindowServer(browser, baseURL, testInfo.parallelIndex, "stepexport", async ({ page, port, at, email, apiCallsOf }) => {
      await page.goto(at("/account/privacy"));
      await waitHydrated(page);
      const before = await apiCallsOf(email);
      await page.getByRole("button", { name: "Download my data" }).click();
      await expect(page).toHaveURL(new RegExp(`${port}/account/confirm\\?next=%2Faccount%2Fprivacy$`));
      expect(await apiCallsOf(email)).toEqual(before);                                           // no export was made, not even refused
      expect(before.some((c) => c.includes("data-export"))).toBe(false);
    });
  });

  test("deleting the account sends an old session to the password page and deletes nothing", async ({ browser, baseURL }, testInfo) => {
    await withShortWindowServer(browser, baseURL, testInfo.parallelIndex, "stepdelete", async ({ page, port, at, email, apiCallsOf }) => {
      await page.goto(at("/account/privacy"));
      await waitHydrated(page);
      const before = await apiCallsOf(email);
      await page.getByLabel(/I understand/).check();
      await page.getByLabel("Your password").fill(PASSWORD);
      await page.getByRole("button", { name: "Delete my account" }).click();
      await expect(page).toHaveURL(new RegExp(`${port}/account/confirm\\?next=%2Faccount%2Fprivacy$`));
      expect(await apiCallsOf(email)).toEqual(before);                                           // the API was never asked to delete anything
      // and the account is there: it still signs in
      const other = await page.context().browser()!.newContext({ baseURL });
      const p2 = await other.newPage();
      await signIn(p2, email);
      await expect(p2).toHaveURL(/\/account$/);
      await other.close();
    });
  });

  test("the password page sends an old session to the password confirmation and changes nothing", async ({ browser, baseURL }, testInfo) => {
    await withShortWindowServer(browser, baseURL, testInfo.parallelIndex, "steppass", async ({ page, port, at, email, apiCallsOf }) => {
      await page.goto(at("/account/password"));
      await waitHydrated(page);
      const before = await apiCallsOf(email);
      await page.getByLabel("Current password").fill(PASSWORD);
      await page.getByLabel("New password").fill("a brand new long password");
      await page.getByRole("button", { name: "Change password" }).click();
      await expect(page).toHaveURL(new RegExp(`${port}/account/confirm\\?next=%2Faccount%2Fpassword$`));
      expect(await apiCallsOf(email)).toEqual(before);                                           // nothing was sent to the API
      const other = await page.context().browser()!.newContext({ baseURL });
      const p2 = await other.newPage();
      await signIn(p2, email);                                                                    // the OLD password still works
      await expect(p2).toHaveURL(/\/account$/);
      await other.close();
    });
  });
});
