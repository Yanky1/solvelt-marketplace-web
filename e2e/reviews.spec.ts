import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { MOCK, csrfFor, newVerifiedUser, signIn, waitHydrated } from "./helpers";

// Every spec runs on both projects at once against ONE mock API, and reviews belong to a listing, so the tests that count reviews each use a listing of their own per project; the rest use unique texts.
const SLUG = "classic-braided-challah";
const PDP = `/p/${SLUG}`;
const own = (a: string, b: string) => (test.info().project.name === "mobile" ? b : a);
// a real 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function signedIn(page: Page, tag: string) {
  const email = await newVerifiedUser(page, tag);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

/** An order line of this buyer that has been delivered (seeded in the mock): returns the link that starts the review. */
async function eligible(page: Page, email: string, kind = "order_line", slug = SLUG) {
  const r = await page.request.get(`${MOCK}/__test/seed-eligible?email=${encodeURIComponent(email)}&slug=${slug}&kind=${kind}`);
  const { id, listingId } = (await r.json()) as { id: string; listingId: string };
  return { id, listingId, url: `/account/reviews/new?kind=${kind}&target=${id}&listing=${listingId}` };
}

async function writeReview(page: Page, url: string, rating: number, text: string) {
  await page.goto(url);
  await waitHydrated(page);
  await page.getByLabel(`${rating} ${rating === 1 ? "star" : "stars"}`).check();
  await page.getByLabel("Your review").fill(text);
  await page.getByRole("button", { name: "Publish review" }).click();
}

test("a guest sees the reviews area, is asked to sign in to review or to ask, and the page has no rating data without reviews", async ({ page }) => {
  await page.goto("/p/custom-kitchen-remodel");   // reserved: nobody reviews it
  await expect(page.getByRole("heading", { name: "Reviews" })).toBeVisible();
  await expect(page.getByText("No reviews yet.")).toBeVisible();
  await expect(page.getByText("to review something you bought or booked")).toBeVisible();
  await expect(page.getByText("to ask the seller a question")).toBeVisible();
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join("")).not.toContain("AggregateRating");
});

test("write a review: it is checked, published, shown with its figures and structured data, edited and given photos", async ({ page }) => {
  const slug = own("silver-plated-shabbat-candlesticks", "cabernet-sauvignon-mevushal");
  const pdp = `/p/${slug}`;
  const email = await signedIn(page, "rvw");
  const e = await eligible(page, email, "order_line", slug);
  await page.goto(pdp);
  await waitHydrated(page);
  await expect(page.getByRole("link", { name: /Write a review:/ })).toBeVisible();

  await writeReview(page, e.url, 5, "Call me on 718-555-0199 for more");
  await expect(page.getByText("leave out phone numbers", { exact: false }).first()).toBeVisible();   // refused, and what was typed is still there
  await expect(page.getByLabel("Your review")).toHaveValue("Call me on 718-555-0199 for more");
  await page.getByLabel("Your review").fill("Soft, golden and still warm on Friday.");
  await page.getByRole("button", { name: "Publish review" }).click();
  await expect(page.getByText("Your review is published")).toBeVisible();
  await expect(page).toHaveURL(/\/account\/reviews\/[a-f0-9]+\?created=1$/);

  // photos: a text file is refused by its bytes, a picture is accepted and removed again
  await page.setInputFiles("#photo-file", { name: "evil.png", mimeType: "image/png", buffer: Buffer.from("not an image at all") });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("We couldn't use that file")).toBeVisible();
  await page.setInputFiles("#photo-file", { name: "p.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo added.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Photos (1 of 5)" })).toBeVisible();

  await page.goto(pdp);
  const summary = page.getByTestId("rating-summary");
  await expect(summary).toContainText("5.0 out of 5");
  await expect(summary).toContainText("1 review");
  await expect(page.getByTestId("review").getByText("Soft, golden and still warm on Friday.")).toBeVisible();
  await expect(page.getByTestId("review").getByText("Verified purchase")).toBeVisible();
  const img = page.getByRole("img", { name: /From the review by/ });
  await expect(img).toBeVisible();
  expect((await page.request.get((await img.getAttribute("src"))!)).status()).toBe(200);
  const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').allTextContents()).find((t) => t.includes("AggregateRating"))!);
  expect(ld.aggregateRating).toMatchObject({ ratingValue: 5, reviewCount: 1 });
  expect(ld.review[0]).toMatchObject({ "@type": "Review", reviewBody: "Soft, golden and still warm on Friday." });
  expect(JSON.stringify(ld)).not.toContain("@example.test");

  // a line that was reviewed is not offered again; the review can be changed
  await expect(page.getByRole("link", { name: /Write a review:/ })).toHaveCount(0);
  await page.goto("/account/reviews");
  await page.getByRole("link", { name: /Change your review/ }).click();
  await page.getByLabel("3 stars").check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved.")).toBeVisible();
  await page.goto(pdp);
  await expect(page.getByTestId("rating-summary")).toContainText("3.0 out of 5");
  await expect(page.getByTestId("review").getByText("(edited)")).toBeVisible();
});

