import { expect, test, type Page } from "@playwright/test";
import { waitHydrated } from "./helpers";

/**
 * A refused form post says what to do when the cause is the browser's connection to the site (it was opened at another address, or the session cookie never
 * came back) and keeps the plain "stale form" text otherwise (e2e/review.spec.ts). Both causes are real here, not simulated headers: the cookies are cleared
 * after the page loaded, and the site is opened at 127.0.0.1 while its public origin is localhost.
 */
async function fillSignIn(page: Page) {
  await waitHydrated(page);
  await page.getByLabel("Email").fill("a@example.test");
  await page.getByLabel("Password").fill("whatever");
}

test("the session cookie did not come back: the page says to check cookies and the secure address", async ({ page, context }) => {
  await page.goto("/sign-in");
  await fillSignIn(page);
  await context.clearCookies();                                                     // what a dropped Secure cookie looks like to the server: a post with no session
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Please try again" })).toBeVisible();
  await expect(page.getByText(/did not send back its session cookie/)).toBeVisible();
  await expect(page.getByText(/secure \(https\) address/)).toBeVisible();
});

test("the site was opened at another address than its own: the page says to use the official address", async ({ page, baseURL }) => {
  const other = new URL("/sign-in", baseURL);
  other.hostname = "127.0.0.1";                                                     // the same server, another origin than its PUBLIC_ORIGIN (localhost)
  await page.goto(other.toString());
  await fillSignIn(page);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Please try again" })).toBeVisible();
  await expect(page.getByText(/not the site's own/)).toBeVisible();
  await expect(page.getByText(/official address/)).toBeVisible();
});
