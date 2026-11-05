// Builds the world the UI sweep walks through (decision M8W-07), against the REAL stack (the API repo's tools/journey/stack.sh: portal, API on PostgreSQL, this web app, a mail sandbox):
//   a seller with products and a service, a buyer with a paid, shipped and delivered order, a booking, an address and a wishlist, and one signed-in browser session per role (buyer, support,
//   finance, admin), written as Playwright storage states. Output: sweep-out/world.json and sweep-out/state-<role>.json.
//
// It reuses the journeys' helpers (seller, product, buyer, order, booking: the same API calls the journeys make), so it needs the API repo's checkout:
//   SWEEP_API_DIR=<path to solvelt-marketplace-api>  JOURNEY_RUN_DIR=<the stack's run dir, where env.json is>  node scripts/sweep-setup.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const API_DIR = process.env.SWEEP_API_DIR;
if (!API_DIR) { console.error("SWEEP_API_DIR is not set (the checkout of solvelt-marketplace-api)"); process.exit(2); }
const L = await import(pathToFileURL(join(API_DIR, "tools/journey/lib.mjs")).href);
const { env, step, ok, until, must, api, portal } = L;
const OUT = join(process.cwd(), "sweep-out");
mkdirSync(OUT, { recursive: true });
const WEB = env.web;
const run = L.uniq();

const launch = () => chromium.launch({ ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH, args: ["--no-sandbox"] } : {}) });
const hydrated = (page) => page.waitForSelector("html[data-hydrated=true]", { timeout: 20_000 });
async function withAuthenticator(context, page) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
}