test("another buyer can mark a review helpful and report it, the author cannot, and a hidden review and its photos disappear", async ({ page, browser }) => {
  const slug = own("sold-out-honey-cake", "deep-house-cleaning");
  const PDP = `/p/${slug}`;
  const email = await signedIn(page, "rvauthor");
  const e = await eligible(page, email, "order_line", slug);
  await writeReview(page, e.url, 4, "Worth every cent.");
  await expect(page.getByText("Your review is published")).toBeVisible();
  const reviewId = new URL(page.url()).pathname.split("/").pop()!;
  await page.setInputFiles("#photo-file", { name: "p.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Upload photo" }).click();
  await expect(page.getByText("Photo added.")).toBeVisible();

  await page.goto(PDP);
  await waitHydrated(page);
  await page.getByRole("button", { name: /Mark the review by .* as helpful/ }).click();
  await expect(page.getByText("You can't do that to your own review.")).toBeVisible();   // the author

  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  const email2 = await newVerifiedUser(other, "rvother");
  await signIn(other, email2);
  await expect(other).toHaveURL(/\/account$/);
  await other.goto(PDP);
  await waitHydrated(other);
  await other.getByRole("button", { name: /Mark the review by .* as helpful/ }).click();
  await expect(other.getByText("Thanks, marked as helpful.")).toBeVisible();
  await expect(other.getByRole("button", { name: /Mark the review by .* as helpful/ })).toContainText("(1)");
  await other.getByText("Report", { exact: true }).first().click();
  await other.getByLabel("Why are you reporting this?").selectOption("offensive");
  await other.getByRole("button", { name: "Send report" }).click();
  await expect(other.getByText("We sent your report to our moderators.", { exact: false })).toBeVisible();
  const state = (await (await other.request.get(`${MOCK}/__test/reviews`)).json()) as { reports: { reviewId: string; reason: string; kind: string }[] };
  expect(state.reports.filter((r) => r.reviewId === reviewId)).toEqual([{ reviewId, userId: expect.any(String), reason: "offensive", kind: "review" }]);

  // another buyer can't open or change the author's review
  expect((await other.goto(`/account/reviews/${reviewId}`))?.status()).toBe(404);

  // the seller's reply is shown; a hidden review is not
  await page.request.get(`${MOCK}/__test/review-set?id=${reviewId}&reply=${encodeURIComponent("Thank you, see you soon!")}`);
  await other.goto(PDP);
  await expect(other.getByText("Reply from the seller")).toBeVisible();
  await expect(other.getByText("Thank you, see you soon!")).toBeVisible();
  const photoSrc = (await other.getByRole("img", { name: /From the review by/ }).getAttribute("src"))!;
  await page.request.get(`${MOCK}/__test/review-set?id=${reviewId}&status=hidden`);
  await other.goto(PDP);
  await expect(other.getByText("No reviews yet.")).toBeVisible();
  expect((await other.request.get(photoSrc)).status()).toBe(404);
  await ctx.close();
});

