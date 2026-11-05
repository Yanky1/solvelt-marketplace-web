import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, newVerifiedUser, signIn, waitHydrated } from "./helpers";

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}
async function seedThread(page: Page, email: string) {
  return ((await (await page.request.get(`${MOCK}/__test/seed-thread?email=${encodeURIComponent(email)}`)).json()) as { id: string }).id;
}

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  for (const path of ["/account/messages", "/account/messages/abc", "/account/messages/new?order=MP-1"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  }
});

test("the inbox shows the thread with its unread count, opening it marks the seller's message read", async ({ page }) => {
  const email = await signedIn(page, "minbox");
  await page.goto("/account/messages");
  await expect(page.getByRole("heading", { name: "No messages yet" })).toBeVisible();
  const id = await seedThread(page, email);
  await page.goto("/account/messages");
  await expect(page.getByText("1 unread", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Challah Corner: Order MP-E2E-1/ })).toBeVisible();
  // the page marks the thread read from the browser after it hydrates: wait for that request to finish before leaving (leaving early raced it in CI)
  const markedRead = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/account/messages/${id}`));
  await page.getByRole("link", { name: /Challah Corner: Order MP-E2E-1/ }).click();
  await expect(page).toHaveURL(new RegExp(`/account/messages/${id}$`));
  await waitHydrated(page);
  await expect(page.getByText("Yes, it is nut free. Photo attached.")).toBeVisible();
  await markedRead;
  await page.goto("/account/messages");
  await expect(page.getByText(/\d+ unread/)).toHaveCount(0);                                  // marked read by the page itself
});

test("attachments are downloads, served from our address with nosniff, and a removed file is only named", async ({ page }) => {
  const email = await signedIn(page, "matt");
  const id = await seedThread(page, email);
  await page.goto(`/account/messages/${id}`);
  const link = page.getByRole("link", { name: /ingredients\.pdf/ });
  await expect(link).toHaveAttribute("href", /^\/account\/messages\/attachments\//);
  await expect(page.getByText(/removed\.png \(removed for your safety/)).toBeVisible();
  const res = await page.request.get((await link.getAttribute("href"))!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename="ingredients\.pdf"$/);
  expect(res.headers()["content-type"]).toBe("application/pdf");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["content-security-policy"]).toContain("default-src 'none'");
  expect(res.headers()["cache-control"]).toContain("no-store");
});

test("writing to a seller: a warning for contact details keeps the text and needs a confirmation", async ({ page }) => {
  await signedIn(page, "mwrite");
  await page.goto("/account/messages/new?order=MP-E2E-9&seller=SO-1");
  await waitHydrated(page);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Write a message.").first()).toBeVisible();
  await page.getByLabel("Your message").fill("Call me at jane@example.com please");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/Your message seems to include an email address/)).toBeVisible();
  await expect(page.getByLabel("Your message")).toHaveValue("Call me at jane@example.com please");
  await page.getByLabel("Send it anyway").check();
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/account\/messages\/[a-f0-9]+$/);
  await expect(page.getByText("Call me at jane@example.com please")).toBeVisible();
  await expect(page.getByText("Sending…")).toBeVisible();                                    // stored first, delivered by the outbox
  await page.getByLabel("Your reply").fill("Thanks!");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Thanks!")).toBeVisible();
});

test("a booking thread starts from a booking, names the provider, and links back to the booking", async ({ page }) => {
  await signedIn(page, "mbook");
  await page.goto("/account/messages/new?booking=BK-E2E-1");
  await waitHydrated(page);
  await expect(page.getByRole("heading", { name: "Message the provider about booking BK-E2E-1" })).toBeVisible();
  await page.getByLabel("Your message").fill("Can we move the start by ten minutes?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(/\/account\/messages\/[a-f0-9]+$/);
  await expect(page.getByRole("link", { name: "View this booking" })).toHaveAttribute("href", "/bookings/BK-E2E-1");
  await page.goto("/account/messages/new?booking=%3Cx%3E");
  await expect(page.getByText("Not found").first()).toBeVisible();
});

test("a message from a seller can be reported once with a reason", async ({ page }) => {
  const email = await signedIn(page, "mreport");
  const id = await seedThread(page, email);
  await page.goto(`/account/messages/${id}`);
  await waitHydrated(page);
  await page.getByText("Report this message").click();
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Say what is wrong.")).toBeVisible();
  await page.getByLabel("What is wrong?").fill("Asks me to pay elsewhere");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("We sent your report to our moderators.")).toBeVisible();
  await expect(page.getByText("You reported this message.")).toBeVisible();
  const reports = (await (await page.request.get(`${MOCK}/__test/reports`)).json()) as { reason: string }[];
  expect(reports.some((r) => r.reason === "Asks me to pay elsewhere")).toBeTruthy();
});

test("another buyer's thread and attachment are a 404", async ({ page, browser }) => {
  const email = await signedIn(page, "mown");
  const id = await seedThread(page, email);
  await page.goto(`/account/messages/${id}`);
  const href = (await page.getByRole("link", { name: /ingredients\.pdf/ }).getAttribute("href"))!;
  const ctx2 = await browser.newContext({ baseURL: page.url().split("/account")[0] });
  const page2 = await ctx2.newPage();
  await signedIn(page2, "mother");
  expect((await page2.goto(`/account/messages/${id}`))!.status()).toBe(404);
  expect((await page2.request.get(href)).status()).toBe(404);
  await ctx2.close();
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: messages pages (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    const email = await signedIn(page, `maxe${theme}`);
    const id = await seedThread(page, email);
    for (const path of ["/account/messages", `/account/messages/${id}`, "/account/messages/new?order=MP-E2E-1&seller=SO-1"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      for (const d of await page.locator("details").all()) await d.evaluate((el: HTMLDetailsElement) => { el.open = true; });
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, `${path}: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((x) => x.target) })))}`).toEqual([]);
    }
  });
}
