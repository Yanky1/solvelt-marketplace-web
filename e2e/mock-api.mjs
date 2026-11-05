// Stateful mock of the marketplace API for E2E. The auth shapes are the ASSUMED contract (docs/DESIGN.md W1-21).
// Test-only hooks live under /__test and are not part of the contract.
import { createHash, createHmac, randomBytes } from "node:crypto";
import http from "node:http";
import sharp from "sharp";
import { catalogResponse, gid, IMAGE_BAD, IMAGE_DOWN, imageInfo, variantInfo } from "./mock-catalog.mjs";

const port = Number(process.env.MOCK_API_PORT ?? 5080);
const forwardingKey = process.env.WEB_FORWARDING_KEY ?? "";

// Test mode (M9). MOCK_DEMO=1 turns it on for this mock process only: the demo E2E starts its own mock and web server, so the default run stays in normal mode.
const demoOn = process.env.MOCK_DEMO === "1";
const demoData = new Set(); // userIds that have a demo batch
const DEMO_COUNTS = { addresses: 1, carts: 1, cartLines: 3, orders: 3, bookings: 2, threads: 1, messages: 2, notifications: 5 };
const ZERO_COUNTS = Object.fromEntries(Object.keys(DEMO_COUNTS).map((k) => [k, 0]));
const demoCounts = (u) => (demoData.has(u.id) ? DEMO_COUNTS : ZERO_COUNTS);
const users = new Map(); // email -> {id, email, displayName, password, verified}
const sessions = new Map(); // token -> userId
const addresses = new Map(); // addressId -> {userId, ...address}
const passkeys = new Map(); // credentialId -> {id, userId, name, createdAt, lastUsedAt}
const challenges = new Map(); // challengeId -> {challenge, userId?, kind}
const failSignOutOnce = new Set(); // tokens whose NEXT sign-out call answers 503 (then it works again)
const failSignOut = new Set(); // tokens whose sign-out calls answer 503 (test hook)
const authAt = new Map(); // session token -> ms of the last successful step-up (the API-side O-11 clock)
const threads = new Map(); // threadId -> {userId, kind, subject, sellerName, orderNumber, listingId, messages:[]}
const reports = []; // {messageId, reason}
const notifs = new Map(); // userId -> [{id, kind, ...}]
const prefs = new Map(); // userId -> {category: bool}
const CATEGORIES = ["order_updates", "shipped", "out_for_delivery", "delivered", "messages", "bookings"];
const orders = new Map(); // number -> {userId, createdAt, status, group}
const outbox = []; // {kind, email, token}
const unsubCalls = new Map(); // token -> number of calls (the specs run in parallel on one mock)
const seen = []; // recorded request metadata (no bodies)
const priceBump = new Map(); // test hook: this guest email's checkout is priced dearer than the quote it was shown (per email: specs run in parallel); the mock's own hash comparison then answers 409
const badPublishableKey = new Set(); // test hook: this guest email's PaymentIntent comes with a publishable key the web must refuse
const checkoutOrders = new Map(); // number -> {key, userId, guestEmail, token, status, lines, totalCents, createdAt}
const carts = new Map(); // owner key ("u:<userId>" or "g:<token>") -> [{id, variantId, quantity, seenPrice}]
// the API's own header name, spelled out here on purpose: the mock must not follow a wrong name in the web code (review H1)
const cartKeyOf = (req) => { const t = bearer(req); const uid = t ? sessions.get(t) : undefined; if (t && !uid) return null; return uid ? `u:${uid}` : (req.headers["x-solvelt-cart-token"] ? `g:${req.headers["x-solvelt-cart-token"]}` : undefined); };
function cartView(key, token) {
  const lines = carts.get(key) ?? [];
  const groups = new Map();
  let items = 0, subtotal = 0, canCheckout = lines.length > 0;
  for (const l of lines) {
    const info = variantInfo(l.variantId);
    const ok = !!info && info.variant.available;
    if (!ok) canCheckout = false;
    const unit = ok ? info.variant.priceCents : 0;
    const gk = info ? `${info.listing.seller.id}:${info.listing.brand.id}` : "gone";
    if (!groups.has(gk)) groups.set(gk, { sellerId: info?.listing.seller.id ?? "", sellerName: info?.listing.seller.displayName ?? "", brandId: info?.listing.brand.id ?? "", brandName: info?.listing.brand.name ?? "", subtotalCents: 0, lines: [] });
    const g = groups.get(gk);
    g.lines.push({ id: l.id, listingId: info?.listing.id ?? "", variantId: l.variantId, slug: info?.listing.slug ?? "", title: info?.listing.title ?? "Unavailable item", variantName: info?.variant.name ?? "", imageId: null, quantity: l.quantity, unitPriceCents: unit, compareAtCents: ok ? info.variant.compareAtCents : null, lineTotalCents: unit * l.quantity, status: ok ? "ok" : "unavailable", previousUnitPriceCents: ok && unit !== l.seenPrice ? l.seenPrice : null });
    g.subtotalCents += unit * l.quantity;
    if (ok) { items += l.quantity; subtotal += unit * l.quantity; }
  }
  return { currency: "USD", groups: [...groups.values()], itemCount: items, subtotalCents: subtotal, canCheckout, ...(token ? { cartToken: token } : {}) };
}

// Test variants are selected by the end-user IP the web server forwards (X-Solvelt-Client-Ip), so parallel tests never interfere.
const ipOf = (req) => String(req.headers["x-solvelt-client-ip"] ?? "");
const IP = { ANON_RPID_EVIL: "198.51.100.61", ANON_BOTH_DIFFER: "198.51.100.62", ANON_BOTH_DIFFER_REV: "198.51.100.63", ANON_RP_ONLY_EVIL: "198.51.100.64", ANON_BOTH_SAME: "198.51.100.65", REG_BOTH_DIFFER: "198.51.100.66", REG_BOTH_SAME: "198.51.100.67", REG_LENIENT: "198.51.100.68", REG_5XX: "198.51.100.69", SIGNIN_LENIENT: "198.51.100.70" };


// ---- checkout (assumed shapes follow the API repo docs/API.md "Checkout"; the mock prices flat: standard 500, overnight 1800, free over 5000, no tax) ----
function quoteFor(key, body, bump = 0) {
  const a = body.address ?? {};
  const view = cartView(key);
  const picks = new Map((body.selections ?? []).map((x) => [`${x.sellerId}:${x.brandId}`, x]));
  const us = String(a.country).toUpperCase() === "US";
  const groups = view.groups.map((g) => {
    const free = g.subtotalCents >= 5000;
    const options = us || String(a.country).toUpperCase() === "CA" ? [{ speed: "standard", priceCents: free ? 0 : 500, free, estimate: { earliest: "2026-11-12", latest: "2026-11-16" } }, { speed: "overnight", priceCents: free ? 0 : 1800, free, estimate: { earliest: "2026-11-06", latest: "2026-11-09" } }] : [];
    const pick = picks.get(`${g.sellerId}:${g.brandId}`);
    const chosen = options.find((o) => o.speed === pick?.speed) ?? [...options].sort((x, y) => x.priceCents - y.priceCents)[0];
    const shipping = chosen?.priceCents ?? 0;
    return { sellerId: g.sellerId, sellerName: g.sellerName, brandId: g.brandId, brandName: g.brandName, lines: g.lines.map((l) => ({ lineId: l.id, listingId: l.listingId, variantId: l.variantId, title: l.title, variantName: l.variantName, quantity: l.quantity, unitPriceCents: l.unitPriceCents, lineTotalCents: l.lineTotalCents, taxCents: 0 })),
      itemsCents: g.subtotalCents, shippingOptions: options, unavailableSpeeds: [], local: null, selected: chosen ? { kind: "carrier", speed: chosen.speed, windowId: null, date: null, shippingCents: shipping } : null, shippingCents: shipping, shippingTaxCents: 0, taxCents: 0, totalCents: g.subtotalCents + shipping };
  });
  const total = groups.reduce((n, g) => n + g.totalCents, 0) + bump;   // `bump`: a price that moved since the buyer's quote (test hook), part of the hash like any price
  const sig = JSON.stringify([bump, groups.map((g) => [g.sellerId, g.brandId, g.selected?.speed, g.totalCents, g.lines.map((l) => [l.variantId, l.quantity, l.unitPriceCents])]), a.country, a.region, a.postalCode]);
  return { currency: "USD", groups, itemsCents: groups.reduce((n, g) => n + g.itemsCents, 0) + bump, shippingCents: groups.reduce((n, g) => n + g.shippingCents, 0), taxCents: 0, totalCents: total, canPay: groups.length > 0 && groups.every((g) => g.selected), quoteHash: `${Math.floor(Date.now() / 1000) + 900}.${createHash("sha256").update(sig).digest("hex")}`, expiresAt: new Date(Date.now() + 900_000).toISOString(), _sig: sig };
}
const publicQuote = (q) => {
  const out = { ...q };
  delete out._sig;
  return out;
};