async function main() {
  const world = { web: WEB, searchTerm: "Sweep Mug", states: {}, serviceSlug: null, categorySlug: null, brandSlug: null, sellerId: null, orderNumber: null, bookingId: null, addressId: null, wishlistId: null };

  step("a seller with products and a service");
  const seller = await L.newApprovedSeller("Sweep Shop");
  await L.sellerProduct(seller, { title: world.searchTerm, price: 24.5, quantity: 50 });
  await L.sellerProduct(seller, { title: "Sweep Plate", price: 12, quantity: 50, color: [60, 120, 200] });
  let serviceListing = null;
  try { await L.sellerService(seller, { title: "Sweep Lesson", price: 60 }); } catch (e) { console.log(`   note: no service in the world (${String(e).slice(0, 120)})`); }
  const listing = await until("the listing in the catalog", async () => { await L.pumpPortal(); return (await api("GET", `/api/v1/catalog/listings?q=${encodeURIComponent(world.searchTerm)}`)).body?.items?.[0] ?? null; }, { timeout: 120_000, every: 2000 });
  world.slug = listing.slug;
  world.listingId = listing.id ?? null;
  const detail = (await api("GET", `/api/v1/catalog/listings/${listing.slug}`)).body ?? {};
  world.sellerId = detail.sellerId ?? detail.seller?.id ?? listing.sellerId ?? seller.sellerId ?? null;
  world.brandSlug = detail.brand?.slug ?? listing.brand?.slug ?? null;
  world.categorySlug = detail.category?.slug ?? detail.categories?.[0]?.slug ?? listing.category?.slug ?? null;
  if (!world.brandSlug) world.brandSlug = (await api("GET", "/api/v1/catalog/brands")).body?.items?.[0]?.slug ?? (await api("GET", "/api/v1/catalog/brands")).body?.[0]?.slug ?? null;
  if (!world.categorySlug) world.categorySlug = (await api("GET", "/api/v1/catalog/categories")).body?.items?.[0]?.slug ?? (await api("GET", "/api/v1/catalog/categories")).body?.[0]?.slug ?? null;
  const services = (await api("GET", "/api/v1/catalog/listings?kind=service")).body?.items ?? [];
  serviceListing = services.find((s) => /Sweep Lesson/.test(s.title)) ?? null;
  world.serviceSlug = serviceListing?.slug ?? null;
  ok(`listing ${world.slug}, seller ${world.sellerId}, brand ${world.brandSlug}, category ${world.categorySlug}, service ${world.serviceSlug}`);

  step("a buyer with a delivered order, a booking, an address and a wishlist");
  const buyer = await L.newBuyer("sweepbuyer");
  world.buyerEmail = buyer.email;
  const order = await L.apiCheckoutAndPay(buyer, world.slug);
  world.orderNumber = order.number;
  const sellerOrder = await until("the order at the seller", async () => { await L.pumpPortal(); return L.portalOrderFor(seller, order.number); }, { timeout: 60_000, every: 2000 });
  const detailOf = async () => (await must(portal("GET", `/api/v1/seller/orders/${sellerOrder.id}`, { token: seller.token }), 200, "seller order")).body;
  let d = await detailOf();
  await must(portal("POST", `/api/v1/seller/orders/${sellerOrder.id}/accept`, { token: seller.token, body: { version: d.version } }), 200, "accept");
  d = await detailOf();
  await must(portal("POST", `/api/v1/seller/orders/${sellerOrder.id}/ship`, { token: seller.token, body: { version: d.version, carrier: "UPS", trackingNumber: `1Z999AA1${String(Math.floor(Math.random() * 1e10)).padStart(10, "0")}` } }), 200, "ship");
  d = await detailOf();
  await must(portal("POST", `/api/v1/seller/orders/${sellerOrder.id}/deliver`, { token: seller.token, body: { version: d.version } }), 200, "deliver");
  await L.pumpPortal();
  if (serviceListing) { try { world.bookingId = (await L.apiBookAndPay(buyer, serviceListing)).id; } catch (e) { console.log(`   note: no booking in the world (${String(e).slice(0, 120)})`); } }
  const addr = await api("POST", "/api/v1/account/addresses", { token: buyer.token, body: { fullName: "Dana Buyer", line1: "1 Main St", city: "Brooklyn", region: "NY", postalCode: "11201", country: "US", isDefault: true } });
  world.addressId = addr.body?.id ?? null;
  const wl = await api("POST", "/api/v1/wishlists", { token: buyer.token, body: { name: "Sweep list" } });
  world.wishlistId = wl.body?.id ?? wl.body?.wishlist?.id ?? null;
  ok(`order ${world.orderNumber}, booking ${world.bookingId}, address ${world.addressId}, wishlist ${world.wishlistId}`);

  const browser = await launch();
  try {
    step("the buyer's browser session");
    {
      const context = await browser.newContext({ baseURL: WEB });
      const page = await context.newPage();
      await page.goto("/sign-in", { waitUntil: "domcontentloaded" }); await hydrated(page);
      await page.getByLabel("Email").fill(buyer.email);
      await page.getByLabel("Password").fill(L.BUYER_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 20_000 });
      world.states.buyer = join(OUT, "state-buyer.json");
      await context.storageState({ path: world.states.buyer });
      await context.close();
      ok("buyer signed in");
    }

    step("the first admin enrols a passkey; support and finance staff are created and enrol too");
    const admin = await browser.newContext({ baseURL: WEB });
    const page = await admin.newPage();
    await withAuthenticator(admin, page);
    await page.goto("/staff/enrol", { waitUntil: "domcontentloaded" }); await hydrated(page);
    await page.getByLabel("One-time secret").fill(env.staffBootstrapSecret);
    await page.getByRole("button", { name: "Create my passkey" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/staff/enrol"), { timeout: 20_000 });
    await hydrated(page);
    world.states.admin = join(OUT, "state-admin.json");
    ok("admin enrolled");

    for (const role of ["support", "finance"]) {
      await page.goto("/staff/accounts", { waitUntil: "domcontentloaded" }); await hydrated(page);
      const form = page.locator("form", { has: page.getByRole("button", { name: "Create and get the link" }) });   // the add form, not the per-account forms below it
      await form.getByLabel("Email").fill(`sweep-${role}-${run}@journey.test`);
      await form.getByLabel("Name").fill(`Sweep ${role}`);
      await form.getByLabel("Role").selectOption(role);
      await form.getByLabel("Reason").fill("The UI sweep needs one account per role");
      await form.getByRole("button", { name: "Create and get the link" }).click();
      const link = (await page.getByTestId("enrol-link").locator("code").first().innerText({ timeout: 20_000 })).trim();
      const ctx = await browser.newContext({ baseURL: WEB });
      const p = await ctx.newPage();
      await withAuthenticator(ctx, p);
      await p.goto(link, { waitUntil: "domcontentloaded" }); await hydrated(p);
      await p.getByRole("button", { name: "Create my passkey" }).click();
      await p.waitForURL((u) => !u.pathname.startsWith("/staff/enrol"), { timeout: 20_000 });
      world.states[role] = join(OUT, `state-${role}.json`);
      await ctx.storageState({ path: world.states[role] });
      await ctx.close();
      ok(`${role} enrolled`);
    }
    await admin.storageState({ path: world.states.admin });   // saved LAST: the session token rotates while accounts are created, so an earlier copy would be dead
    await admin.close();
  } finally { await browser.close(); }

  writeFileSync(join(OUT, "world.json"), JSON.stringify(world, null, 2));
  console.log(`world written to ${join(OUT, "world.json")}`);
}

try { await main(); console.log("SWEEP SETUP DONE"); }
catch (e) { console.error(`SWEEP SETUP FAILED: ${e instanceof Error ? e.stack ?? e.message : e}`); process.exit(1); }
