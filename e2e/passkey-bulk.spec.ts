import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, PASSWORD, newVerifiedUser, signIn, tokensOf, waitHydrated } from "./helpers";

const addPasskeys = (page: Page, email: string, count: number) => page.request.get(`${MOCK}/__test/add-passkeys?email=${encodeURIComponent(email)}&count=${count}`);
/** A verified user who is signed in (newVerifiedUser only verifies the address). */
async function signedInUser(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).not.toHaveURL(/\/sign-in/);
  return email;
}
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("remove all passkeys: link needs two or more, confirm page cancels and removes", async ({ page }) => {
  const email = await signedInUser(page, "bulk");
  await addPasskeys(page, email, 1);
  await page.goto("/account/passkeys");
  await expect(page.getByRole("link", { name: "Remove all passkeys" })).toHaveCount(0);
  await addPasskeys(page, email, 2);
  await page.goto("/account/passkeys");
  await page.getByRole("link", { name: "Remove all passkeys" }).click();
  await expect(page.getByRole("heading", { name: "Remove all passkeys?" })).toBeVisible();
  expect((await axe(page)).violations).toEqual([]);
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/account\/passkeys$/);
  await page.goto("/account/passkeys/remove-all");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Remove all passkeys" }).click();
  await expect(page).toHaveURL(/\/account\/passkeys\?done=all-removed$/);
  await expect(page.getByText("All passkeys removed. You sign in with your password now.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "No passkeys yet" })).toBeVisible();
  await page.goto("/account/passkeys/remove-all");
  await expect(page).toHaveURL(/\/account\/passkeys$/);   // nothing left to remove
});

test("remove all passkeys: an API without the route says so", async ({ page }) => {
  const email = await signedInUser(page, "bulk-legacyapi");
  await addPasskeys(page, email, 2);
  await page.goto("/account/passkeys/remove-all");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Remove all passkeys" }).click();
  await expect(page.getByText("not available yet")).toBeVisible();
});

test("remove all passkeys: a passkey-only account keeps them", async ({ page }) => {
  const email = await signedInUser(page, "bulk-nopassword");
  await addPasskeys(page, email, 2);
  await page.goto("/account/passkeys/remove-all");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Remove all passkeys" }).click();
  await expect(page.getByText("only way you can sign in")).toBeVisible();
});

test("remove all passkeys: the API's recent sign-in check sends you to confirm, then it works", async ({ page }) => {
  const email = await signedInUser(page, "bulk-reauthapi");
  await addPasskeys(page, email, 2);
  await page.goto("/account/passkeys/remove-all");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Remove all passkeys" }).click();
  await expect(page).toHaveURL(/\/account\/confirm\?next=%2Faccount%2Fpasskeys%2Fremove-all/);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /confirm|continue/i }).click();
  await expect(page).toHaveURL(/\/account\/passkeys\/remove-all$/);
  await page.getByRole("button", { name: "Remove all passkeys" }).click();
  await expect(page).toHaveURL(/done=all-removed$/);
});

test("password page: validation, success, passwords never echoed, new password signs in", async ({ page }) => {
  const email = await signedInUser(page, "pw");
  await page.goto("/account/password");
  await waitHydrated(page);
  expect((await axe(page)).violations).toEqual([]);
  await page.getByLabel("Current password").fill("wrong wrong wrong wrong");
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/current password/i).first()).toBeVisible();
  expect(await page.content()).not.toContain("a brand new long password");
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("short");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/at least 12/i).first()).toBeVisible();
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed. Your other devices were signed out.")).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, email, "a brand new long password");
  await expect(page).not.toHaveURL(/\/sign-in/);
});

test("password page: the passkeys box removes them, unticked keeps them, an old API says kept", async ({ page }) => {
  const email = await signedInUser(page, "pwkeys");
  await addPasskeys(page, email, 2);
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("another long password 1");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText("Password changed. Your other devices were signed out.")).toBeVisible();
  await page.goto("/account/passkeys");
  await expect(page.locator("main li")).toHaveCount(2);

  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill("another long password 1");
  await page.getByLabel("New password").fill("another long password 2");
  await page.getByLabel("Also remove my passkeys").check();
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/your passkeys were removed/)).toBeVisible();
  await page.goto("/account/passkeys");
  await expect(page.getByRole("heading", { name: "No passkeys yet" })).toBeVisible();
});

test("password page: an API that ignores removePasskeys gets the honest notice", async ({ page }) => {
  const email = await signedInUser(page, "pw-legacyapi");
  await addPasskeys(page, email, 1);
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("another long password 1");
  await page.getByLabel("Also remove my passkeys").check();
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/could not be removed this way/)).toBeVisible();
});

test("password page needs an account", async ({ page }) => {
  await page.goto("/account/password");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fpassword/);
  await page.goto("/account/passkeys/remove-all");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test("password page: the API's 429 is shown with the wait it asked for (LOW-3)", async ({ page }) => {
  await signedInUser(page, "pw-ratelimit");
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("Too many attempts. Please wait about 42 seconds and try again.");
});

test("password page: a 409 (the account changed meanwhile) drops the dead cookie and goes to sign-in (LOW-3)", async ({ page }) => {
  const email = await signedInUser(page, "pw-acctchanged");
  const [token] = await tokensOf(page.request, email);
  const callsWith = async () => ((await (await page.request.get(`${MOCK}/__test/seen`)).json()) as { tokenTail: string }[]).filter((s) => s.tokenTail === token!.slice(-8)).length;
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fpassword/);
  // the cookie that was sent back carries no session any more: an account page goes to sign-in at once, and the dead token is never sent to the API again
  const before = await callsWith();
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  expect(await callsWith()).toBe(before);
});

test("password page: a session the API no longer knows goes to sign-in instead of showing the page (LOW-4)", async ({ page, browser, baseURL }) => {
  const email = await signedInUser(page, "pw-dead");
  // a second browser signs in and changes the password: the API ends every other session, including the first one's
  const other = await browser.newContext({ baseURL });
  const p2 = await other.newPage();
  await signIn(p2, email);
  await p2.goto("/account/password");
  await waitHydrated(p2);
  await p2.getByLabel("Current password").fill(PASSWORD);
  await p2.getByLabel("New password").fill("a brand new long password");
  await p2.getByRole("button", { name: "Change password" }).click();
  await expect(p2.getByText("Password changed. Your other devices were signed out.")).toBeVisible();
  await other.close();
  await page.goto("/account/password");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount%2Fpassword/);
});

test("password page: when the passkey read-back fails the notice says it could not confirm, not that they were kept (LOW-6)", async ({ page }) => {
  const email = await signedInUser(page, "pw-unconfirmed");
  await addPasskeys(page, email, 1);
  await page.goto("/account/password");
  await waitHydrated(page);
  await page.getByLabel("Current password").fill(PASSWORD);
  await page.getByLabel("New password").fill("a brand new long password");
  await page.getByLabel("Also remove my passkeys").check();
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByText(/couldn't confirm whether your passkeys were removed/)).toBeVisible();
  await expect(page.getByText(/could not be removed this way/)).toHaveCount(0);
});
