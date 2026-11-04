import { expect, test, type Page } from "@playwright/test";
import { csrfFor, MOCK, mailedToken, PASSWORD, signIn, signUp, tokensOf, uniqueEmail, verifyEmail, waitHydrated } from "./helpers";

const SUMMARY = (page: Page) => page.getByRole("group", { name: "There is a problem" });

async function openVerify(page: Page, email: string) {
  const token = await mailedToken(page.request, "verify", email);
  await page.goto(`/verify-email?token=${token}`);
  await waitHydrated(page);
  return token;
}

test.describe("verify-email needs the password chosen at sign-up (O-16)", () => {
  test("a wrong password gets the generic answer and leaves the link valid; the right password then works", async ({ page }) => {
    const email = uniqueEmail("o16wrong");
    await signUp(page, email);
    await openVerify(page, email);
    await page.getByLabel("Password").fill("definitely not my password");
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(SUMMARY(page)).toContainText("could not verify your email with that password and link");
    await expect(page.getByRole("link", { name: "Request a new verification link" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Forgot your password?" })).toBeVisible();
    // still unverified, and the SAME link still works with the right password
    await signIn(page, email);
    await expect(SUMMARY(page)).toContainText("verify your email");
    await openVerify(page, email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
  });

  test("a wrong password and a bad link look exactly the same (nothing to tell them apart)", async ({ page }) => {
    const email = uniqueEmail("o16same");
    await signUp(page, email);
    await openVerify(page, email);
    await page.getByLabel("Password").fill("wrong wrong wrong");
    await page.getByRole("button", { name: "Verify email" }).click();
    const wrongPassword = (await SUMMARY(page).textContent()) ?? "";
    await page.goto("/verify-email?token=thisisnotarealtoken");
    await waitHydrated(page);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Verify email" }).click();
    const badLink = (await SUMMARY(page).textContent()) ?? "";
    expect(badLink).toBe(wrongPassword);
  });

  test("an empty password is asked for, not sent as a verification attempt", async ({ page }) => {
    const email = uniqueEmail("o16empty");
    await signUp(page, email);
    await openVerify(page, email);
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    await expect(SUMMARY(page)).toContainText("Enter the password you chose when you signed up.");
  });

  test("the per-address limit is surfaced after repeated wrong passwords", async ({ page }) => {
    const email = uniqueEmail("o16limit");
    await signUp(page, email);
    await openVerify(page, email);
    for (let i = 0; i < 8; i++) {
      await page.getByLabel("Password").fill(`wrong password ${i}`);
      await page.getByRole("button", { name: "Verify email" }).click();
      await expect(SUMMARY(page)).toContainText("could not verify your email");
    }
    await page.getByLabel("Password").fill(PASSWORD); // even the right one waits (the limit belongs to the address)
    await page.getByRole("button", { name: "Verify email" }).click();
    await expect(SUMMARY(page)).toContainText("Too many attempts");
  });

  test("a successful password reset also verifies the address, so sign-in works without the verify step", async ({ page }) => {
    const email = uniqueEmail("o16reset");
    await signUp(page, email);
    await page.goto("/forgot-password");
    await waitHydrated(page);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.locator("p[role='status']")).toBeVisible();
    await page.goto(`/reset-password?token=${await mailedToken(page.request, "reset", email)}`);
    await waitHydrated(page);
    await page.getByLabel("New password").fill("a brand new passphrase 99");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.getByRole("heading", { name: "Password changed" })).toBeVisible();
    await signIn(page, email, "a brand new passphrase 99");
    await expect(page).toHaveURL(/\/account$/); // never clicked a verification link
  });

  test("the forgot-password link on the verify page leads to the reset flow", async ({ page }) => {
    const email = uniqueEmail("o16link");
    await signUp(page, email);
    await openVerify(page, email);
    await page.getByRole("link", { name: "Forgot your password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
  });
});

test.describe("step-up goes through the API's reauthenticate endpoint", () => {
  test("a correct password refreshes the API session's clock without replacing the session", async ({ page, request }) => {
    const email = uniqueEmail("o16step");
    await signUp(page, email);
    await verifyEmail(page, email);
    await signIn(page, email);
    await expect(page).toHaveURL(/\/account$/);
    const [token] = await tokensOf(request, email);
    const clock = async () => ((await (await request.get(`${MOCK}/__test/auth-at?token=${token}`)).json()) as { authAt: number | null }).authAt;
    expect(await clock()).toBeNull(); // sign-in set the sign-in clock, the step-up clock has not been used yet

    const csrf = await csrfFor(page.request, "/account/confirm");
    const wrong = await page.request.post("/account/confirm", { form: { csrf, password: "nope nope nope", next: "/account/passkeys" }, headers: { origin: page.url().split("/account")[0]! }, maxRedirects: 0 });
    expect(wrong.status()).toBe(401);
    expect(await clock()).toBeNull(); // a wrong password never touches the clock
    const ok = await page.request.post("/account/confirm", { form: { csrf, password: PASSWORD, next: "/account/passkeys" }, headers: { origin: page.url().split("/account")[0]! }, maxRedirects: 0 });
    expect(ok.status()).toBe(302);
    expect(ok.headers()["location"]).toBe("/account/passkeys");
    expect(await clock()).not.toBeNull();
    expect(await tokensOf(request, email)).toEqual([token]); // same API session: no new token was issued
  });

  test("an API 429 on the step-up is shown as too many attempts and does not count as a wrong password", async ({ page }) => {
    const email = uniqueEmail("o16step429");
    await signUp(page, email);
    await verifyEmail(page, email);
    await signIn(page, email);
    await page.goto("/account/confirm");
    await waitHydrated(page);
    await page.getByLabel("Password").fill("trigger-429");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(SUMMARY(page)).toContainText("Too many attempts");
  });
});
