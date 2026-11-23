import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, PASSWORD, uniqueEmail } from "./helpers";

/**
 * W3 item 2 (API W3-02, DESIGN W3-02): an account made on a phone call (no email, no password) signs in on the website with a code texted to its number, then adds a confirmed email and a
 * password (or a passkey). The first step never says whether the number has an account.
 */
/** A fresh random number per test: the mock is shared by the parallel workers, so numbers must not collide (0429 is the mock's rate-limited number). */
const freshNumber = (): string => { const seven = String(Math.floor(Math.random() * 9_000_000) + 1_000_000); return seven.endsWith("0429") ? freshNumber() : `718${seven}`; };

async function phoneAccount(page: Page, number: string, name = "Dana Levi") {
  const r = await page.request.get(`${MOCK}/__test/phone-account?phone=${number}&name=${encodeURIComponent(name)}`);
  expect(r.ok()).toBeTruthy();
}
async function smsCode(page: Page, number: string): Promise<string> {
  const { code } = (await (await page.request.get(`${MOCK}/__test/sms?phone=${number}`)).json()) as { code: string | null };
  expect(code).toMatch(/^\d{6}$/);
  return code!;
}
async function signInByText(page: Page, number: string) {
  await page.goto("/sign-in/phone");
  await page.getByLabel("Phone number").fill(number);
  await page.getByRole("button", { name: "Text me a code" }).click();
  await expect(page.getByTestId("code-sent")).toContainText(number.slice(-4));
  await page.getByLabel("Six-digit code").fill(await smsCode(page, number));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);   // the session cookie is set before the next page is asked for
}

test.describe("an account made by phone on the website", () => {
  test("signs in with a text message from the sign-in page", async ({ page }) => {
    const number = freshNumber();
    await phoneAccount(page, number);
    await page.goto("/sign-in");
    await page.getByRole("link", { name: "Get a code by text message" }).click();
    await expect(page).toHaveURL(/\/sign-in\/phone/);
    await page.getByLabel("Phone number").fill(`(${number.slice(0, 3)}) ${number.slice(3, 6)}-${number.slice(6)}`);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByTestId("code-sent")).toBeVisible();
    await page.getByLabel("Six-digit code").fill(await smsCode(page, number));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);
  });

  test("a wrong code is said plainly, and a number without an account is told only after its code", async ({ page }) => {
    const number = freshNumber();
    await phoneAccount(page, number);
    await page.goto("/sign-in/phone");
    await page.getByLabel("Phone number").fill(number);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByTestId("code-sent")).toBeVisible();
    const right = await smsCode(page, number);
    await page.getByLabel("Six-digit code").fill(right === "000000" ? "111111" : "000000");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("[data-error-summary]")).toContainText("That code is not correct");
    await page.getByLabel("Six-digit code").fill(right);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);

    const stranger = freshNumber();   // no account: the first step answers exactly the same
    await page.context().clearCookies();
    await page.goto("/sign-in/phone");
    await page.getByLabel("Phone number").fill(stranger);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByTestId("code-sent")).toContainText("If an account can use it");
    await page.getByLabel("Six-digit code").fill(await smsCode(page, stranger));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("[data-error-summary]")).toContainText("No account signs in with this number");
  });

  test("adds a confirmed email, then a password, and then signs in with them", async ({ page }) => {
    const number = freshNumber();
    const email = uniqueEmail("phone-made");
    await phoneAccount(page, number);
    await signInByText(page, number);
    await page.goto("/account/sign-in-methods");
    await expect(page.getByTestId("email-status")).toContainText("no email address yet");
    await expect(page.getByTestId("password-status")).toContainText("Add and confirm an email address first");
    await expect(page.getByTestId("phone-status")).toContainText(number.slice(-4));
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Add email address" }).click();
    await expect(page.locator("p[role=status]")).toContainText("We sent a link to that address");
    await expect(page.getByTestId("email-status")).toContainText(email);
    await expect(page.getByRole("button", { name: "Send the link again" })).toBeVisible();

    expect((await page.request.get(`${MOCK}/__test/confirm-pending-email?phone=${number}`)).status()).toBe(204);   // the link in the mail, opened
    await page.reload();
    await expect(page.getByTestId("email-status")).toContainText(`You sign in with ${email}`);
    await page.getByLabel("New password").fill(PASSWORD);
    await page.getByRole("button", { name: "Set password" }).click();
    await expect(page.locator("p[role=status]")).toContainText("Password set");
    await expect(page.getByTestId("password-status")).toContainText("Your account has a password");

    await page.context().clearCookies();
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
  });

  test("confirms it is them with a text message instead of a password", async ({ page }) => {
    const number = freshNumber();
    await phoneAccount(page, number);
    await signInByText(page, number);
    await page.goto(`/account/confirm?next=${encodeURIComponent("/account/sign-in-methods")}`);
    await expect(page.getByRole("heading", { name: "Confirm it is you" })).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveCount(0);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByTestId("code-sent")).toBeVisible();
    await page.getByLabel("Six-digit code").fill(await smsCode(page, number));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page).toHaveURL(/\/account\/sign-in-methods$/);
  });

  test("the text-message page links back to the email sign-in", async ({ page }) => {
    await page.goto("/sign-in/phone");
    await expect(page.getByRole("link", { name: "Sign in with your email" })).toHaveAttribute("href", "/sign-in");
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: phone sign-in, both steps, and sign-in methods (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    const axe = async () => {
      await expect(page.locator("body")).toHaveCSS("background-color", theme === "dark" ? "rgb(7, 22, 18)" : "rgb(244, 246, 244)");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, JSON.stringify(results.violations.map((x) => ({ id: x.id, nodes: x.nodes.map((nd) => nd.target) })), null, 1)).toEqual([]);
    };
    const number = freshNumber();
    await phoneAccount(page, number);
    await page.goto("/sign-in/phone");
    await axe();
    await page.getByLabel("Phone number").fill(number);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByTestId("code-sent")).toBeVisible();
    await axe();
    await page.getByLabel("Six-digit code").fill("12");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("[data-error-summary]")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await axe();
    await page.getByLabel("Six-digit code").fill(await smsCode(page, number));
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.goto("/account/sign-in-methods");
    await axe();
  });
}
