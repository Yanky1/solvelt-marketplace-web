import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, newVerifiedUser, signIn, waitHydrated } from "./helpers";

const SERVICE = "/p/deep-house-cleaning";

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
}

/** From the service page: postal code, first day, first time. */
async function chooseTime(page: Page, postal = "11201") {
  await page.goto(SERVICE);
  await waitHydrated(page);
  const slot = page.getByTestId("booking-slot");
  await slot.getByLabel("Your postal code").fill(postal);
  await slot.getByRole("button", { name: "Show times" }).click();
  return slot;
}
async function pickFirst(page: Page) {
  const slot = page.getByTestId("booking-slot");
  await slot.getByRole("group", { name: "Choose a day" }).getByRole("button").first().click();
  await slot.getByRole("group", { name: /^Times on / }).getByRole("button").first().click();
  return slot;
}
async function fillAddress(page: Page) {
  const form = page.getByRole("form", { name: /^Book / });
  await form.getByLabel("Name").fill("Dana Levi");
  await form.getByLabel("Street address").fill("1 Main St");
  await form.getByLabel("City").fill("Brooklyn");
  await form.getByLabel("State or region").fill("NY");
  return form;
}

test.describe("booking a service", () => {
  test("the widget shows times by day in the provider's zone, and explains an area that is not served", async ({ page }) => {
    const slot = await chooseTime(page);
    await expect(slot.getByRole("group", { name: "Choose a day" })).toBeVisible();
    await expect(slot).toContainText("Times are shown in America/New York");
    await pickFirst(page);
    await expect(slot.getByRole("form", { name: /^Book / })).toBeVisible();
    const axe = await new AxeBuilder({ page }).include('[data-testid="booking-slot"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => v.id))).toEqual([]);
    await slot.getByLabel("Your postal code").fill("99999");
    await slot.getByRole("button", { name: "Show times" }).click();
    await expect(slot.getByTestId("availability-error")).toContainText("does not come to that postal code");
    await expect(slot.getByRole("form", { name: /^Book / })).toHaveCount(0);       // the old times are gone with the old answer
  });

  test("a time someone else took meanwhile says so and lets the buyer choose again", async ({ page }) => {
    await signedIn(page, "taken");
    const slot = await chooseTime(page);
    const days = slot.getByRole("group", { name: "Choose a day" }).getByRole("button");
    await days.last().click();
    await slot.getByRole("group", { name: /^Times on / }).getByRole("button").last().click();
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(slot.getByTestId("hold-error")).toContainText("Someone just took that time");
    await expect(page).toHaveURL(/\/p\/deep-house-cleaning/);
    await days.first().click();                                                        // and can pick another
    await expect(slot.getByRole("group", { name: /^Times on / })).toBeVisible();
  });

  test("a visitor who is not signed in is sent to sign in and back to the service page", async ({ page }) => {
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fp%2Fdeep-house-cleaning/);
  });

  test("a signed-in buyer holds a time, answers the questions, reaches the payment step, and later cancels", async ({ page }) => {
    await signedIn(page, "book");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "Hold");
    await expect(page.getByTestId("hold-countdown")).toContainText(/\d+:\d\d/);
    await page.getByLabel("Any pets at home?").selectOption("no");
    await page.getByRole("button", { name: /^Continue to payment/ }).click();
    await expect(page.getByTestId("payment-step")).toBeVisible();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => v.id))).toEqual([]);
    // the webhook confirms it; the page shows the API's status, not what the redirect says
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Confirmed`);
    await page.goto(`/bookings/${id}`);
    await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "Confirmed");
    await expect(page.getByTestId("cancel-preview")).toContainText("cancel for free");
    await page.goto("/account/bookings");
    await expect(page.getByTestId("booking-list").getByRole("listitem")).toHaveCount(1);
    await page.getByRole("link", { name: /^Booking BK-/ }).click();
    await page.getByRole("button", { name: "Cancel this booking" }).click();
    await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "CancelledByBuyer");
  });

  test("a booking is private: another buyer, and a visitor, cannot open it", async ({ page, browser }) => {
    await signedIn(page, "own");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const path = new URL(page.url()).pathname;
    const other = await browser.newPage();
    await signedIn(other, "other");
    expect((await other.goto(path))?.status()).toBe(404);
    await other.close();
    const anon = await browser.newPage();
    await anon.goto(path);
    await expect(anon).toHaveURL(/\/sign-in\?next=/);
    await anon.close();
  });

  test("a confirmed booking shows its policy and calendar file, can be moved, and answers the provider's suggestion and move", async ({ page }) => {
    await signedIn(page, "change");
    await chooseTime(page);
    // the service's options: an extra, a choice of provider and the policy
    const slot = page.getByTestId("booking-slot");
    await slot.getByRole("checkbox", { name: /Deep clean/ }).check();
    await slot.getByLabel("Who").selectOption({ label: "Jane D." });
    await pickFirst(page);
    await expect(slot.getByTestId("policy")).toContainText("Free cancellation until 24 hours before the start");
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Confirmed`);
    await page.goto(`/bookings/${id}`);
    await expect(page.getByTestId("booking-policy")).toContainText("50% of the price is kept");
    // the calendar file is a download of text/calendar
    const ics = await page.request.get(`/bookings/${id}/calendar.ics`);
    expect(ics.status()).toBe(200);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    expect(ics.headers()["content-disposition"]).toMatch(/^attachment; filename="booking-[A-Za-z0-9-]+\.ics"$/);
    expect(await ics.text()).toContain("BEGIN:VCALENDAR");
    // ask for another time (at-home: the postal code again)
    await page.getByRole("button", { name: "Change the time" }).click();
    const form = page.getByRole("form", { name: "Choose another time" });
    await form.getByLabel("Your postal code").fill("11201");
    await form.getByRole("button", { name: "Show times" }).click();
    await form.getByLabel(/^New time/).selectOption({ index: 2 });
    await form.getByRole("button", { name: "Ask for this time" }).click();
    await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "Rescheduled");
    // the provider suggests a time; the buyer accepts it
    const proposed = new Date(Date.now() + 5 * 86400000).toISOString();
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&proposedStartAt=${encodeURIComponent(proposed)}`);
    await page.reload();
    await page.getByRole("button", { name: "Accept this time" }).click();
    await expect(page.getByText("The provider suggested")).toHaveCount(0);
    // the provider moves the booking; the buyer accepts the new time
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&requiresBuyerConsent=true`);
    await page.reload();
    await page.getByRole("button", { name: "Accept the new time" }).click();
    await expect(page.getByRole("button", { name: "Accept the new time" })).toHaveCount(0);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => v.id))).toEqual([]);
  });
});
