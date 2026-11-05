import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { MOCK, PASSWORD, newVerifiedUser, signIn, tokensOf, waitHydrated } from "./helpers";

/**
 * After M1-87 the API ends EVERY session of the account when the password changes or a passkey is removed, and answers 200 { token } with a new session for the caller. The web must carry
 * on with that token (the person stays signed in) and replace the sealed cookie, so a copy of the old cookie, a stolen one say, is dead. The mock API's "tokenapi" accounts behave like that;
 * every other account still gets the old 204 (the other specs prove nothing changes for them).
 */
async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}
const addPasskeys = (page: Page, email: string, count: number) => page.request.get(`${MOCK}/__test/add-passkeys?email=${encodeURIComponent(email)}&count=${count}`);

/** A browser holding a COPY of the cookies the first one had before the change: what a thief would have. */
async function thiefWith(browser: Browser, baseURL: string | undefined, cookies: Parameters<BrowserContext["addCookies"]>[0]) {
  const ctx = await browser.newContext({ baseURL });
  await ctx.addCookies(cookies);
  return { ctx, page: await ctx.newPage() };
}

test("a password change on the new API keeps the person signed in on a new token and kills the old cookie", async ({ page, browser, baseURL }) => {
  const email = await signedIn(page, "rot-tokenapi-pw");
  const [oldToken] = await tokensOf(page.request, email);
  const stolen = await page.context().cookies();
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed. Your other devices were signed out.")).toBeVisible();
  // still signed in: an account page opens without a sign-in, and the API holds exactly one session, a new one
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  const after = await tokensOf(page.request, email);
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(oldToken);
  // the copy of the old cookie is dead
  const thief = await thiefWith(browser, baseURL, stolen);
  await thief.page.goto("/account");
  await expect(thief.page).toHaveURL(/\/sign-in\?next=/);
  await thief.ctx.close();
});

test("the passkey read-back after a password change uses the NEW token (so 'removed' is said, not 'could not confirm')", async ({ page }) => {
  const email = await signedIn(page, "rot-tokenapi-readback");
  await addPasskeys(page, email, 2);
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByLabel("Also remove my passkeys").check();
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/your passkeys were removed/)).toBeVisible();
  await expect(page.getByText(/couldn't confirm/)).toHaveCount(0);
});

test("removing one passkey on the new API keeps the person signed in on a new token and kills the old cookie", async ({ page, browser, baseURL }) => {
  const email = await signedIn(page, "rot-tokenapi-one");
  await addPasskeys(page, email, 2);
  const [oldToken] = await tokensOf(page.request, email);
  const stolen = await page.context().cookies();
  await page.goto("/account/passkeys");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Remove passkey Seeded passkey 1" }).click();
  await expect(page).toHaveURL(/\/account\/passkeys$/);
  await expect(page.locator("main li")).toHaveCount(1);                                         // removed, and the page loaded: the new token works
  const after = await tokensOf(page.request, email);
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(oldToken);
  const thief = await thiefWith(browser, baseURL, stolen);
  await thief.page.goto("/account/passkeys");
  await expect(thief.page).toHaveURL(/\/sign-in\?next=/);
  await thief.ctx.close();
});

test("removing all passkeys on the new API keeps the person signed in on a new token and kills the old cookie", async ({ page, browser, baseURL }) => {
  const email = await signedIn(page, "rot-tokenapi-all");
  await addPasskeys(page, email, 2);
  const [oldToken] = await tokensOf(page.request, email);
  const stolen = await page.context().cookies();
  await page.goto("/account/passkeys/remove-all");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Remove all passkeys" }).click();
  await expect(page).toHaveURL(/\/account\/passkeys\?done=all-removed$/);
  await expect(page.getByText("All passkeys removed.")).toBeVisible();
  const after = await tokensOf(page.request, email);
  expect(after).toHaveLength(1);
  expect(after[0]).not.toBe(oldToken);
  const thief = await thiefWith(browser, baseURL, stolen);
  await thief.page.goto("/account/passkeys");
  await expect(thief.page).toHaveURL(/\/sign-in\?next=/);
  await thief.ctx.close();
});

test("on an API that still answers 204 nothing changes: the cookie and the token stay", async ({ page }) => {
  const email = await signedIn(page, "rot-oldapi");
  const [oldToken] = await tokensOf(page.request, email);
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed. Your other devices were signed out.")).toBeVisible();
  expect(await tokensOf(page.request, email)).toEqual([oldToken]);
});
