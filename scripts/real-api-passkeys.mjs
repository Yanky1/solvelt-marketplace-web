// A real-API check of the passkey pages (docs/DESIGN.md W2-29). Unlike the E2E suite (which runs against e2e/mock-api.mjs), this drives a real browser through the web
// server against the REAL API, with a WebAuthn virtual authenticator: register a passkey, list it, sign out, sign in with it, remove it. It exists so the journey E2E
// work (brief M8) has something working to build on; it is not part of CI.
//
//   1. Start the API with a fresh database and test mode on (Development):
//        Demo__Enabled=true ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5080 dotnet run --project src/Solvelt.Marketplace.Api
//   2. Build and start the web server against it (test mode on, so the account can be verified without email):
//        npm run build && NODE_ENV=development DEMO_ENABLED=true API_BASE_URL=http://localhost:5080 PUBLIC_ORIGIN=http://localhost:3000 node server.js
//   3. node scripts/real-api-passkeys.mjs
//
// Settings (environment): WEB_URL (default http://localhost:3000, must equal PUBLIC_ORIGIN), API_URL (default http://localhost:5080), PW_CHROMIUM_PATH (a Chromium to use).
// The API rate-limits sign-in and passkey routes per client address: run this against a freshly started API and not several times in a row (a 429 or 503 in the message
// of a failed step means the limiter, not the pages, said no).
// Exit code 0 when every step worked, 1 with the step that failed.
import { chromium } from "@playwright/test";

const WEB = (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const API = (process.env.API_URL ?? "http://localhost:5080").replace(/\/+$/, "");
const PASSWORD = "Correct-horse-battery-1";
const email = `passkeys-${Date.now()}@example.com`;

let step = "start";
const log = (msg) => console.log(`ok   ${msg}`);
function check(cond, what) { if (!cond) throw new Error(what); }

async function api(path, body) {
  const res = await fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res;
}

try {
  step = "sign up and verify through the API (test mode)";
  check((await api("/api/v1/auth/sign-up", { email, password: PASSWORD, displayName: "Passkey Tester" })).status === 204, "sign-up did not answer 204");
  const verified = await api("/api/v1/demo/verify", { email, password: PASSWORD });
  check(verified.status === 204, `verify answered ${verified.status}: start the API with Demo__Enabled=true`);
  log("account created and verified");

  const browser = await chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {}) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    const problems = [];
    page.on("pageerror", (e) => problems.push(`page error: ${String(e).slice(0, 200)}`));
    page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/img/")) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
    const hydrated = () => page.waitForSelector("html[data-hydrated=true]");
    /** Waits for an address; when it never comes, says what the page showed (an error message, usually) instead of a bare timeout. */
    const arrive = async (glob, ms = 10_000) => {
      try { await page.waitForURL(glob, { timeout: ms }); }
      catch { throw new Error(`never reached ${glob}; at ${page.url()} the page says: ${(await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}; seen: ${problems.join("; ") || "no errors"}`); }
    };

    step = "sign in with the password";
    await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" }); await hydrated();
    await page.getByLabel("Email").fill(email); await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await arrive("**/account");
    log("signed in with the password");

    step = "register a passkey";
    await page.goto(`${WEB}/account/passkeys`, { waitUntil: "networkidle" }); await hydrated();
    await page.locator("#passkey-name").fill("Work laptop");
    await page.getByRole("button", { name: /add a passkey/i }).click();
    await page.getByText("Work laptop", { exact: false }).first().waitFor({ timeout: 10_000 });
    log("passkey registered and listed");

    step = "sign out and sign in with the passkey";
    await page.goto(`${WEB}/account`, { waitUntil: "networkidle" }); await hydrated();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForLoadState("networkidle");
    await page.goto(`${WEB}/sign-in`, { waitUntil: "networkidle" }); await hydrated();
    await page.getByRole("button", { name: /sign in with a passkey/i }).click();
    await arrive("**/account");
    log("signed in with the passkey");

    step = "remove the passkey";
    await page.goto(`${WEB}/account/passkeys`, { waitUntil: "networkidle" }); await hydrated();
    const remove = page.getByRole("button", { name: /remove passkey work laptop/i });
    await remove.click();
    try { await remove.waitFor({ state: "detached", timeout: 10_000 }); }
    catch { throw new Error(`the passkey is still listed after removing it; at ${page.url()} the page says: ${(await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}`); }
    log("passkey removed");

    step = "no errors on the way";
    check(problems.length === 0, `errors seen: ${problems.join("; ")}`);
    log("no HTTP or script errors");
  } finally { await browser.close(); }
  console.log("PASSED");
} catch (e) {
  console.error(`FAILED at "${step}": ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
