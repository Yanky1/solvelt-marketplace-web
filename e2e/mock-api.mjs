// Stateful mock of the marketplace API for E2E. The auth shapes are the ASSUMED contract (docs/DESIGN.md W1-21).
// Test-only hooks live under /__test and are not part of the contract.
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";

const port = Number(process.env.MOCK_API_PORT ?? 5080);
const forwardingKey = process.env.WEB_FORWARDING_KEY ?? "";

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
const CATEGORIES = ["order_updates", "shipped", "out_for_delivery", "delivered", "refunds", "messages", "bookings"];
const orders = new Map(); // number -> {userId, createdAt, status, group}
const outbox = []; // {kind, email, token}
const seen = []; // recorded request metadata (no bodies)

// Test variants are selected by the end-user IP the web server forwards (X-Solvelt-Client-Ip), so parallel tests never interfere.
const ipOf = (req) => String(req.headers["x-solvelt-client-ip"] ?? "");
const IP = { ANON_RPID_EVIL: "198.51.100.61", ANON_BOTH_DIFFER: "198.51.100.62", ANON_BOTH_DIFFER_REV: "198.51.100.63", ANON_RP_ONLY_EVIL: "198.51.100.64", ANON_BOTH_SAME: "198.51.100.65", REG_BOTH_DIFFER: "198.51.100.66", REG_BOTH_SAME: "198.51.100.67", REG_LENIENT: "198.51.100.68", REG_5XX: "198.51.100.69", SIGNIN_LENIENT: "198.51.100.70" };

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
    if (path === "/__test/outbox") return send(res, 200, outbox);
    if (path === "/__test/fail-signout-once") { const t = url.searchParams.get("token"); if (t) failSignOutOnce.add(t); return send(res, 204); }
    if (path === "/__test/fail-signout") { const t = url.searchParams.get("token"); if (t) failSignOut.add(t); return send(res, 204); }
    if (path === "/__test/revoke") { const t = url.searchParams.get("token"); if (t) sessions.delete(t); return send(res, 204); }
    if (path === "/__test/auth-at") { const t = url.searchParams.get("token") ?? ""; return send(res, 200, { authAt: authAt.get(t) ?? null }); }
    if (path === "/__test/tokens") {
      const email = url.searchParams.get("email");
      const uid = email ? users.get(email.toLowerCase())?.id : undefined;
      return send(res, 200, [...sessions].filter(([, id]) => !email || id === uid).map(([t]) => t));
    }
    if (path === "/__test/seen") return send(res, 200, seen);
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
        cancelRequest: null, returns: [], refunds: [],
        lines: [{ lineId: `${number}-1`, title: "Classic challah", variantName: "Large", quantity: 2, unitPriceCents: 650, lineTotalCents: 1300, taxCents: 100, shippedQty: shipped ? 2 : 0, cancelledQty: 0, returnedQty: 0, refundedQty: 0, returnableQty: shipped ? 2 : 0 }],
        shipments: shipped ? [{ id: `sh-${number}`, method: "carrier", carrier: "USPS", service: "Priority", trackingNumber: "9400111", trackingUrl: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111", shippedAt: new Date().toISOString(),
          deliveredAt: status === "delivered" ? new Date().toISOString() : null, voided: false, trackingStatus: status === "delivered" ? "delivered" : "in_transit", trackingStatusDetail: status === "delivered" ? "Delivered" : "Departed facility",
          eta: null, etaWindowStart: null, etaWindowEnd: null, driverFirstName: null, placement: status === "delivered" ? "front_door" : null,
          timeline: [{ status: "in_transit", detail: "Departed facility", location: "Brooklyn, NY", at: new Date().toISOString() }], position: null, proofCount: status === "delivered" ? 1 : 0, lines: [{ lineId: `${number}-1`, quantity: 2 }] }] : [],
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
    if (path === "/__test/reports") return send(res, 200, reports);
    if (path === "/__test/prefs") { const u = users.get((url.searchParams.get("email") ?? "").toLowerCase()); return send(res, 200, u ? prefs.get(u.id) ?? null : null); }
    if (path === "/__test/reset") { threads.clear(); reports.length = 0; notifs.clear(); prefs.clear(); orders.clear(); addresses.clear(); passkeys.clear(); challenges.clear(); users.clear(); sessions.clear(); outbox.length = 0; seen.length = 0; return send(res, 204); }
    return send(res, 404, { code: "not_found", message: "Not found" });
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
        t = { userId: u.id, kind: body.listingId ? "product" : "order", subject: body.listingId ? "Classic challah" : `Order ${body.orderNumber}`, sellerName: "Challah Corner", orderNumber: body.orderNumber ?? null, listingId: body.listingId ?? null, messages: [] };
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
      return send(res, 200, { unreadCount: list.reduce((n, [, t]) => n + unread(t), 0), threads: list.map(([id, t]) => ({ id, kind: t.kind, subject: t.subject, sellerName: t.sellerName, orderNumber: t.orderNumber, listingId: t.listingId, lastMessageAt: lastOf(t).sentAt, unreadCount: unread(t), preview: lastOf(t).text })), next: null });
    }
    const t = threads.get(mm[1]);
    if (!t || t.userId !== u.id) return send(res, 404, { code: "not_found", message: "Not found" });
    if (mm[2]) { t.messages.forEach((m) => { if (m.direction === "seller") m.read = true; }); return send(res, 204); }
    return send(res, 200, { thread: { id: mm[1], kind: t.kind, subject: t.subject, sellerName: t.sellerName, listingId: t.listingId }, messages: t.messages, older: null });
  }

  // ---- notifications (the unsubscribe token is "U.<email>.<category|all>": the mock does not sign) ----
  if (path === "/api/v1/notifications/unsubscribe" && req.method === "POST") {
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
      if (req.method === "PUT") { for (const [k, v] of Object.entries(body.email ?? {})) if (CATEGORIES.includes(k)) p[k] = v === true; prefs.set(u.id, p); }
      return send(res, 200, { email: p });
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

  send(res, 404, { code: "not_found", message: "Not found" });
}).listen(port, () => console.log(`mock api on :${port}`));