const bookingsDb = new Map();
const quotesDb = new Map();
const SERVICE_SLUGS = ["deep-house-cleaning", "custom-kitchen-remodel"];
const slugOf = (listingId) => SERVICE_SLUGS.find((x) => gid(`l:${x}`) === listingId) ?? null;
const slotAt = (days, hour) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const POLICY = { cancelFreeHours: 24, cancelFeePercent: 50, noShowFeePercent: 100, maxReschedules: 2, approvalHours: null };
const gidLine = () => `ln_${randomBytes(6).toString("hex")}`;

const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...extra });
  res.end(body === undefined ? "" : JSON.stringify(body));
};
const readBody = (req) => new Promise((resolve) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
});
const bearer = (req) => /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
const userFor = (req) => { const id = sessions.get(bearer(req) ?? ""); return id ? [...users.values()].find((u) => u.id === id) : undefined; };

function forwardingOk(req) {
  const ip = req.headers["x-solvelt-client-ip"], ts = req.headers["x-solvelt-client-timestamp"], sig = req.headers["x-solvelt-client-signature"];
  if (!ip || !ts || !sig || !forwardingKey) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  return sig === `v1=${createHmac("sha256", forwardingKey).update(`${ts}\n${ip}`).digest("hex")}`;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://mock");
  const path = url.pathname;
  if (path === "/health") return send(res, 200, { status: "ok" });

  if (path.startsWith("/__test/")) {
    if (path === "/__test/pay") { const o = checkoutOrders.get(url.searchParams.get("number") ?? ""); if (!o) return send(res, 404, { code: "not_found" }); o.status = url.searchParams.get("status") ?? "placed"; if (o.status === "placed") carts.set(o.key, []); return send(res, 200, { status: o.status }); }
    if (path === "/__test/force-price-change") { priceBump.set(url.searchParams.get("email") ?? "", 100); return send(res, 204); }
    if (path === "/__test/bad-publishable-key") { badPublishableKey.add(url.searchParams.get("email") ?? ""); return send(res, 204); }
    if (path === "/__test/checkout-orders") return send(res, 200, [...checkoutOrders.entries()].map(([number, o]) => ({ number, status: o.status, key: o.key.slice(0, 2), guestEmail: o.guestEmail, token: o.token, address: o.address, giftMessage: o.giftMessage })));
    if (path === "/__test/outbox") return send(res, 200, outbox);
    if (path === "/__test/fail-signout-once") { const t = url.searchParams.get("token"); if (t) failSignOutOnce.add(t); return send(res, 204); }
    if (path === "/__test/fail-signout") { const t = url.searchParams.get("token"); if (t) failSignOut.add(t); return send(res, 204); }
    if (path === "/__test/revoke") { const t = url.searchParams.get("token"); if (t) sessions.delete(t); return send(res, 204); }
    if (path === "/__test/add-passkeys") {   // creates passkeys for a user without a ceremony: ?email=&count=
      const u = users.get(String(url.searchParams.get("email") ?? "").toLowerCase());
      if (!u) return send(res, 404, { code: "not_found", message: "no such user" });
      const n = Math.min(10, Number(url.searchParams.get("count") ?? 1));
      for (let i = 0; i < n; i++) { const id = randomBytes(6).toString("hex"); passkeys.set(`seed-${id}`, { id, userId: u.id, credentialId: `seed-${id}`, name: `Seeded passkey ${i + 1}`, createdAt: new Date().toISOString() }); }
      return send(res, 200, { added: n });
    }
    if (path === "/__test/auth-at") { const t = url.searchParams.get("token") ?? ""; return send(res, 200, { authAt: authAt.get(t) ?? null }); }
    if (path === "/__test/tokens") {
      const email = url.searchParams.get("email");
      const uid = email ? users.get(email.toLowerCase())?.id : undefined;
      return send(res, 200, [...sessions].filter(([, id]) => !email || id === uid).map(([t]) => t));
    }
    if (path === "/__test/seen") return send(res, 200, seen);
    if (path === "/__test/unsub-calls") return send(res, 200, { calls: unsubCalls.get(url.searchParams.get("token") ?? "") ?? 0 });
    if (path === "/__test/seed-order") {
      // Orders as the API reports them (API docs "Buyer orders"). status: new | shipped | delivered.
      const email = (url.searchParams.get("email") ?? "").toLowerCase();
      const status = url.searchParams.get("status") ?? "new";
      const u = users.get(email);
      if (!u) return send(res, 404, { code: "not_found" });
      const number = `MP-E2E-${randomBytes(4).toString("hex").toUpperCase()}`;
      const shipped = status !== "new";
      orders.set(number, { userId: u.id, createdAt: new Date().toISOString(), group: {
        sellerOrderNumber: `SO-${randomBytes(3).toString("hex").toUpperCase()}`, sellerName: "Challah Corner", brandName: "Challah Corner", status, deliveryKind: "carrier", shippingSpeed: "standard", localDate: null,
        itemsCents: 1300, shippingCents: 500, taxCents: 100, totalCents: 1900, refundedCents: 0, oversold: false, acceptedAt: null, shippedAt: shipped ? new Date().toISOString() : null,
        deliveredAt: status === "delivered" ? new Date().toISOString() : null, deliveredBy: null, cancelledAt: null, deliveryAttemptsFailed: 0, lastAttemptFailedReason: null, buyerConfirmedAt: null,
        cancelRequest: null, refunds: [],
        returns: url.searchParams.get("badlabel") ? [{ returnId: "ret-1", status: "approved", reason: "damaged", decisionNote: null, createdAt: new Date().toISOString(), lines: [], canRefreshLabel: false, label: { url: "javascript:alert(1)", expiresAt: new Date(Date.now() + 3600e3).toISOString(), carrier: "USPS", trackingNumber: null, trackingUrl: null } }] : [],
        lines: [{ lineId: `${number}-1`, title: "Classic challah", variantName: "Large", quantity: 2, unitPriceCents: 650, lineTotalCents: 1300, taxCents: 100, shippedQty: shipped ? 2 : 0, cancelledQty: 0, returnedQty: 0, refundedQty: 0, returnableQty: shipped ? 2 : 0 }],
        shipments: shipped ? [{ id: `sh-${number}`, method: "carrier", carrier: "USPS", service: "Priority", trackingNumber: "9400111", trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111", shippedAt: new Date().toISOString(),
          deliveredAt: status === "delivered" ? new Date().toISOString() : null, voided: false, trackingStatus: status === "delivered" ? "delivered" : "in_transit", trackingStatusDetail: status === "delivered" ? "Delivered" : "Departed facility",
          eta: null, etaWindowStart: null, etaWindowEnd: null, driverFirstName: null, placement: status === "delivered" ? "front_door" : null,
          timeline: [{ status: "in_transit", detail: "Departed facility", location: "Brooklyn, NY", at: new Date().toISOString() }], position: url.searchParams.get("position") ? { lat: 40.693, lng: -73.99, at: new Date().toISOString() } : null, proofCount: status === "delivered" ? 1 : 0, lines: [{ lineId: `${number}-1`, quantity: 2 }] }] : [],
      } });
      return send(res, 200, { number, sellerOrderNumber: orders.get(number).group.sellerOrderNumber });
    }
    if (path === "/__test/seed-notification") {
      const u = users.get((url.searchParams.get("email") ?? "").toLowerCase());
      if (!u) return send(res, 404, { code: "not_found" });
      const list = notifs.get(u.id) ?? [];
      const n = { id: randomBytes(8).toString("hex"), kind: url.searchParams.get("kind") ?? "order_shipped", category: "shipped", orderNumber: url.searchParams.get("order") ?? "MP-E2E-1", sellerOrderNumber: null,
        parameters: { sellerName: "Challah Corner", carrier: "USPS", threadId: "t1" }, createdAt: new Date(Date.now() - list.length * 1000).toISOString(), read: false };
      notifs.set(u.id, [n, ...list]);
      return send(res, 200, { id: n.id });
    }
    if (path === "/__test/seed-thread") {
      const u = users.get((url.searchParams.get("email") ?? "").toLowerCase());
      if (!u) return send(res, 404, { code: "not_found" });
      const id = randomBytes(6).toString("hex");
      const t = { userId: u.id, kind: "order", subject: "Order MP-E2E-1", sellerName: "Challah Corner", orderNumber: "MP-E2E-1", listingId: null, messages: [] };
      t.messages.push({ id: `${id}-1`, direction: "buyer", status: "sent", sentAt: new Date(Date.now() - 600000).toISOString(), read: false, reported: false, hidden: false, text: "Is it nut free?", attachments: [] });
      t.messages.push({ id: `${id}-2`, direction: "seller", status: "received", sentAt: new Date(Date.now() - 300000).toISOString(), read: false, reported: false, hidden: false, text: "Yes, it is nut free. Photo attached.",
        attachments: [{ id: `att${id}`, fileName: "ingredients.pdf", size: 52000, type: "application/pdf", available: true }, { id: `gone${id}`, fileName: "removed.png", size: 10, type: null, available: false }] });
      threads.set(id, t);
      return send(res, 200, { id });
    }
    if (path === "/__test/book-set") { const b = bookingsDb.get(url.searchParams.get("id") ?? ""); if (!b) return send(res, 404, { code: "not_found" }); for (const k of ["proposedStartAt", "requiresBuyerConsent", "startAt", "extraChargeState", "additionalChargeCents", "number", "paymentDueAt", "holdExpiresAt"]) { const v = url.searchParams.get(k); if (v !== null) b[k] = k === "requiresBuyerConsent" ? v === "true" : k === "additionalChargeCents" ? Number(v) : v; } return send(res, 204); }
    if (path === "/__test/book-status") { const b = bookingsDb.get(url.searchParams.get("id") ?? ""); if (!b) return send(res, 404, { code: "not_found" }); b.status = url.searchParams.get("status") ?? b.status; return send(res, 204); }
    if (path === "/__test/quote-send") { const qq = quotesDb.get(url.searchParams.get("id") ?? ""); if (!qq) return send(res, 404, { code: "not_found" }); qq.status = url.searchParams.get("status") ?? "Quoted"; qq.priceCents = Number(url.searchParams.get("price") ?? "40000"); qq.durationMinutes = 180; qq.slots = [slotAt(3, 15), slotAt(4, 15)]; qq.expiresAt = new Date(Date.now() + 3 * 86400000).toISOString(); qq.note = "Bring your own tap please"; qq.legacy = url.searchParams.get("legacy") === "1"; return send(res, 204); }
    if (path === "/__test/reports") return send(res, 200, reports);
    if (path === "/__test/prefs") { const u = users.get((url.searchParams.get("email") ?? "").toLowerCase()); return send(res, 200, u ? prefs.get(u.id) ?? null : null); }
    if (path === "/__test/reset") { carts.clear(); threads.clear(); reports.length = 0; notifs.clear(); prefs.clear(); orders.clear(); addresses.clear(); passkeys.clear(); challenges.clear(); users.clear(); sessions.clear(); outbox.length = 0; seen.length = 0; return send(res, 204); }
    return send(res, 404, { code: "not_found", message: "Not found" });
  }

  if (path === "/__stripe/v3.js") {
    // A stand-in for Stripe.js so E2E never touches the network: a "Payment Element" with one input and a confirmPayment that sends the browser to the return_url, as Stripe does after paying.
    res.writeHead(200, { "Content-Type": "application/javascript" });
    return res.end(`window.Stripe = function (pk) { window.__stripePk = pk; return { elements: function (o) { window.__stripeSecret = o.clientSecret; return { create: function () { return { mount: function (sel) { var el = document.querySelector(sel); var l = document.createElement("label"); l.textContent = "Card number "; var i = document.createElement("input"); i.setAttribute("autocomplete", "cc-number"); l.appendChild(i); el.appendChild(l); } }; } }; }, confirmPayment: function (a) { return new Promise(function () { location.assign(a.confirmParams.return_url + "?redirect_status=succeeded"); }); } }; };`);
  }
  seen.push({ method: req.method, path, forwardingOk: forwardingOk(req), hasAuth: !!req.headers.authorization, tokenTail: (bearer(req) ?? "").slice(-8), clientIp: req.headers["x-solvelt-client-ip"] ?? null, idem: req.headers["idempotency-key"] ?? null });
  const body = ["POST", "PUT", "PATCH"].includes(req.method ?? "") ? await readBody(req) : {};

  if (path === "/api/v1/auth/sign-up" && req.method === "POST") {
    const email = String(body.email ?? "").toLowerCase();
    if (email.includes("taken-422")) return send(res, 422, { code: "validation_failed", message: "Invalid", errors: { email: "This email is already registered" } });
    if (String(body.password ?? "").length < 12) return send(res, 422, { code: "validation_failed", message: "Invalid", errors: { password: "Use at least 12 characters." } });
    if (!users.has(email)) {
      const token = randomBytes(12).toString("hex");
      users.set(email, { id: randomBytes(6).toString("hex"), email, displayName: String(body.displayName), password: String(body.password), verified: false, verifyToken: token });
      outbox.push({ kind: "verify", email, token });
    } // an existing address gets the same 204: no enumeration
    return send(res, 204);
  }
  if (path === "/api/v1/auth/resend-verification" && req.method === "POST") {
    if (String(body.email ?? "").includes("resend-boom")) return send(res, 503, { code: "unavailable", message: "Down" });
    const u = users.get(String(body.email ?? "").toLowerCase());
    if (u && !u.verified) { u.verifyToken = randomBytes(12).toString("hex"); outbox.push({ kind: "verify", email: u.email, token: u.verifyToken }); } // older links stop working
    return send(res, 204);
  }
  if (path === "/api/v1/auth/verify-email" && req.method === "POST") {
    // O-16: needs the password chosen at sign-up. Missing -> 422. A wrong password and a bad/expired token get the SAME generic
    // 400, and a wrong password leaves the link valid. Wrong passwords count toward the per-address limit like sign-in.
    if (typeof body.password !== "string" || body.password === "") return send(res, 422, { code: "validation_failed", message: "Invalid", errors: { password: "Required" } });
    const u = [...users.values()].find((x) => x.verifyToken === body.token && body.token);
    if (u && (u.wrongPasswords ?? 0) >= 8) return send(res, 429, { code: "rate_limited", message: "Slow down" }, { "Retry-After": "60" });
    if (!u || u.password !== body.password) { if (u) u.wrongPasswords = (u.wrongPasswords ?? 0) + 1; return send(res, 400, { code: "invalid_token", message: "Invalid or expired" }); }
    u.verified = true; u.verifyToken = undefined;
    return send(res, 204);
  }
  if (path === "/api/v1/config" && req.method === "GET") return send(res, 200, { demoEnabled: demoOn });
  if (path.startsWith("/api/v1/demo/")) {
    if (!demoOn) return send(res, 404, { code: "not_found", message: "Not found" });          // while the flag is off every demo route is a 404, signed in or not
    if (path === "/api/v1/demo/verify" && req.method === "POST") {
      const u = users.get(String(body.email ?? "").toLowerCase());
      if (u && (u.wrongPasswords ?? 0) >= 8) return send(res, 429, { code: "rate_limited", message: "Slow down" }, { "Retry-After": "60" });
      if (!u || u.password !== body.password) { if (u) u.wrongPasswords = (u.wrongPasswords ?? 0) + 1; return send(res, 401, { code: "invalid_credentials", message: "Invalid" }); }
      u.verified = true; u.verifyToken = undefined;
      return send(res, 204);
    }
    const du = userFor(req);
    if (!du) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (path === "/api/v1/demo/status" && req.method === "GET") return send(res, 200, { hasDemoData: demoData.has(du.id), counts: demoCounts(du) });
    if (path === "/api/v1/demo/fill" && req.method === "POST") {
      const already = demoData.has(du.id); demoData.add(du.id);
      return send(res, already ? 200 : 201, { batchId: randomBytes(8).toString("hex"), created: !already, counts: DEMO_COUNTS, notes: [] });
    }
    if (path === "/api/v1/demo/remove" && req.method === "POST") { const removed = demoCounts(du); demoData.delete(du.id); return send(res, 200, { removed }); }
  }
  if (path === "/api/v1/auth/sign-in" && req.method === "POST" && body.password === "trigger-429") return send(res, 429, { code: "rate_limited", message: "Slow down" }, { "Retry-After": "30" });
  if (path === "/api/v1/auth/sign-in" && req.method === "POST") {
    const u = users.get(String(body.email ?? "").toLowerCase());
    // Progressive per-address limit (decision O-17 on the API side): after 8 wrong passwords the address is answered with
    // 429, whoever asks and whatever session or cookie they hold; even the right password waits. Not reset by a success.
    if (u && (u.wrongPasswords ?? 0) >= 8) return send(res, 429, { code: "rate_limited", message: "Slow down" }, { "Retry-After": "60" });
    if (!u || u.password !== body.password) { if (u) u.wrongPasswords = (u.wrongPasswords ?? 0) + 1; return send(res, 401, { code: "invalid_credentials", message: "Invalid" }); }
    if (!u.verified) return send(res, 403, { code: "email_not_verified", message: "Verify first" });
    const token = `tok_${randomBytes(24).toString("hex")}`;
    sessions.set(token, u.id);
    return send(res, 200, { token, user: { id: u.id, displayName: u.displayName } });
  }
  if ((path === "/api/v1/auth/sign-out" || path === "/api/v1/auth/sign-out-all") && req.method === "POST" && failSignOutOnce.delete(bearer(req) ?? "")) return send(res, 503, { code: "unavailable", message: "Blip" });
  if ((path === "/api/v1/auth/sign-out" || path === "/api/v1/auth/sign-out-all") && req.method === "POST" && failSignOut.has(bearer(req) ?? "")) return send(res, 503, { code: "unavailable", message: "Down" });
  if (path === "/api/v1/auth/sign-out" && req.method === "POST") { sessions.delete(bearer(req) ?? ""); return send(res, 204); }
  if (path === "/api/v1/auth/sign-out-all" && req.method === "POST") {
    const u = userFor(req);
    if (u) for (const [t, id] of sessions) if (id === u.id) sessions.delete(t);
    return send(res, 204);
  }
  if (path === "/api/v1/auth/forgot-password" && req.method === "POST") {
    const u = users.get(String(body.email ?? "").toLowerCase());
    if (u) { const token = randomBytes(12).toString("hex"); u.resetToken = token; outbox.push({ kind: "reset", email: u.email, token }); }
    return send(res, 204);
  }
  if (path === "/api/v1/auth/reset-password" && req.method === "POST") {
    const u = [...users.values()].find((x) => x.resetToken && x.resetToken === body.token);
    if (!u) return send(res, 400, { code: "invalid_token", message: "Invalid or expired" });
    u.password = String(body.password); u.resetToken = undefined;
    u.verified = true; u.verifyToken = undefined; // O-16: the reset link proves control of the mailbox
    for (const [t, id] of sessions) if (id === u.id) sessions.delete(t); // all devices signed out
    return send(res, 204);
  }
  if (path === "/api/v1/auth/reauthenticate" && req.method === "POST") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (typeof body.password !== "string" || body.password === "") return send(res, 422, { code: "validation_failed", message: "Invalid", errors: { password: "Required" } });
    if (body.password === "trigger-429" || (u.wrongPasswords ?? 0) >= 8) return send(res, 429, { code: "rate_limited", message: "Slow down" }, { "Retry-After": "60" }); // same per-address gate as sign-in
    if (u.password !== body.password) { u.wrongPasswords = (u.wrongPasswords ?? 0) + 1; return send(res, 401, { code: "invalid_credentials", message: "Invalid" }); }
    authAt.set(bearer(req), Date.now());
    return send(res, 204);
  }
  if (path === "/api/v1/account/me" && req.method === "GET") {
    const u = userFor(req);
    return u ? send(res, 200, { id: u.id, displayName: u.displayName, email: u.email }) : send(res, 401, { code: "unauthorized", message: "Sign in required" });
  }
  // ---- account: privacy (API M5-32 data export, M1 account deletion) ----
  if (path === "/api/v1/account/data-export" && req.method === "POST") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    const body = JSON.stringify({ generatedAt: new Date().toISOString(), sections: { account: { profile: { email: u.email, displayName: u.displayName, phone: u.phone ?? null }, addresses: [] }, messages: [], notifications: { notifications: [], emailSettings: {} }, "cancellations-and-returns": { cancelRequests: [], returns: [] } } });
    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="solvelt-my-data.json"', "Cache-Control": "private, no-store" });
    return res.end(body);
  }
  if (path === "/api/v1/account/delete" && req.method === "POST") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (u.password !== body.password) return send(res, 401, { code: "invalid_credentials", message: "The password is not correct." });
    for (const [t, id] of [...sessions]) if (id === u.id) sessions.delete(t);
    users.delete(u.email);
    return send(res, 204);
  }
  // ---- account: profile ----
  if (path === "/api/v1/account/profile") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (req.method === "PUT") {
      const b = body;
      if (!String(b.displayName ?? "").trim()) return send(res, 422, { code: "validation_failed", message: "Invalid", errors: { displayName: "Enter your name." } });
      u.displayName = String(b.displayName).trim(); u.phone = String(b.phone ?? "");
    }
    return send(res, 200, { id: u.id, displayName: u.displayName, email: u.email, phone: u.phone ?? "" });
  }

  // ---- messages (another buyer's thread is a 404) ----
  const mm = /^\/api\/v1\/messages(?:\/threads(?:\/([^/]+)(\/read)?)?|\/attachments\/([^/]+)|\/([^/]+)\/report)?$/.exec(path);
  if (mm) {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    const mine = () => [...threads.entries()].filter(([, t]) => t.userId === u.id);
    const lastOf = (t) => t.messages[t.messages.length - 1];
    if (path === "/api/v1/messages" && req.method === "POST") {
      const text = String(body.text ?? "");
      if (!text.trim()) return send(res, 422, { code: "validation_failed", errors: { text: "Write a message." } });
      if (/@|paypal/i.test(text) && body.acknowledgeWarning !== true) return send(res, 409, { code: "contact_details_warning", message: "Keep details on Solvelt", errors: { [/@/.test(text) ? "email" : "payment_or_chat_app"]: "x" } });
      let id = body.threadId, t = id ? threads.get(id) : undefined;
      if (id && (!t || t.userId !== u.id)) return send(res, 404, { code: "not_found" });
      if (!t) {
        id = randomBytes(6).toString("hex");
        t = body.marketplaceBookingId
          ? { userId: u.id, kind: "booking", subject: `Booking ${body.marketplaceBookingId}`, sellerName: "Studio Shalom", orderNumber: null, listingId: null, marketplaceBookingId: body.marketplaceBookingId, messages: [] }
          : { userId: u.id, kind: body.listingId ? "product" : "order", subject: body.listingId ? "Classic challah" : `Order ${body.orderNumber}`, sellerName: "Challah Corner", orderNumber: body.orderNumber ?? null, listingId: body.listingId ?? null, messages: [] };
        threads.set(id, t);
      }
      t.messages.push({ id: `${id}-${t.messages.length + 1}`, direction: "buyer", status: "pending", sentAt: new Date().toISOString(), read: true, reported: false, hidden: false, text, attachments: [] });
      return send(res, 202, { threadId: id, messageId: `${id}-m`, status: "pending" });
    }
    if (mm[3]) {
      const hit = [...threads.values()].find((t) => t.userId === u.id && t.messages.some((m) => m.attachments.some((a) => a.id === mm[3] && a.available)));
      if (!hit) return send(res, 404, { code: "not_found" });
      const pdf = Buffer.from("%PDF-1.4\n%%EOF");
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="ingredients.pdf"', "Content-Length": pdf.length }); return res.end(pdf);
    }
    if (mm[4]) {
      const hit = [...threads.values()].find((t) => t.userId === u.id && t.messages.some((m) => m.id === mm[4]));
      if (!hit) return send(res, 404, { code: "not_found" });
      if (!String(body.reason ?? "").trim()) return send(res, 422, { code: "validation_failed", errors: { reason: "x" } });
      hit.messages.find((m) => m.id === mm[4]).reported = true; reports.push({ messageId: mm[4], reason: body.reason });
      return send(res, 202, { reported: true });
    }
    if (!mm[1]) {
      const list = mine().sort((a, b) => lastOf(b[1]).sentAt.localeCompare(lastOf(a[1]).sentAt));
      const unread = (t) => t.messages.filter((m) => m.direction === "seller" && !m.read).length;
      return send(res, 200, { unreadCount: list.reduce((n, [, t]) => n + unread(t), 0), threads: list.map(([id, t]) => ({ id, kind: t.kind, subject: t.subject, sellerName: t.sellerName, orderNumber: t.orderNumber, listingId: t.listingId, marketplaceBookingId: t.marketplaceBookingId ?? null, lastMessageAt: lastOf(t).sentAt, unreadCount: unread(t), preview: lastOf(t).text })), next: null });
    }
    const t = threads.get(mm[1]);
    if (!t || t.userId !== u.id) return send(res, 404, { code: "not_found", message: "Not found" });
    if (mm[2]) { t.messages.forEach((m) => { if (m.direction === "seller") m.read = true; }); return send(res, 204); }
    return send(res, 200, { thread: { id: mm[1], kind: t.kind, subject: t.subject, sellerName: t.sellerName, listingId: t.listingId, marketplaceBookingId: t.marketplaceBookingId ?? null }, messages: t.messages, older: null });
  }

  // ---- notifications (the unsubscribe token is "U.<email>.<category|all>": the mock does not sign) ----
  if (path === "/api/v1/notifications/unsubscribe" && req.method === "POST") {
    unsubCalls.set(String(body.token ?? ""), (unsubCalls.get(String(body.token ?? "")) ?? 0) + 1);
    if (/\.expired$/.test(String(body.token ?? ""))) return send(res, 400, { code: "expired_token", message: "This link has expired. Sign in to change your email settings." });   // a signed token past its 90 days (API M5-17)
    const m = /^U\.([^.]+@[^.]+\.[a-z]+)\.([a-z_]+)$/i.exec(String(body.token ?? ""));
    const u = m ? users.get(m[1].toLowerCase()) : undefined;
    if (!m || !(m[2] === "all" || CATEGORIES.includes(m[2]))) return send(res, 400, { code: "invalid_token", message: "This link is not valid." });
    if (u) { const p = prefs.get(u.id) ?? Object.fromEntries(CATEGORIES.map((c) => [c, true])); for (const c of m[2] === "all" ? CATEGORIES : [m[2]]) p[c] = false; prefs.set(u.id, p); }
    return send(res, 204);
  }
  const nm = /^\/api\/v1\/notifications(?:\/(read-all|preferences)|\/([^/]+)\/read)?$/.exec(path);
  if (nm) {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    const list = notifs.get(u.id) ?? [];
    if (nm[1] === "preferences") {
      const p = prefs.get(u.id) ?? Object.fromEntries(CATEGORIES.map((c) => [c, true]));
      const ALWAYS = ["refunds", "cancellations", "delivery_problems", "returns", "booking_changes"];   // required mail (API O-21): false is a 422 and nothing changes
      if (req.method === "PUT") {
        const e = Object.entries(body.email ?? {});
        if (e.some(([k, v]) => ALWAYS.includes(k) && v !== true) || e.some(([k]) => !CATEGORIES.includes(k) && !ALWAYS.includes(k))) return send(res, 422, { code: "validation_failed", message: "Required for your orders and account", fieldErrors: { email: "Required for your orders and account" } });
        for (const [k, v] of e) if (CATEGORIES.includes(k)) p[k] = v === true;
        prefs.set(u.id, p);
      }
      return send(res, 200, { email: p, alwaysOn: ALWAYS });
    }
    if (nm[1] === "read-all") { list.forEach((n) => (n.read = true)); return send(res, 204); }
    if (nm[2]) { const n = list.find((x) => x.id === nm[2]); if (!n) return send(res, 404, { code: "not_found" }); n.read = true; return send(res, 204); }
    return send(res, 200, { unreadCount: list.filter((n) => !n.read).length, notifications: list, next: null });
  }

  // ---- buyer orders (another buyer's order is a 404) ----
  const om = /^\/api\/v1\/orders(?:\/([^/]+)(?:\/(cancel-requests|return-requests|delivery-confirmations)|\/returns\/([^/]+)\/label-link|\/shipments\/([^/]+)\/proof\/(\d+))?)?$/.exec(path);
  if (om) {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    const view = (number, o) => {
      const g = o.group;
      const canCancel = ["new", "accepted"].includes(g.status) && !g.cancelRequest;
      const canConfirm = g.status === "shipped" && !g.buyerConfirmedAt;
      const canReturn = ["shipped", "delivered"].includes(g.status) && g.lines.some((l) => l.returnableQty > 0);
      return { number, status: "placed", createdAt: o.createdAt, paidAt: o.createdAt, currency: "USD", itemsCents: 1300, shippingCents: 500, taxCents: 100, totalCents: 1900, refundedCents: 0,
        shipTo: { name: "Dana Levi", line1: "1 Main St", line2: null, city: "Brooklyn", region: "NY", postalCode: "11201", country: "US" }, giftMessage: null,
        groups: [{ ...g, canCancel, canConfirmDelivery: canConfirm, canReturn }] };
    };
    const number = om[1];
    if (!number) {
      const mine = [...orders.entries()].filter(([, o]) => o.userId === u.id);
      return send(res, 200, { orders: mine.map(([n, o]) => ({ number: n, createdAt: o.createdAt, currency: "USD", totalCents: 1900, refundedCents: 0, groups: [{ sellerOrderNumber: o.group.sellerOrderNumber, sellerName: o.group.sellerName, brandName: o.group.brandName, status: o.group.status, itemCount: 2, firstItem: "Classic challah" }] })), next: null });
    }
    const o = orders.get(number);
    if (!o || o.userId !== u.id) return send(res, 404, { code: "not_found", message: "Not found" });
    if (!om[2] && !om[3] && !om[4]) return send(res, 200, view(number, o));
    if (om[4] !== undefined) {
      const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
      res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length }); return res.end(png);
    }
    const g = o.group;
    if (om[2] === "cancel-requests") { g.cancelRequest = { status: "requested", reason: String(body.reason ?? ""), decisionNote: null, createdAt: new Date().toISOString() }; return send(res, 202, { requestId: "CR-1", status: "pending" }); }
    if (om[2] === "delivery-confirmations") { g.buyerConfirmedAt = new Date().toISOString(); return send(res, 202, { status: "confirming" }); }
    if (om[2] === "return-requests") {
      const lines = Array.isArray(body.lines) ? body.lines : [];
      for (const l of lines) { const line = g.lines.find((x) => x.lineId === l.lineId); if (!line || l.quantity > line.returnableQty) return send(res, 422, { code: "quantity_exceeded", message: "Too many", errors: { lines: "Too many" } }); }
      for (const l of lines) g.lines.find((x) => x.lineId === l.lineId).returnableQty -= l.quantity;
      g.returns.push({ returnId: `RT-${g.returns.length + 1}`, status: "approved", reason: body.reason, decisionNote: null, createdAt: new Date().toISOString(), lines, label: null, canRefreshLabel: true });
      return send(res, 202, { returnId: `RT-${g.returns.length}`, status: "pending" });
    }
    if (om[3]) { const r = g.returns.find((x) => x.returnId === om[3]); if (!r) return send(res, 404, { code: "not_found" }); r.label = { url: "https://portal.example/api/v1/shipping/public/labels/L1?exp=9999999999&sig=x", expiresAt: new Date(Date.now() + 86400000).toISOString(), carrier: "USPS", trackingNumber: "RT1", trackingUrl: null }; return send(res, 200, { labelUrl: r.label.url, labelUrlExpiresAt: r.label.expiresAt }); }
  }

  // ---- account: addresses (another user's address is a 404, never 403) ----
  const am = /^\/api\/v1\/account\/addresses(?:\/([^/]+?)(\/default)?)?$/.exec(path);
  if (am) {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    const mine = () => [...addresses.entries()].filter(([, a]) => a.userId === u.id);
    const pub = ([id, a]) => ({ id, fullName: a.fullName, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode, country: a.country, phone: a.phone, isDefault: a.isDefault });
    const makeDefault = (id) => mine().forEach(([k, a]) => { a.isDefault = k === id; });
    const id = am[1];
    if (!id) {
      if (req.method === "GET") return send(res, 200, mine().map(pub));
      if (req.method === "POST") {
        const b = body;
        const newId = randomBytes(6).toString("hex");
        addresses.set(newId, { userId: u.id, ...b, isDefault: false });
        if (b.isDefault || mine().length === 1) makeDefault(newId);
        return send(res, 201, pub([newId, addresses.get(newId)]));
      }
    } else {
      const a = addresses.get(id);
      if (!a || a.userId !== u.id) return send(res, 404, { code: "not_found", message: "Not found" });
      if (am[2] && req.method === "POST") { makeDefault(id); return send(res, 204); }
      if (req.method === "GET") return send(res, 200, pub([id, a]));
      if (req.method === "PUT") {
        const b = body;
        Object.assign(a, b, { isDefault: a.isDefault });
        if (b.isDefault) makeDefault(id);
        return send(res, 200, pub([id, a]));
      }
      if (req.method === "DELETE") {
        addresses.delete(id);
        const rest = mine();
        if (a.isDefault && rest.length) makeDefault(rest[0][0]);
        return send(res, 204);
      }
    }
  }

  // ---- passkeys. NOTE: the mock checks challenge, ceremony type and one-time use, but does NOT verify signatures (the real API does). ----
  const b64u = (buf) => Buffer.from(buf).toString("base64url");
  const checkClientData = (cred, kind) => {
    try {
      const cd = JSON.parse(Buffer.from(cred.response.clientDataJSON, "base64url").toString("utf8"));
      const ch = challenges.get(String(cred.__challengeId));
      return ch && ch.kind === kind.slice(9) && cd.type === kind && cd.challenge === ch.challenge ? ch : null;
    } catch { return null; }
  };
  if (path === "/api/v1/account/passkeys/options" && req.method === "POST") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    const challenge = b64u(randomBytes(32)), challengeId = randomBytes(8).toString("hex");
    challenges.set(challengeId, { challenge, userId: u.id, kind: "create" });
    return send(res, 200, { challengeId, options: {
      challenge, rp: { id: u.email.includes("badrp") ? "evil.example" : "localhost", name: "Solvelt" }, user: { id: b64u(Buffer.from(u.id)), name: u.email, displayName: u.displayName },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 60000, attestation: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      excludeCredentials: [...passkeys.values()].filter((p) => p.userId === u.id).map((p) => ({ type: "public-key", id: p.credentialId })),
      ...(ipOf(req) === IP.REG_BOTH_DIFFER ? { rpId: "evil.example" } : ipOf(req) === IP.REG_BOTH_SAME ? { rpId: "localhost" } : {}),
    } });
  }
  if (path === "/api/v1/account/passkeys" && (req.method === "GET" || req.method === "POST")) {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (req.method === "GET") return send(res, 200, [...passkeys.values()].filter((p) => p.userId === u.id).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })));
    if (ipOf(req) === IP.REG_5XX) return send(res, 503, { code: "unavailable", message: "Down" });
    if (ipOf(req) === IP.REG_LENIENT) return send(res, 201, { id: "lenient", name: String(body.name || "Passkey"), createdAt: new Date().toISOString() }); // accepts ANY ceremony: only the web-side check can refuse
    const cred = { ...body.credential, __challengeId: body.challengeId };
    const ch = checkClientData(cred, "webauthn.create");
    if (!ch || ch.userId !== u.id) return send(res, 400, { code: "invalid_challenge", message: "Invalid or expired" });
    challenges.delete(String(body.challengeId)); // one-time
    if (passkeys.has(cred.id)) return send(res, 409, { code: "already_registered", message: "Already registered" });
    const p = { id: randomBytes(6).toString("hex"), userId: u.id, credentialId: cred.id, name: String(body.name || "Passkey"), createdAt: new Date().toISOString() };
    passkeys.set(cred.id, p);
    return send(res, 201, { id: p.id, name: p.name, createdAt: p.createdAt });
  }
  // Test accounts pick the API's behaviour by their address: "legacyapi" = an API that predates the password option and the bulk delete (a 405, and the field ignored),
  // "reauthapi" = the API's own clock says "sign in again" until a step-up has happened, "nopassword" = the passkeys are the only way in.
  if (path === "/api/v1/account/passkeys" && req.method === "DELETE") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (u.email.includes("legacyapi")) return send(res, 405, { code: "method_not_allowed", message: "Not allowed" });
    if (u.email.includes("reauthapi") && !authAt.has(bearer(req))) return send(res, 403, { code: "reauthentication_required", message: "Sign in again" });
    const mine = [...passkeys.entries()].filter(([, p]) => p.userId === u.id);
    if (mine.length === 0) return send(res, 409, { code: "no_passkeys", message: "None" });
    if (u.email.includes("nopassword")) return send(res, 409, { code: "last_sign_in_method", message: "Only way in" });
    for (const [k] of mine) passkeys.delete(k);
    return send(res, 204);
  }
  if (path === "/api/v1/account/password" && req.method === "POST") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (u.email.includes("reauthapi") && !authAt.has(bearer(req))) return send(res, 403, { code: "reauthentication_required", message: "Sign in again" });
    if (u.password !== body.currentPassword) return send(res, 401, { code: "invalid_credentials", message: "Invalid" });
    if (String(body.newPassword ?? "").length < 12) return send(res, 422, { code: "validation_failed", message: "Weak", errors: { newPassword: "Use at least 12 characters." } });
    u.password = String(body.newPassword);
    if (body.removePasskeys === true && !u.email.includes("legacyapi")) for (const [k, p] of [...passkeys.entries()]) if (p.userId === u.id) passkeys.delete(k);
    for (const [t, id] of [...sessions.entries()]) if (id === u.id && t !== bearer(req)) sessions.delete(t);   // the other sessions end; this one stays
    return send(res, 204);
  }
  const pm = /^\/api\/v1\/account\/passkeys\/([^/]+)$/.exec(path);
  if (pm && req.method === "DELETE") {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    const hit = [...passkeys.entries()].find(([, p]) => p.id === pm[1] && p.userId === u.id);
    if (!hit) return send(res, 404, { code: "not_found", message: "Not found" });
    if (hit[1].name.includes("undeletable")) return send(res, 503, { code: "unavailable", message: "Down" });
    passkeys.delete(hit[0]);
    return send(res, 204);
  }
  if (path === "/api/v1/auth/passkey/options" && req.method === "POST") {
    const challenge = b64u(randomBytes(32)), challengeId = randomBytes(8).toString("hex");
    challenges.set(challengeId, { challenge, kind: "get" });
    const base = { challenge, timeout: 60000, userVerification: "preferred" };
    const v = ipOf(req);
    const options =
      v === IP.ANON_RPID_EVIL ? { ...base, rpId: "evil.example" }
      : v === IP.ANON_BOTH_DIFFER ? { ...base, rp: { id: "localhost" }, rpId: "evil.example" }
      : v === IP.ANON_BOTH_DIFFER_REV ? { ...base, rp: { id: "evil.example" }, rpId: "localhost" }
      : v === IP.ANON_RP_ONLY_EVIL ? { ...base, rp: { id: "evil.example", name: "Evil" } }
      : v === IP.ANON_BOTH_SAME ? { ...base, rp: { id: "localhost", name: "Solvelt" }, rpId: "localhost" }
      : { ...base, rpId: "localhost" };
    return send(res, 200, { challengeId, options });
  }
  if (path === "/api/v1/auth/passkey/sign-in" && req.method === "POST") {
    if (ipOf(req) === IP.SIGNIN_LENIENT) {
      // Accepts a known credential regardless of challenge, ceremony and single use: only the web-side binding can refuse.
      const lp = passkeys.get(String(body.credential?.id));
      const lu = lp && [...users.values()].find((x) => x.id === lp.userId);
      if (!lu) return send(res, 401, { code: "invalid_credentials", message: "Invalid" });
      const t = `tok_${randomBytes(24).toString("hex")}`;
      sessions.set(t, lu.id);
      return send(res, 200, { token: t, user: { id: lu.id, displayName: lu.displayName } });
    }
    const cred = { ...body.credential, __challengeId: body.challengeId };
    const ch = checkClientData(cred, "webauthn.get");
    challenges.delete(String(body.challengeId));
    const p = ch && passkeys.get(cred.id);
    const u = p && [...users.values()].find((x) => x.id === p.userId);
    if (!u) return send(res, 401, { code: "invalid_credentials", message: "Invalid" });
    p.lastUsedAt = new Date().toISOString();
    const token = `tok_${randomBytes(24).toString("hex")}`;
    sessions.set(token, u.id);
    return send(res, 200, { token, user: { id: u.id, displayName: u.displayName } });
  }

  let im;
  if (req.method === "GET" && (im = /^\/api\/v1\/catalog\/images\/([0-9a-f-]{36})$/.exec(path))) {
    const id = im[1];
    if (id === IMAGE_BAD) return send(res, 502, { code: "bad_image", message: "The image could not be served." });
    if (id === IMAGE_DOWN) return send(res, 503, { code: "image_unavailable", message: "Images are temporarily unavailable." }, { "Retry-After": "30" });
    const info = imageInfo(id);
    if (!info) return send(res, 404, { code: "not_found", message: "Image not found." });
    // a real picture of the stated size: a gradient (so resizes differ from each other) with the listing's first letter's shade; EXIF orientation 1 and a comment to prove it is stripped
    const hue = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 0);
    const bytes = await sharp({ create: { width: info.width, height: info.height, channels: 3, background: { r: hue % 255, g: (hue * 2) % 255, b: (hue * 3) % 255 } } })
      .withMetadata({ exif: { IFD0: { Copyright: "mock original" } } }).png().toBuffer();
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": bytes.length, "Cache-Control": "public, max-age=300" });
    return res.end(bytes);
  }

  if (path === "/api/v1/cart" && req.method === "GET") { const key = cartKeyOf(req); if (key === null) return send(res, 401, { code: "unauthorized" }); return send(res, 200, cartView(key ?? "none")); }
  if (path === "/api/v1/cart/lines" && req.method === "POST") {
    let key = cartKeyOf(req);
    if (key === null) return send(res, 401, { code: "unauthorized" });
    let token;
    if (key === undefined || (key.startsWith("g:") && !carts.has(key))) { token = `cart_${randomBytes(24).toString("hex")}`; key = `g:${token}`; carts.set(key, []); }
    const info = variantInfo(String(body.variantId));
    if (!info) return send(res, 404, { code: "not_found", message: "Not found" });
    if (!info.variant.available) return send(res, 422, { code: "not_purchasable", message: "Not available" });
    const q = Number(body.quantity);
    if (!Number.isInteger(q) || q < 1 || q > 20) return send(res, 422, { code: "quantity_limit", message: "Too many" });
    const lines = carts.get(key) ?? [];
    const have = lines.find((l) => l.variantId === body.variantId);
    if (!have && lines.length >= 50) return send(res, 422, { code: "cart_full", message: "Full" });
    if (have) have.quantity = Math.min(20, have.quantity + q); else lines.push({ id: gidLine(), variantId: body.variantId, quantity: q, seenPrice: info.variant.priceCents });
    carts.set(key, lines);
    return send(res, 200, cartView(key, token));
  }
  const cl = /^\/api\/v1\/cart\/lines\/([A-Za-z0-9_-]+)$/.exec(path);
  if (cl && (req.method === "PATCH" || req.method === "DELETE")) {
    const key = cartKeyOf(req);
    const lines = key ? carts.get(key) : undefined;
    const line = lines?.find((l) => l.id === cl[1]);
    if (!key || !lines || !line) return send(res, key === null ? 401 : 404, { code: key === null ? "unauthorized" : "not_found" });
    if (req.method === "DELETE") carts.set(key, lines.filter((l) => l !== line));
    else { const q = Number(body.quantity); if (!Number.isInteger(q) || q < 1 || q > 20) return send(res, 422, { code: "quantity_limit" }); line.quantity = q; const info = variantInfo(line.variantId); if (info) line.seenPrice = info.variant.priceCents; }
    return send(res, 200, cartView(key));
  }
  if (path === "/api/v1/cart/merge" && req.method === "POST") {
    const key = cartKeyOf(req);
    if (!key || key.startsWith("g:")) return send(res, 401, { code: "unauthorized" });
    const gk = `g:${body.guestToken}`;
    const mine = carts.get(key) ?? [];
    for (const l of carts.get(gk) ?? []) { const h = mine.find((x) => x.variantId === l.variantId); if (h) h.quantity = Math.min(20, h.quantity + l.quantity); else mine.push(l); }
    carts.delete(gk); carts.set(key, mine);
    return send(res, 200, cartView(key));
  }

  if (path === "/api/v1/checkout/quote" && req.method === "POST") {
    const key = cartKeyOf(req);
    if (key === null) return send(res, 401, { code: "unauthorized" });
    const a = body.address ?? {};
    if (!a.country || !a.postalCode || (String(a.country).toUpperCase() === "US" && !/^[A-Za-z]{2}$/.test(a.region ?? ""))) return send(res, 422, { code: "validation_failed", errors: { address: "Enter a delivery country (2 letters), a postal code and, for the US, a state." } });
    if (!key || (carts.get(key) ?? []).length === 0) return send(res, 409, { code: "cart_not_ready", message: "Your cart is empty." });
    return send(res, 200, publicQuote(quoteFor(key, body)));
  }
  if (path === "/api/v1/checkout" && req.method === "POST") {
    const key = cartKeyOf(req);
    if (key === null || key === undefined) return send(res, 401, { code: "unauthorized" });
    const guest = key.startsWith("g:");
    if (guest && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(body.email ?? ""))) return send(res, 422, { code: "validation_failed", errors: { email: "Enter a valid email address." } });
    if ((carts.get(key) ?? []).length === 0) return send(res, 409, { code: "cart_not_ready", message: "Your cart is empty." });
    const a = body.address ?? {};
    const fresh = quoteFor(key, { address: a, selections: body.selections }, guest ? priceBump.get(String(body.email)) ?? 0 : 0);
    if (!fresh.canPay) return send(res, 409, { code: "delivery_unavailable", message: "We can't deliver part of your cart to that address." });
    const given = String(body.quoteHash ?? "");
    const ok = given.slice(given.indexOf(".") + 1) === fresh.quoteHash.slice(fresh.quoteHash.indexOf(".") + 1) && Number(given.split(".")[0]) > Date.now() / 1000;
    if (!ok) return send(res, 409, { code: "price_changed", message: "The price changed.", quote: publicQuote(fresh) });
    // the API's double-submit rule: the same checkout again (same cart, address, delivery, price) is the SAME order, never a second one
    const fingerprint = JSON.stringify([key, a, body.selections ?? [], body.giftMessage ?? "", body.email ?? "", fresh.totalCents]);
    const same = [...checkoutOrders.entries()].find(([, o]) => o.fingerprint === fingerprint && o.status === "pending_payment");
    if (same) {
      const [sn, so] = same;
      return send(res, 200, { orderNumber: sn, status: so.status, quote: publicQuote(fresh), payment: { provider: "stripe", clientSecret: `pi_mock_${sn}_secret_x`, publishableKey: guest && badPublishableKey.has(String(body.email)) ? "pk_live_notallowed12345678" : "pk_test_mockkey12345678" }, ...(so.token ? { guestOrderToken: so.token, guestOrderTokenExpiresAt: so.tokenExpiresAt } : {}) });
    }
    const number = `MP-MOCK-${randomBytes(4).toString("hex").toUpperCase()}`;
    const token = guest ? `g1.${number}.${randomBytes(12).toString("hex")}` : undefined;
    checkoutOrders.set(number, { fingerprint, tokenExpiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(), key, guest, guestEmail: guest ? body.email : null, token, status: "pending_payment", totalCents: fresh.totalCents, createdAt: new Date().toISOString(), groups: fresh.groups.map((g) => ({ sellerName: g.sellerName, brandName: g.brandName, lines: g.lines })), address: a, giftMessage: body.giftMessage ?? null });
    return send(res, 200, { orderNumber: number, status: "pending_payment", quote: publicQuote(fresh), payment: { provider: "stripe", clientSecret: `pi_mock_${number}_secret_x`, publishableKey: guest && badPublishableKey.has(String(body.email)) ? "pk_live_notallowed12345678" : "pk_test_mockkey12345678" }, ...(token ? { guestOrderToken: token, guestOrderTokenExpiresAt: checkoutOrders.get(number).tokenExpiresAt } : {}) });
  }
  const co = /^\/api\/v1\/checkout\/orders\/([A-Za-z0-9_-]+)$/.exec(path);
  if (co && req.method === "GET") {
    const o = checkoutOrders.get(co[1]);
    const key = cartKeyOf(req);
    const guestHdr = req.headers["x-guest-order"];
    const allowed = !!o && ((req.headers.authorization && key && key === o.key) || (!req.headers.authorization && o.token && guestHdr === o.token));
    if (key === null) return send(res, 401, { code: "unauthorized" });
    if (!allowed) return send(res, !req.headers.authorization && !guestHdr ? 401 : 404, { code: "not_found" });
    return send(res, 200, { number: co[1], status: o.status, currency: "USD", totalCents: o.totalCents, createdAt: o.createdAt, paidAt: o.status === "placed" ? o.createdAt : null, groups: o.groups.map((g) => ({ sellerName: g.sellerName, brandName: g.brandName, deliveryKind: "carrier", shippingSpeed: "standard", localDate: null, totalCents: 0, lines: g.lines.map((l) => ({ title: l.title, variantName: l.variantName, quantity: l.quantity, lineTotalCents: l.lineTotalCents })) })) });
  }

  // ---- services and bookings (M4; API repo docs/API.md "Services (M4)"): a small stateful stand-in ----
  const svc = /^\/api\/v1\/services\/([A-Za-z0-9_-]+)\/(availability|options)$/.exec(path);
  if (svc && req.method === "GET") {
    if (svc[2] === "options") return send(res, 200, { available: true, addOns: [{ id: "deep", name: "Deep clean", priceCents: 2500, extraMinutes: 30 }], intakeQuestions: [{ id: "pets", label: "Any pets at home?", kind: "yesNo", required: true }], providers: [{ providerId: "11111111-1111-4111-8111-111111111111", displayName: "Jane D." }], assignment: "buyerChoice", policy: POLICY, travelFeeCents: 1000 });
    const loc = url.searchParams.get("location"), postal = url.searchParams.get("postalCode");
    if (!["online", "customer", "seller"].includes(loc ?? "")) return send(res, 422, { code: "validation_failed", errors: { location: "required" } });
    if (loc === "customer" && !postal) return send(res, 422, { code: "validation_failed", errors: { postalCode: "required" } });
    if (postal === "99999") return send(res, 422, { code: "outside_service_area" });
    const slots = [[2, 14], [2, 16], [3, 14]].map(([d, h]) => ({ startAt: slotAt(d, h), endAt: slotAt(d, h + 4), providerIds: ["pv1"] }));
    return send(res, 200, { durationMinutes: 240, priceCents: 24000, providers: [{ providerId: "pv1", timeZone: "America/New_York" }], slots, from: slotAt(0, 0), to: slotAt(14, 0), fetchedAt: new Date().toISOString() }, { "Cache-Control": "no-store" });
  }
  const bookingView = (b) => ({ id: b.id, number: b.number, listingId: b.listingId, status: b.status, location: b.location, startAt: b.startAt, endAt: b.endAt, durationMinutes: 240, currency: "USD", priceCents: 24000, addOnsCents: 0, travelFeeCents: 0, totalCents: 24000, holdExpiresAt: b.status === "Hold" ? b.holdExpiresAt : null, holdExpired: b.status === "Hold" && Date.parse(b.holdExpiresAt) <= Date.now(), approvalDeadline: null, proposedStartAt: b.proposedStartAt ?? null, requiresBuyerConsent: !!b.requiresBuyerConsent, createdAt: b.createdAt, policy: b.status === "Hold" ? null : POLICY, extraChargeState: b.extraChargeState ?? null, additionalChargeCents: b.additionalChargeCents ?? null,
    paymentDueAt: b.paymentDueAt && Date.parse(b.paymentDueAt) > Date.now() && ["Confirmed", "Requested", "Rescheduled"].includes(b.status) ? b.paymentDueAt : null,
    needsPayment: !!b.paymentDueAt && Date.parse(b.paymentDueAt) > Date.now() && ["Confirmed", "Requested", "Rescheduled"].includes(b.status), listingSlug: slugOf(b.listingId) });
  if (path.startsWith("/api/v1/quotes")) {
    const owner = userFor(req);
    if (!owner) return send(res, 401, { code: "unauthorized" });
    const quoteView = (qq) => ({ id: qq.id, listingId: qq.listingId, status: qq.status, location: qq.location, details: qq.details, preferredTimes: [], currency: "USD", priceCents: qq.priceCents ?? null, durationMinutes: qq.durationMinutes ?? null, slots: qq.slots ?? [], providerId: null, expiresAt: qq.expiresAt ?? null, expired: false, note: qq.note ?? null, declineReason: null, bookingId: qq.bookingId ?? null, createdAt: qq.createdAt });
    if (path === "/api/v1/quotes" && req.method === "POST") {
      const key = String(req.headers["idempotency-key"] ?? "");
      if (!/^[A-Za-z0-9\-_.:]{8,100}$/.test(key)) return send(res, 422, { code: "validation_failed" });
      const seen = [...quotesDb.values()].find((x) => x.owner === owner.id && x.key === key);
      if (seen) return send(res, 200, { created: false, quote: quoteView(seen) });
      if (String(body.details ?? "").trim().length < 10) return send(res, 422, { code: "validation_failed", errors: { details: "too short" } });
      const qq = { id: `00000000-0000-4000-9000-${randomBytes(6).toString("hex")}`, owner: owner.id, key, listingId: String(body.listingId), status: "Requested", location: body.location, details: String(body.details), createdAt: new Date().toISOString() };
      quotesDb.set(qq.id, qq);
      return send(res, 201, { created: true, quote: quoteView(qq) });
    }
    if (path === "/api/v1/quotes" && req.method === "GET") return send(res, 200, { quotes: [...quotesDb.values()].filter((x) => x.owner === owner.id).reverse().map(quoteView) });
    const qm = /^\/api\/v1\/quotes\/([A-Za-z0-9-]+)(?:\/(accept|decline))?$/.exec(path);
    const qq = qm ? quotesDb.get(qm[1]) : undefined;
    if (!qm || !qq || qq.owner !== owner.id) return send(res, 404, { code: "not_found" });
    if (!qm[2] && req.method === "GET") return send(res, 200, quoteView(qq));
    if (qm[2] === "decline" && req.method === "POST") { if (qq.status !== "Quoted") return send(res, 409, { code: "quote_not_open" }); qq.status = "Withdrawn"; return send(res, 200, { quote: quoteView(qq) }); }
    if (qm[2] === "accept" && req.method === "POST") {
      if (qq.status !== "Quoted") return send(res, 409, { code: "quote_not_open" });
      if (!(qq.slots ?? []).includes(body.start)) return send(res, 422, { code: "slot_not_offered" });
      const b = { id: `00000000-0000-4000-8000-${randomBytes(6).toString("hex")}`, owner: owner.id, key: `qa-${qq.id}`, number: `BK-MOCK-Q${bookingsDb.size}`, listingId: qq.listingId, status: qq.legacy ? "Confirmed" : "Hold", location: qq.location, startAt: body.start, endAt: new Date(Date.parse(body.start) + 3 * 3600000).toISOString(), holdExpiresAt: new Date(Date.now() + 10 * 60000).toISOString(), createdAt: new Date().toISOString(), ...(qq.legacy ? { paymentDueAt: new Date(Date.now() + 30 * 60000).toISOString() } : {}) };
      bookingsDb.set(b.id, b); qq.status = "Accepted"; qq.bookingId = b.id;
      return send(res, 201, { created: true, quote: quoteView(qq), booking: bookingView(b) });
    }
  }
  if (path.startsWith("/api/v1/bookings")) {
    const owner = userFor(req);
    if (!owner) return send(res, 401, { code: "unauthorized" });
    if (path === "/api/v1/bookings/holds" && req.method === "POST") {
      const key = String(req.headers["idempotency-key"] ?? "");
      if (!/^[A-Za-z0-9\-_.:]{8,100}$/.test(key)) return send(res, 422, { code: "validation_failed" });
      const seen = [...bookingsDb.values()].find((b) => b.owner === owner.id && b.key === key);
      if (seen) return send(res, 200, bookingView(seen));
      if (body.location === "customer" && !(body.address?.line1 && body.address?.postalCode)) return send(res, 422, { code: "validation_failed", errors: { address: "required" } });
      if (new Date(body.start).getUTCDate() === new Date(slotAt(3, 14)).getUTCDate() && new Date(body.start).getUTCHours() === 14 && Date.parse(body.start) > Date.parse(slotAt(2, 20))) return send(res, 409, { code: "slot_unavailable" });   // the last offered time is always "taken meanwhile"
      const id = randomBytes(8).toString("hex").replace(/^(.{8})(.{4})(.{4})$/, "$1-$2-$3");
      const b = { id: `00000000-0000-4000-8000-${randomBytes(6).toString("hex")}`, owner: owner.id, key, number: `BK-MOCK-${id.slice(0, 4).toUpperCase()}`, listingId: String(body.listingId), status: "Hold", location: body.location, startAt: body.start, endAt: new Date(Date.parse(body.start) + 4 * 3600000).toISOString(), holdExpiresAt: new Date(Date.now() + 10 * 60000).toISOString(), createdAt: new Date().toISOString() };
      bookingsDb.set(b.id, b);
      return send(res, 201, bookingView(b));
    }
    if (path === "/api/v1/bookings" && req.method === "GET") return send(res, 200, { bookings: [...bookingsDb.values()].filter((b) => b.owner === owner.id && b.status !== "Failed").reverse().map(bookingView) });
    const bm = /^\/api\/v1\/bookings\/([A-Za-z0-9-]+)(?:\/(checkout|cancel|cancel-preview|reschedule|proposal|acknowledge-reschedule|calendar\.ics|extra-charge\/accept|extra-charge\/decline))?$/.exec(path);
    const b = bm ? bookingsDb.get(bm[1]) : undefined;
    if (!bm || !b || b.owner !== owner.id) return send(res, 404, { code: "not_found" });
    if (!bm[2] && req.method === "GET") return send(res, 200, bookingView(b));
    if (bm[2] === "cancel-preview" && req.method === "GET") return send(res, 200, { feeKnown: true, feeCents: 0, refundCents: 24000, totalCents: 24000, withinFreeWindow: true, currency: "USD" });
    if (bm[2] === "checkout" && req.method === "POST") {
      const due = b.paymentDueAt && Date.parse(b.paymentDueAt) > Date.now() && b.status === "Confirmed";
      if (!due && (b.status !== "Hold" || Date.parse(b.holdExpiresAt) <= Date.now())) return send(res, 409, { code: "hold_expired" });
      return send(res, 200, { booking: bookingView(b), payment: { provider: "stripe", clientSecret: `pi_mock_${b.id}_secret_x`, publishableKey: "pk_test_mock" } });
    }
    if (bm[2] === "reschedule" && req.method === "POST") { if (!["Confirmed", "Rescheduled", "Requested"].includes(b.status)) return send(res, 409, { code: "invalid_state" }); if (!String(req.headers["idempotency-key"] ?? "")) return send(res, 422, { code: "validation_failed" }); b.startAt = body.newStart; b.endAt = new Date(Date.parse(body.newStart) + 4 * 3600000).toISOString(); b.status = "Rescheduled"; return send(res, 200, { booking: bookingView(b) }); }
    if (bm[2] === "proposal" && req.method === "POST") { if (!b.proposedStartAt) return send(res, 409, { code: "no_proposal" }); if (body.accept) { b.startAt = b.proposedStartAt; b.endAt = new Date(Date.parse(b.startAt) + 4 * 3600000).toISOString(); b.status = "Confirmed"; } b.proposedStartAt = null; return send(res, 200, { booking: bookingView(b) }); }
    if (bm[2] === "acknowledge-reschedule" && req.method === "POST") { if (!b.requiresBuyerConsent) return send(res, 409, { code: "nothing_to_accept" }); b.requiresBuyerConsent = false; return send(res, 200, { booking: bookingView(b) }); }
    if (bm[2] === "calendar.ics" && req.method === "GET") { if (!["Requested", "Confirmed", "Rescheduled", "InProgress"].includes(b.status)) return send(res, 404, { code: "not_found" }); res.writeHead(200, { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="booking-${b.number}.ics"` }); return res.end(`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Deep House Cleaning\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`); }
    if (bm[2] === "extra-charge/accept" && req.method === "POST") { if (!["requested", "consented"].includes(b.extraChargeState ?? "")) return send(res, 409, { code: "nothing_requested" }); if (body.expectedAmountCents && body.expectedAmountCents !== b.additionalChargeCents) return send(res, 409, { code: "amount_changed" }); b.extraChargeState = "consented"; return send(res, 200, { amountCents: b.additionalChargeCents, payment: { provider: "stripe", clientSecret: `pi_mock_${b.id}_extra_secret_x`, publishableKey: "pk_test_mock" } }); }
    if (bm[2] === "extra-charge/decline" && req.method === "POST") { if (b.extraChargeState !== "requested") return send(res, 409, { code: "nothing_requested" }); b.extraChargeState = "declined"; return send(res, 204); }
    if (bm[2] === "cancel" && req.method === "POST") { if (!["Hold", "Requested", "Confirmed"].includes(b.status)) return send(res, 409, { code: "invalid_state" }); b.status = "CancelledByBuyer"; return send(res, 200, { booking: bookingView(b) }); }
  }

  if (req.method === "GET" && path.startsWith("/api/v1/catalog/")) {
    const c = catalogResponse(path, url);
    if (c) return send(res, c.status, c.body, c.headers);
  }

  send(res, 404, { code: "not_found", message: "Not found" });
}).listen(port, () => console.log(`mock api on :${port}`));
