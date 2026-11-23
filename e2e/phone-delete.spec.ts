import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, newVerifiedUser, signIn } from "./helpers";

/**
 * W3 follow-up (API W3-06, DESIGN W3-06): an account made on a phone call has no password, so it deletes itself with a code texted for exactly that to its own number. An account with a
 * password still deletes with the password and is never offered a text message.
 */
const freshNumber = (): string => { const seven = String(Math.floor(Math.random() * 9_000_000) + 1_000_000); return seven.endsWith("0429") ? freshNumber() : `718${seven}`; };

async function phoneAccount(page: Page, number: string) {
  expect((await page.request.get(`${MOCK}/__test/phone-account?phone=${number}&name=Dana%20Levi`)).ok()).toBeTruthy();
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
  await expect(page).toHaveURL(/\/account$/);
}
async function askForDeleteCode(page: Page, number: string) {
  await page.goto("/account/privacy");
  await expect(page.getByLabel("Your password")).toHaveCount(0);                                   // no password field for an account without one
  await page.getByLabel(/I understand that my account/).check();
  await page.getByRole("button", { name: "Text me a code to delete my account" }).click();
  await expect(page.getByTestId("delete-code-sent")).toContainText(number.slice(-4));
}

test.describe("deleting an account made by phone", () => {
  test("deletes it with a code texted for that, signs out and cannot sign in again", async ({ page }) => {
    const number = freshNumber();
    await phoneAccount(page, number);
    await signInByText(page, number);
    await askForDeleteCode(page, number);
    await page.getByLabel("Six-digit code").fill(await smsCode(page, number));
    await page.getByLabel(/I understand that my account/).check();
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page).toHaveURL(/\/\?account=deleted$/);
    await page.goto("/account");
    await expect(page).toHaveURL(/\/sign-in/);                                                     // signed out

    await page.goto("/sign-in/phone");                                                             // the number no longer signs in (the answer looks the same, no code arrives)
    await page.getByLabel("Phone number").fill(number);
    await page.getByRole("button", { name: "Text me a code" }).click();
    await expect(page.getByTestId("code-sent")).toBeVisible();
    const before = await smsCode(page, number);                                                    // the last code texted is still the delete code
    await page.getByLabel("Six-digit code").fill(before);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).not.toHaveURL(/\/account$/);
  });

  test("a wrong code is said plainly and nothing is deleted; the box must be ticked", async ({ page }) => {
    const number = freshNumber();
    await phoneAccount(page, number);
    await signInByText(page, number);
    await page.goto("/account/privacy");
    await page.getByRole("button", { name: "Text me a code to delete my account" }).click();
    await expect(page.getByText("Tick the box to confirm.").first()).toBeVisible();

    await askForDeleteCode(page, number);
    const right = await smsCode(page, number);
    await page.getByLabel("Six-digit code").fill(right === "000000" ? "111111" : "000000");
    await page.getByLabel(/I understand that my account/).check();
    await page.getByRole("button", { name: "Delete my account" }).click();
    await expect(page.getByText("That code is not correct.").first()).toBeVisible();
    await expect(page.getByTestId("delete-code-sent")).toBeVisible();                              // still on the code step
    await page.goto("/account");
    await expect(page).toHaveURL(/\/account$/);                                                    // still signed in: nothing was deleted
  });

  test("an account with a password still deletes with it and is never offered a text message", async ({ page }) => {
    const email = await newVerifiedUser(page, "pwdelete");
    await signIn(page, email);
    await expect(page).toHaveURL(/\/account$/);
    await page.goto("/account/privacy");
    await expect(page.getByLabel("Your password")).toBeVisible();
    await expect(page.getByRole("button", { name: /Text me a code/ })).toHaveCount(0);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: deleting by text message, both steps (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    const number = freshNumber();
    await phoneAccount(page, number);
    await signInByText(page, number);
    await page.goto("/account/privacy");
    const scan = async () => {
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations, JSON.stringify(r.violations.map((x) => ({ id: x.id, nodes: x.nodes.map((n) => n.target) })), null, 1)).toEqual([]);
    };
    await scan();
    await askForDeleteCode(page, number);
    await scan();
  });
}
