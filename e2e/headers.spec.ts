import { expect, test } from "@playwright/test";

const SECURITY = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
} as const;

function expectSecurity(headers: Record<string, string>) {
  for (const [k, v] of Object.entries(SECURITY)) expect(headers[k], k).toBe(v);
  const csp = headers["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(headers["permissions-policy"]).toContain("camera=()");
}

test("HTML responses carry security headers, a nonce CSP and private caching", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expectSecurity(h);
  expect(h["cache-control"]).toBe("private, no-cache");
  expect(h["vary"]).toMatch(/Cookie/i);
  const nonce = /'nonce-([^']+)'/.exec(h["content-security-policy"] ?? "")?.[1];
  expect(nonce).toBeTruthy();
  const html = await res.text();
  expect(html).toContain(`nonce="${nonce}"`);
  expect(html.match(/<script(?![^>]*\bnonce=)[^>]*>/g)?.filter((s) => !/src=/.test(s)) ?? []).toEqual([]);
});

test("the CSP nonce differs per request", async ({ request }) => {
  const a = (await request.get("/healthz")).headers()["content-security-policy"];
  const b = (await request.get("/healthz")).headers()["content-security-policy"];
  expect(a).not.toBe(b);
});

test("single-fetch .data responses are private and vary on Cookie", async ({ request }) => {
  const res = await request.get("/_root.data");
  expect(res.status()).toBe(200);
  const h = res.headers();
  expectSecurity(h);
  expect(h["cache-control"]).toBe("private, no-cache");
  expect(h["vary"]).toMatch(/Cookie/i);
});

test("resource routes and static files carry the security headers too", async ({ request }) => {
  expectSecurity((await request.get("/robots.txt")).headers());
  expectSecurity((await request.get("/healthz")).headers());
});

test("no HSTS over plain http (it is sent only when PUBLIC_ORIGIN is https)", async ({ request }) => {
  expect((await request.get("/")).headers()["strict-transport-security"]).toBeUndefined();
});

test("robots.txt does not block images or hide noindex pages", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text();
  expect(body).not.toContain("/img/");
  expect(body).not.toContain("/styleguide");
});

test("pages hydrate with no console errors and no CSP violations", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  for (const path of ["/", "/styleguide"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  await page.getByRole("button", { name: "Show toast" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  expect(problems).toEqual([]);
});

test("crawlers get complete HTML (bot user agents take the onAllReady path)", async ({ request }) => {
  for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "curl/8.5.0"]) {
    const res = await request.get("/sign-up", { headers: { "user-agent": ua }, timeout: 10_000 });
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("Create your account");
  }
});
