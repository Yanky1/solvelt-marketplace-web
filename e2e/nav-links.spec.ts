import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * A link in the header or footer must never lead to a 404 (it did: /services and /brands were linked before they existed). The list is read from the
 * source of the shell, so a link added to NAV_LINKS is covered without anyone remembering to add it here.
 */
const shell = readFileSync(new URL("../app/components/Shell.tsx", import.meta.url), "utf8");
const block = /export const NAV_LINKS = \[([\s\S]*?)\];/.exec(shell)?.[1] ?? "";
const NAV_TARGETS = [...block.matchAll(/to:\s*"([^"]+)"/g)].map((m) => m[1]!);

test("the nav list was read from the shell", () => {
  expect(NAV_TARGETS.length).toBeGreaterThanOrEqual(3);
  expect(NAV_TARGETS).toEqual(expect.arrayContaining(["/categories", "/services", "/brands"]));
});

for (const target of NAV_TARGETS) {
  test(`NAV_LINKS target ${target} answers 200`, async ({ request }) => {
    const res = await request.get(target);
    expect(res.status()).toBe(200);
  });
}

test("every internal link in the header and footer of the home page answers 200", async ({ page, request }) => {
  await page.goto("/");
  const hrefs = await page.locator("header a[href], footer a[href]").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""));
  const internal = [...new Set(hrefs.filter((h) => h.startsWith("/") && !h.startsWith("//")))];
  expect(internal.length).toBeGreaterThan(3);
  for (const href of internal) {
    // Sign-in and the account pages are meant to answer (200 for sign-in, a redirect to it for the account): follow redirects, require a final 200.
    const res = await request.get(href);
    expect(res.status(), href).toBe(200);
  }
});