test("ask the seller a question: sent, listed with its state, refused with contact details", async ({ page }) => {
  await signedIn(page, "rvq");
  await page.goto(PDP);
  await waitHydrated(page);
  await page.getByLabel("Your question").fill("Is the challah nut free?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("We sent your question to the seller", { exact: false })).toBeVisible();
  await page.getByLabel("Your question").fill("Text me on 718-555-0100 please");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText("We couldn't use that question")).toBeVisible();
  await page.goto("/account/questions");
  await expect(page.getByText("Is the challah nut free?")).toBeVisible();
  await expect(page.getByText("Sent to the seller")).toBeVisible();
  await expect(page.getByText("718-555-0100")).toHaveCount(0);
});

test("every review and question post is refused without a valid csrf token, and the account pages need a sign-in", async ({ page, request, baseURL }) => {
  const email = await signedIn(page, "rvcsrf");
  const e = await eligible(page, email);
  const csrf = await csrfFor(page.request, "/account/reviews");
  const body = { intent: "helpful", reviewId: "x1", listingId: "x1", text: "t", rating: "5", return: "/" };
  for (const path of ["/reviews/act", "/questions", e.url, "/account/reviews/abc"]) {
    const post = (form: Record<string, string>, origin?: string) => page.request.post(path, { form, headers: origin ? { origin } : {}, maxRedirects: 0 });
    expect((await post(body, baseURL!)).status(), `${path} no token`).toBe(403);
    expect((await post({ ...body, csrf: "forged" }, baseURL!)).status(), `${path} forged`).toBe(403);
    expect([400, 403], `${path} evil origin`).toContain((await post({ ...body, csrf }, "https://evil.example")).status());
    expect((await post({ ...body, csrf })).status(), `${path} no origin`).toBe(403);
  }
  for (const path of ["/account/reviews", "/account/questions", "/account/reviews/new"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect([302, 303], path).toContain(res.status());
  }
  // a return address off this site is never followed
  const res = await page.request.post("/reviews/act", { form: { csrf, intent: "helpful", reviewId: "x1", return: "https://evil.example/" }, headers: { origin: baseURL! }, maxRedirects: 0 });
  expect(res.headers()["location"] ?? "").not.toContain("evil.example");
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: product page with reviews and questions, the review pages and the question page (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    const email = await signedIn(page, `rvaxe${theme}`);
    const e = await eligible(page, email);
    const check = async () => {
      await page.evaluate(() => window.scrollTo(0, 0));   // the sticky header would otherwise sit over rows that were scrolled to, and axe reads the real positions
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => [n.target, n.html.slice(0, 160)]) }))).toEqual([]);
    };
    await page.goto(e.url);
    await waitHydrated(page);
    await check();                                                   // the write form
    await page.getByLabel("4 stars").check();
    await page.getByLabel("Your review").fill(`Really good, would order again ${theme}-${test.info().project.name}.`);
    await page.getByRole("button", { name: "Publish review" }).click();
    await expect(page.getByText("Your review is published")).toBeVisible();
    await check();                                                   // the edit page with the photo form
    await page.setInputFiles("#photo-file", { name: "p.png", mimeType: "image/png", buffer: PNG });
    await page.getByRole("button", { name: "Upload photo" }).click();
    await expect(page.getByText("Photo added.")).toBeVisible();
    await check();                                                   // with a photo
    await page.goto("/account/reviews");
    await check();
    await page.goto("/account/questions");
    await check();                                                   // empty
    await page.goto(PDP);
    await waitHydrated(page);
    await expect(page.getByTestId("review").filter({ hasText: `${theme}-${test.info().project.name}` })).toBeVisible();
    await page.getByTestId("review").filter({ hasText: `${theme}-${test.info().project.name}` }).getByText("Report", { exact: true }).click();
    await check();                                                   // the product page with the summary, a review, the open report form and the question form
  });
}
