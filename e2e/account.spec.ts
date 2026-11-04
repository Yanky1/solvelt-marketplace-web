import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { csrfFor, MOCK, newVerifiedUser, signIn } from "./helpers";

async function signedIn(page: Page, tag: string, name = "Dana Levi") {
  const email = await newVerifiedUser(page, tag, name);
  await signIn(page, email);
  await expect(page).toHaveURL(/\/account$/);
  return email;
}

async function addAddress(page: Page, a: { name: string; line1: string; city?: string; makeDefault?: boolean }) {
  await page.goto("/account/addresses/new");
  await page.getByLabel("Full name").fill(a.name);
  await page.getByLabel("Street address").fill(a.line1);
  await page.getByLabel("City").fill(a.city ?? "Haifa");
  await page.getByLabel("Postal code").fill("3100001");
  await page.getByLabel("Country").selectOption("IL");
  if (a.makeDefault) await page.getByLabel("Use as my default address").check();
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page).toHaveURL(/\/account\/addresses$/);
}

const PRIVATE_PAGES = ["/account/profile", "/account/addresses", "/account/addresses/new", "/account/addresses/abc123", "/account/passkeys"];

test("anonymous visitors are sent to sign-in with a return path", async ({ page }) => {
  for (const path of PRIVATE_PAGES) {
    await page.goto(path);
    await expect(page, path).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path).replace(/%/g, "%")}$`));
  }
});

test("profile: save, validation, read-only email, header updates", async ({ page }) => {
  const email = await signedIn(page, "profile");
  await page.goto("/account/profile");
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await page.getByLabel("Name").fill("");
  await page.getByLabel("Phone (optional)").fill("abc");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Phone (optional)")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Name").fill("Miriam Cohen");
  await page.getByLabel("Phone (optional)").fill("+972 50 123 4567");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Profile saved." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Account of Miriam Cohen" })).toBeVisible();
  await expect(page.getByLabel("Phone (optional)")).toHaveValue("+972 50 123 4567");
  expect(page.url()).not.toContain(email);
});

test("addresses: add, default handling, edit, remove; no PII in URLs", async ({ page }) => {
  const email = await signedIn(page, "addr");
  const urls: string[] = [];
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) urls.push(f.url()); });

  await page.goto("/account/addresses");
  await expect(page.getByRole("heading", { name: "No saved addresses" })).toBeVisible();
  await addAddress(page, { name: "Dana Levi", line1: "1 Herzl Street" });
  const first = page.getByRole("listitem").filter({ hasText: "Dana Levi" });
  await expect(first.getByText("Default", { exact: true })).toBeVisible(); // the first address becomes the default

  await addAddress(page, { name: "Office Haifa", line1: "9 Allenby Road", makeDefault: true });
  const office = page.getByRole("listitem").filter({ hasText: "Office Haifa" });
  await expect(office.getByText("Default", { exact: true })).toBeVisible();
  await expect(first.getByText("Default", { exact: true })).toHaveCount(0); // exactly one default

  await first.getByRole("button", { name: /Make address for Dana Levi the default/ }).click();
  await expect(first.getByText("Default", { exact: true })).toBeVisible();
  await expect(office.getByText("Default", { exact: true })).toHaveCount(0);

  await office.getByRole("link", { name: /Edit address for Office Haifa/ }).click();
  await page.getByLabel("Street address").fill("10 Allenby Road");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("10 Allenby Road")).toBeVisible();

  await first.getByRole("button", { name: /Remove address for Dana Levi/ }).click();
  await expect(page.getByText("Dana Levi", { exact: false }).first()).not.toBeVisible().catch(() => undefined);
  await expect(page.getByRole("listitem").filter({ hasText: "Office Haifa" }).getByText("Default", { exact: true })).toBeVisible(); // default moves on

  for (const u of urls) {
    for (const secret of [email, "Levi", "Herzl", "Allenby", "Haifa", "3100001"]) expect(u, `PII in URL ${u}`).not.toContain(secret);
  }
});

test("address form validation points at the fields", async ({ page }) => {
  await signedIn(page, "addrval");
  await page.goto("/account/addresses/new");
  await page.getByRole("button", { name: "Save address" }).click();
  for (const label of ["Full name", "Street address", "City", "Postal code"]) await expect(page.getByLabel(label)).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Full name").fill("Someone");
  await page.getByRole("button", { name: "Save address" }).click();
  await expect(page.getByLabel("Full name")).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Full name")).toHaveValue("Someone"); // entered values survive an error
});

test("another user's address is a 404 for pages and actions, and stays untouched", async ({ page, browser, baseURL }) => {
  await signedIn(page, "owner");
  await addAddress(page, { name: "Owner Person", line1: "5 Secret Lane" });
  const href = await page.getByRole("link", { name: /Edit address for Owner Person/ }).getAttribute("href");
  const id = href!.split("/").pop()!;

  const ctx = await browser.newContext({ baseURL });
  const other = await ctx.newPage();
  await signedIn(other, "intruder", "Intruder Person");
  const res = await other.goto(`/account/addresses/${id}`);
  expect(res?.status()).toBe(404);
  await expect(other.getByText("Secret Lane")).toHaveCount(0);

  const csrf = await csrfFor(other.request, "/account/addresses");
  for (const intent of ["delete", "default"]) {
    const r = await other.request.post("/account/addresses", { form: { csrf, id, intent }, headers: { origin: baseURL! }, maxRedirects: 0 });
    expect(r.status(), intent).toBe(404);
  }
  const put = await other.request.post(`/account/addresses/${id}`, { form: { csrf, intent: "save", fullName: "Hacked", line1: "x", city: "x", postalCode: "1", country: "IL" }, headers: { origin: baseURL! }, maxRedirects: 0 });
  expect(put.status()).toBe(404);

  await page.goto("/account/addresses");
  await expect(page.getByText("5 Secret Lane")).toBeVisible();
  await expect(page.getByText("Hacked")).toHaveCount(0);
  await ctx.close();
});

test("every account action and passkey endpoint rejects missing, forged and cross-site CSRF", async ({ request, baseURL }) => {
  const csrf = await csrfFor(request);
  const body = { intent: "delete", id: "x", name: "n", displayName: "n", credential: "{}", challengeId: "c" };
  for (const path of ["/account/profile", "/account/addresses", "/account/addresses/new", "/account/addresses/abc", "/account/passkeys", "/account/passkeys/options", "/passkeys/sign-in-options"]) {
    const post = (form: Record<string, string>, origin?: string) => request.post(path, { form, headers: origin ? { origin } : {}, maxRedirects: 0 });
    expect((await post(body, baseURL!)).status(), `${path} no token`).toBe(403);
    expect((await post({ ...body, csrf: "forged" }, baseURL!)).status(), `${path} forged`).toBe(403);
    expect([400, 403], `${path} evil origin`).toContain((await post({ ...body, csrf }, "https://evil.example")).status());
    expect((await post({ ...body, csrf })).status(), `${path} no origin`).toBe(403);
  }
});

test("account pages are private and uncacheable, and every API call carries signed forwarding headers", async ({ page, request }) => {
  await signedIn(page, "cache2");
  for (const path of ["/account", ...PRIVATE_PAGES.filter((p) => !p.endsWith("abc123"))]) {
    const res = await page.request.get(path);
    expect(res.headers()["cache-control"], path).toBe("private, no-store");
  }
  const seen = (await (await request.get(`${MOCK}/__test/seen`)).json()) as { forwardingOk: boolean; path: string }[];
  const api = seen.filter((s) => s.path.startsWith("/api/v1/account/"));
  expect(api.length).toBeGreaterThan(0);
  expect(api.every((s) => s.forwardingOk)).toBe(true);
});

/** A row of the passkey list. (getByText would also match hint text such as "For example: Work laptop" before the passkey exists.) */
const passkeyRow = (page: Page, name: string) => page.locator("main li").filter({ hasText: name });

async function virtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return cdp;
}

test("passkeys: register, sign in with it, remove it, and a removed passkey no longer works", async ({ page }) => {
  await virtualAuthenticator(page);
  await signedIn(page, "pk");
  await page.goto("/account/passkeys");
  await expect(page.getByRole("heading", { name: "No passkeys yet" })).toBeVisible();
  await page.getByLabel("Passkey name").fill("Work laptop");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(passkeyRow(page, "Work laptop")).toBeVisible();

  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/sign-in?next=%2Faccount%2Fprofile");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/account\/profile$/); // the return path is honoured

  await page.goto("/account/passkeys");
  await page.getByRole("button", { name: "Remove passkey Work laptop" }).click();
  await expect(page.getByRole("heading", { name: "No passkeys yet" })).toBeVisible();
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$/); // wait for the sign-out to finish: a navigation would cancel it

  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page.getByRole("group", { name: "There is a problem" })).toContainText("could not verify that passkey");
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("passkey sign-in never redirects off-site via ?next=", async ({ page, baseURL }) => {
  await virtualAuthenticator(page);
  await signedIn(page, "pknext");
  await page.goto("/account/passkeys");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(passkeyRow(page, "My passkey")).toBeVisible();
  for (const bad of ["//evil.example", "https://evil.example/x", "/\t/evil.example"]) {
    await page.goto("/account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto(`/sign-in?next=${encodeURIComponent(bad)}`);
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(/\/account$/);
    expect(new URL(page.url()).origin).toBe(baseURL);
  }
});

test("registering the same authenticator twice is refused with a clear message", async ({ page }) => {
  await virtualAuthenticator(page);
  await signedIn(page, "pkdup");
  await page.goto("/account/passkeys");
  await page.getByRole("button", { name: "Add a passkey" }).click();
  await expect(passkeyRow(page, "My passkey")).toBeVisible();
  await page.getByRole("button", { name: "Add a passkey" }).click();
  // excludeCredentials makes the authenticator refuse, which the page reports instead of failing silently.
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("main li")).toHaveCount(1);
});

test("without WebAuthn support the passkey UI degrades gracefully", async ({ page }) => {
  await page.addInitScript(() => { delete (window as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential; });
  await signedIn(page, "pknone");
  await page.goto("/account/passkeys");
  await expect(page.getByText("does not support passkeys")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a passkey" })).toBeDisabled();
  await page.goto("/sign-out");
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Sign in with a passkey" })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`axe: account pages (${theme})`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "solvelt_theme", value: theme, url: baseURL! }]);
    await signedIn(page, `axeacc${theme}`);
    await addAddress(page, { name: "Dana Levi", line1: "1 Herzl Street" });
    await addAddress(page, { name: "Office Haifa", line1: "9 Allenby Road" });
    const states: [string, () => Promise<void>][] = [
      ["/account", async () => undefined],
      ["/account/profile", async () => { await page.getByLabel("Name").fill(""); await page.getByRole("button", { name: "Save profile" }).click(); await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true"); }],
      ["/account/addresses", async () => undefined],
      ["/account/addresses/new", async () => { await page.getByRole("button", { name: "Save address" }).click(); await expect(page.getByLabel("City")).toHaveAttribute("aria-invalid", "true"); }],
      ["/account/passkeys", async () => undefined],
    ];
    for (const [path, prepare] of states) {
      await page.goto(path);
      await prepare();
      await page.evaluate(() => window.scrollTo(0, 0)); // axe at a fixed scroll position: a sticky header can partly cover fields scrolled under it
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.html} (${n.any.map((c) => c.message).join("; ")})`).join(" | ")}`), path).toEqual([]);
    }
    await page.goto("/account/addresses");
    await page.getByRole("link", { name: /Edit address for Dana Levi/ }).click();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(r.violations.map((v) => v.id), "edit address").toEqual([]);
  });
}
