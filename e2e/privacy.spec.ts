import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { newVerifiedUser, PASSWORD, signIn } from "./helpers";

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

test("anonymous visitors are sent to sign-in, and the export route is not a link anyone can follow", async ({ page }) => {
  await page.goto("/account/privacy");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  await page.goto("/account/privacy/export");
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});

test("the data download is a file with the signed-in buyer's own data, made by a form POST", async ({ page }) => {
  const email = await signedIn(page, "pexport");
  await page.goto("/account/privacy");
  await expect(page.getByRole("heading", { name: "Download my data" })).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download my data" }).click()]);
  expect(download.suggestedFilename()).toBe("solvelt-my-data.json");
  const path = await download.path();
  const json = JSON.parse((await import("node:fs")).readFileSync(path!, "utf8"));
  expect(json.sections.account.profile.email).toBe(email);
  expect(Object.keys(json.sections).sort()).toEqual(["account", "bookings", "cancellations-and-returns", "carts", "messages", "notifications", "orders", "passkeys", "tracking"]);
  // a GET of the export route never makes a file
  await page.goto("/account/privacy/export");
  await expect(page).toHaveURL(/\/account\/privacy$/);
  // a second download within ten minutes is refused by the API, and the page says when, instead of "try again"
  await page.getByRole("button", { name: "Download my data" }).click();
  await expect(page.getByText("You can download your data once every ten minutes. Please try again later.")).toBeVisible();
  await expect(page.getByText("We could not prepare your file")).toHaveCount(0);
});

test("deleting the account needs the tick and the right password, then signs the browser out for good", async ({ page }) => {
  const email = await signedIn(page, "pdelete");
  await page.goto("/account/privacy");
  const del = page.getByRole("button", { name: "Delete my account" });
  await page.getByLabel("Your password").fill("anything at all");
  await del.click();
  await expect(page.getByText("Tick the box to confirm.").first()).toBeVisible();
  await page.getByLabel(/I understand/).check();
  await page.getByLabel("Your password").fill("not the password");
  await del.click();
  await expect(page.getByText("The password is not correct.").first()).toBeVisible();
  await expect(page).toHaveURL(/\/account\/privacy$/);                                          // still signed in, nothing deleted
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account$/);
  await page.goto("/account/privacy");
  await page.getByLabel(/I understand/).check();
  await page.getByLabel("Your password").fill(PASSWORD);
  await del.click();
  await expect(page).toHaveURL(/\/\?account=deleted$|\/$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=/);                                             // signed out
  await signIn(page, email).catch(() => undefined);
  await expect(page).not.toHaveURL(/\/account$/);                                               // and the account is gone: signing in no longer works
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: privacy page (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    await signedIn(page, `paxe${theme}`);
    await page.goto("/account/privacy");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations, JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((x) => x.target) })))).toEqual([]);
  });
}
