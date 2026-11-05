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
    await expect(slot.getByTestId("travel-fee")).toContainText("$10.00");
    await expect(slot).toContainText("Times are shown in America/New York");
    await pickFirst(page);
    await expect(slot.getByRole("form", { name: /^Book / })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));                                        // the sticky header must not sit on top of the widget while it is measured
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

  test("an extra amount the provider asks for can be agreed and paid, or declined", async ({ page }) => {
    await signedIn(page, "extra");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Completed`);
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&extraChargeState=requested&additionalChargeCents=5000`);
    await page.goto(`/bookings/${id}`);
    const panel = page.getByTestId("extra-charge");
    await expect(panel).toContainText("$50.00");
    await panel.getByRole("button", { name: "Agree and pay" }).click();
    await expect(panel.getByTestId("payment-step")).toBeVisible();
    // a second request: declined
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&extraChargeState=requested`);
    await page.goto(`/bookings/${id}`);
    await page.getByTestId("extra-charge").getByRole("button", { name: "Decline" }).click();
    await expect(page.getByTestId("extra-charge")).toContainText("You declined the additional amount");
  });

  test("a confirmed but unpaid booking (a quote accepted before holds) offers the payment, with the time left", async ({ page }) => {
    await signedIn(page, "legacy");
    await page.goto("/p/custom-kitchen-remodel");
    await waitHydrated(page);
    await page.getByLabel("What do you need?").fill("A small change to the kitchen layout, please.");
    await page.getByRole("button", { name: "Ask for a quote" }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
    const qid = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/quote-send?id=${qid}&price=40000&legacy=1`);
    await page.goto(`/quotes/${qid}`);
    await page.getByLabel(/^Choose a time/).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Accept and continue to payment" }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "Confirmed");          // confirmed already: NOT a hold
    const due = page.getByTestId("due-panel");
    await expect(due.getByTestId("due-countdown")).toContainText(/\d+:\d\d/);
    await expect(page.getByTestId("hold-panel")).toHaveCount(0);
    await due.getByRole("button", { name: /^Continue to payment/ }).click();
    await expect(due.getByTestId("payment-step")).toBeVisible();
  });

  test("an expired hold links back to the service so the buyer can choose again", async ({ page }) => {
    await signedIn(page, "expired");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&holdExpiresAt=${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}`);
    await page.goto(`/bookings/${id}`);
    await expect(page.getByTestId("choose-again")).toHaveAttribute("href", "/p/deep-house-cleaning");
  });

  test("a request the provider has not answered yet cannot be moved", async ({ page }) => {
    await signedIn(page, "requested");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Requested`);
    await page.goto(`/bookings/${id}`);
    await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "Requested");
    await expect(page.getByRole("button", { name: "Change the time" })).toHaveCount(0);
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Confirmed`);
    await page.goto(`/bookings/${id}`);
    await expect(page.getByRole("button", { name: "Change the time" })).toBeVisible();
  });

  test("a changed extra amount is refused under the old figure, shown again, and paid at the new one", async ({ page }) => {
    await signedIn(page, "amount");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Completed`);
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&extraChargeState=requested&additionalChargeCents=5000`);
    await page.goto(`/bookings/${id}`);
    await expect(page.getByTestId("extra-charge")).toContainText("$50.00");
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&additionalChargeCents=7000`);       // the provider asks for more while the page is open
    await page.getByTestId("extra-charge").getByRole("button", { name: "Agree and pay" }).click();
    await expect(page.getByTestId("extra-error")).toContainText("changed the amount");
    await expect(page.getByTestId("extra-charge")).toContainText("$70.00");                      // the page now shows what is asked
    await expect(page.getByTestId("payment-step")).toHaveCount(0);                               // and nothing is being paid yet
    await page.getByTestId("extra-charge").getByRole("button", { name: "Agree and pay" }).click();
    await expect(page.getByTestId("extra-charge").getByRole("button", { name: "Pay $70.00" })).toBeVisible();
  });

  test("the extra-charge buttons are gone once it is declined or paid", async ({ page }) => {
    await signedIn(page, "extradone");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Completed`);
    for (const state of ["declined", "paid"]) {
      await page.request.get(`${MOCK}/__test/book-set?id=${id}&extraChargeState=${state}&additionalChargeCents=5000`);
      await page.goto(`/bookings/${id}`);
      await expect(page.getByTestId("extra-charge")).toBeVisible();
      await expect(page.getByTestId("extra-charge").getByRole("button")).toHaveCount(0);
    }
  });

  test("every new form post needs the page's csrf token, and private pages are not cached", async ({ page }) => {
    await signedIn(page, "csrf");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const bid = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-status?id=${bid}&status=Confirmed`);
    await page.goto("/p/custom-kitchen-remodel");
    await waitHydrated(page);
    await page.getByLabel("What do you need?").fill("Something small that needs a quote, thanks.");
    await page.getByRole("button", { name: "Ask for a quote" }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
    const qid = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/quote-send?id=${qid}`);
    const posts: [string, Record<string, string>][] = [
      ["/quotes/new", { listingId: "x", location: "online", details: "Ten characters at least." }],
      ["/bookings/holds", { listingId: "x", start: new Date(Date.now() + 86400000).toISOString(), location: "online" }],
      [`/quotes/${qid}`, { intent: "accept", start: "2030-01-01T10:00:00Z" }], [`/quotes/${qid}`, { intent: "decline" }],
      ...["checkout", "cancel", "reschedule", "proposal", "acknowledge", "extra-accept", "extra-decline"].map((intent): [string, Record<string, string>] => [`/bookings/${bid}`, { intent, newStart: "2030-01-01T10:00:00Z", accept: "yes" }]),
    ];
    for (const [url, form] of posts) {
      expect((await page.request.post(url, { form })).status(), `${url} ${form["intent"] ?? ""} without a token`).toBe(403);
      expect((await page.request.post(url, { form: { ...form, csrf: "wrong-token" } })).status(), `${url} ${form["intent"] ?? ""} with a wrong token`).toBe(403);
    }
    for (const url of [`/quotes/${qid}`, "/account/quotes", `/bookings/${bid}`, "/account/bookings", `/bookings/${bid}/calendar.ics`]) {
      const cc = (await page.request.get(url)).headers()["cache-control"] ?? "";
      expect(cc, url).toContain("private"); expect(cc, url).toContain("no-store");
    }
  });

  test("a dirty file name from the API is cleaned to letters, digits and dashes", async ({ page }) => {
    await signedIn(page, "dirty");
    await chooseTime(page);
    await pickFirst(page);
    await fillAddress(page);
    await page.getByRole("button", { name: /^Hold Deep House Cleaning/ }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/book-status?id=${id}&status=Confirmed`);
    await page.request.get(`${MOCK}/__test/book-set?id=${id}&number=${encodeURIComponent('A";x=1/..\\y')}`);
    const r = await page.request.get(`/bookings/${id}/calendar.ics`);
    expect(r.status()).toBe(200);
    expect(r.headers()["content-disposition"]).toMatch(/^attachment; filename="booking-[A-Za-z0-9-]+\.ics"$/);
  });
});

