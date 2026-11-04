import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, newVerifiedUser, signIn } from "./helpers";

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}
const seed = (page: Page, email: string, kind: string, order = "MP-E2E-1") => page.request.get(`${MOCK}/__test/seed-notification?email=${encodeURIComponent(email)}&kind=${kind}&order=${order}`);

test("anonymous visitors are sent to sign-in", async ({ page }) => {
  for (const path of ["/account/notifications", "/account/notifications/preferences"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in\?next=/);
  }
});

test("the centre lists notifications, opens one (marks it read and goes to its order) and marks all read", async ({ page }) => {
  const email = await signedIn(page, "ncentre");
  await page.goto("/account/notifications");
  await expect(page.getByRole("heading", { name: "Nothing new" })).toBeVisible();
  const o = await page.request.get(`${MOCK}/__test/seed-order?email=${encodeURIComponent(email)}&status=shipped`);
  const order = ((await o.json()) as { number: string }).number;
  await seed(page, email, "order_shipped", order);
  await seed(page, email, "order_delivered", order);
  await page.goto("/account/notifications");
  await expect(page.getByText("2 unread")).toBeVisible();
  await expect(page.getByText(`Challah Corner shipped order ${order} with USPS.`)).toBeVisible();
  await page.getByRole("button", { name: "View and mark as read" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/account/orders/${order}$`));
  await page.goto("/account/notifications");
  await expect(page.getByText("1 unread")).toBeVisible();
  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByText(/unread/)).toHaveCount(0);
});

test("email settings: all on by default, saved per category", async ({ page }) => {
  const email = await signedIn(page, "nprefs");
  await page.goto("/account/notifications/preferences");
  for (const label of ["Order accepted", "Shipped", "Out for delivery", "Delivered", "Messages", "Booking reminders"]) await expect(page.getByLabel(new RegExp(`^${label}`))).toBeChecked();
  await page.getByLabel(/^Shipped/).uncheck();
  // the mandatory mail (O-21) is shown as always on and cannot be edited, and a save never carries it
  for (const label of ["Refunds", "Cancellations", "Delivery problems", "Returns", "Booking changes"]) { const box = page.getByLabel(new RegExp(`^${label}`)); await expect(box).toBeChecked(); await expect(box).toBeDisabled(); }
  await expect(page.getByText("Required for your orders and account.")).toBeVisible();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
  await expect(page.getByLabel(/^Shipped/)).not.toBeChecked();
  await expect(page.getByLabel(/^Delivered/)).toBeChecked();
  const stored = (await (await page.request.get(`${MOCK}/__test/prefs?email=${encodeURIComponent(email)}`)).json()) as Record<string, boolean>;
  expect(stored.shipped).toBe(false);
  expect(stored.refunds).toBeUndefined();
  expect(stored.delivered).toBe(true);
});

test("an unsubscribe link needs a click to confirm, drops the token from the address, and only switches mail off", async ({ page }) => {
  const email = await signedIn(page, "nunsub");
  const token = `U.${email}.delivered`;
  const posts: string[] = [];
  page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });
  await page.goto(`/unsubscribe?token=${encodeURIComponent(token)}`);
  await page.getByRole("button", { name: "Stop these emails" }).waitFor();
  await page.waitForTimeout(500);                                                          // give any auto-submit time to show itself
  expect(posts).toEqual([]);                                                               // loading the page sent no POST at all (review P3)
  expect((await (await page.request.get(`${MOCK}/__test/unsub-calls?token=${encodeURIComponent(token)}`)).json()).calls).toBe(0);   // and the API was never called
  const stored = async () => (await (await page.request.get(`${MOCK}/__test/prefs?email=${encodeURIComponent(email)}`)).json()) as Record<string, boolean> | null;
  expect(await stored()).toBeNull();                                                       // opening the link changed nothing (scanners and prefetchers)
  await expect(page).toHaveURL(/\/unsubscribe$/);                                          // the token left the address bar
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByRole("heading", { name: "You are unsubscribed" })).toBeVisible();
  expect((await stored())!.delivered).toBe(false);
  expect((await stored())!.shipped).toBe(true);
  // a bad link says so and changes nothing
  await page.goto(`/unsubscribe?token=${encodeURIComponent("U.nobody@example.test.shipped.x")}`);
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByText("This link is not valid.")).toBeVisible();
  // an expired link says so and points to the signed-in settings; it changes nothing
  const expired = `U.${email}.shipped.expired`;
  const callsOf = async () => (await (await page.request.get(`${MOCK}/__test/unsub-calls?token=${encodeURIComponent(expired)}`)).json()).calls as number;
  expect(await callsOf()).toBe(0);
  await page.goto(`/unsubscribe?token=${encodeURIComponent(expired)}`);
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  await expect(page.getByRole("link", { name: "email settings" })).toHaveAttribute("href", "/account/notifications/preferences");
  expect(await callsOf()).toBe(1);
  expect((await stored())!.shipped).toBe(true);
  // the page is not cached and does not leak the token in a referrer
  const res = await page.request.get("/unsubscribe?token=abc");
  expect(res.headers()["referrer-policy"]).toBe("no-referrer");
  expect(res.headers()["cache-control"]).toContain("no-store");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: notifications pages (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    const email = await signedIn(page, `naxe${theme}`);
    await seed(page, email, "order_shipped");
    await seed(page, email, "message_received");
    for (const path of ["/account/notifications", "/account/notifications/preferences", "/unsubscribe?token=abc", "/unsubscribe"]) {
      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations, `${path}: ${JSON.stringify(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((x) => x.target) })))}`).toEqual([]);
    }
  });
}
