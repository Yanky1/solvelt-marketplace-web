import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const MOCK = "http://localhost:5080";
export const PASSWORD = "correct horse battery staple";

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

/** Reads the CSRF token the server rendered into a form, via a request context that keeps cookies. */
export async function csrfFor(request: APIRequestContext, path = "/sign-in"): Promise<string> {
  const html = await (await request.get(path)).text();
  const m = /name="csrf" value="([^"]+)"/.exec(html);
  expect(m, "csrf field present").toBeTruthy();
  return m![1]!;
}

export async function signUp(page: Page, email: string, name = "Dana Levi", password = PASSWORD) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/verify-email\?sent=1$/);
}

export async function mailedToken(request: APIRequestContext, kind: "verify" | "reset", email: string): Promise<string> {
  const outbox = (await (await request.get(`${MOCK}/__test/outbox`)).json()) as { kind: string; email: string; token: string }[];
  const hit = [...outbox].reverse().find((m) => m.kind === kind && m.email === email);
  expect(hit, `${kind} mail for ${email}`).toBeTruthy();
  return hit!.token;
}

export async function verifyEmail(page: Page, email: string, password = PASSWORD) {
  const token = await mailedToken(page.request, "verify", email);
  await page.goto(`/verify-email?token=${token}`);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("heading", { name: "Email verified" })).toBeVisible();
}

export async function signIn(page: Page, email: string, password = PASSWORD, from = "/sign-in") {
  await page.goto(from);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

export async function newVerifiedUser(page: Page, tag: string, name = "Dana Levi") {
  const email = uniqueEmail(tag);
  await signUp(page, email, name);
  await verifyEmail(page, email);
  return email;
}

/** Live API session tokens of one user (mock test hook). Tests run in parallel, so never look at other users' sessions. */
export async function tokensOf(request: APIRequestContext, email: string): Promise<string[]> {
  return (await (await request.get(`${MOCK}/__test/tokens?email=${encodeURIComponent(email)}`)).json()) as string[];
}

/** React has hydrated (root effect sets the marker). Wait for it before touching fields that React controls. */
export async function waitHydrated(page: Page) {
  await expect(page.locator("html")).toHaveAttribute("data-hydrated", "true");
}

/** Signs a WebAuthn request challenge with the page's (virtual) authenticator; returns the JSON the server expects. */
export async function getAssertion(page: Page, options: Record<string, unknown>): Promise<Record<string, unknown>> {
  return page.evaluate(async (o) => {
    const dec = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const enc = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const cred = (await navigator.credentials.get({ publicKey: { ...(o as object), challenge: dec(o.challenge as string) } as PublicKeyCredentialRequestOptions })) as PublicKeyCredential;
    const r = cred.response as AuthenticatorAssertionResponse;
    return {
      id: cred.id, rawId: enc(cred.rawId), type: cred.type, clientExtensionResults: {},
      response: { clientDataJSON: enc(r.clientDataJSON), authenticatorData: enc(r.authenticatorData), signature: enc(r.signature), ...(r.userHandle ? { userHandle: enc(r.userHandle) } : {}) },
    };
  }, options);
}

/** A virtual authenticator for this page (Chromium DevTools protocol). */
export async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  return cdp;
}