test.describe("quotes", () => {
  const KITCHEN = "/p/custom-kitchen-remodel";

  test("a service priced per job asks for a quote, shows the answer, and accepting it leads to a held booking", async ({ page }) => {
    await signedIn(page, "quote");
    await page.goto(KITCHEN);
    await waitHydrated(page);
    const form = page.getByRole("form", { name: /^Ask for a quote/ });
    await form.getByLabel("What do you need?").fill("New cabinets and a sink, about 12 feet of counter.");
    await form.getByRole("button", { name: "Ask for a quote" }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await expect(page.getByTestId("quote-status")).toHaveAttribute("data-status", "Requested");
    await page.request.get(`${MOCK}/__test/quote-send?id=${id}&price=40000`);
    await page.goto(`/quotes/${id}`);
    await expect(page.getByTestId("quote-status")).toHaveAttribute("data-status", "Quoted");
    await expect(page.getByTestId("quote-price")).toHaveText("$400.00");
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations, JSON.stringify(axe.violations.map((v) => v.id))).toEqual([]);
    await expect(page.getByLabel(/^Choose a time \(America\/New York\)/)).toBeVisible();     // the provider's zone, not UTC
    await page.getByLabel(/^Choose a time/).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Accept and continue to payment" }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]+$/);
    await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "Hold");
    await page.goto("/account/quotes");
    await expect(page.getByTestId("quote-list").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  });

  test("a quote can be declined, and a visitor is sent to sign in first", async ({ page, browser }) => {
    await signedIn(page, "qdecline");
    await page.goto(KITCHEN);
    await waitHydrated(page);
    await page.getByLabel("What do you need?").fill("Replace the floor tiles in a small kitchen please.");
    await page.getByRole("button", { name: "Ask for a quote" }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]+$/);
    const id = page.url().split("/").pop()!;
    await page.request.get(`${MOCK}/__test/quote-send?id=${id}`);
    await page.goto(`/quotes/${id}`);
    await page.getByRole("button", { name: "Decline this quote" }).click();
    await expect(page.getByTestId("quote-status")).toHaveAttribute("data-status", "Withdrawn");
    const anon = await browser.newPage();
    await anon.goto(KITCHEN);
    await waitHydrated(anon);
    await anon.getByLabel("What do you need?").fill("Anything at all, ten characters.");
    await anon.getByRole("button", { name: "Ask for a quote" }).click();
    await expect(anon).toHaveURL(/\/sign-in\?next=%2Fp%2Fcustom-kitchen-remodel/);
    await anon.close();
  });
});
