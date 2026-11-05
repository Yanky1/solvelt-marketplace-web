// The staff endpoints of the marketplace API, for E2E (API repo docs/STAFF.md, docs/API.md "Staff"). Like the buyer passkeys in mock-api.mjs it checks the challenge, the
// ceremony type and one-time use but NOT signatures (the real API does). Test hooks live under /__test/staff-*.
import { randomBytes, randomUUID } from "node:crypto";

const MATRIX = {
  "buyers.view": ["support", "finance", "admin"], "buyers.reveal": ["support", "admin"], "buyers.lock": ["support", "admin"], "buyers.sign_out": ["support", "admin"],
  "orders.view": ["support", "finance", "admin"], "payments.view": ["finance", "admin"], "refunds.retry": ["finance", "admin"],
  "ingests.view": ["support", "finance", "admin"], "ingests.retry": ["support", "admin"], "outbox.view": ["support", "finance", "admin"], "outbox.retry": ["admin"],
  "deadletters.view": ["support", "finance", "admin"], "deadletters.retry": ["admin"], "stripe.view": ["finance", "admin"], "staff.manage": ["admin"], "audit.view": ["admin"],
};
const permissionsOf = (role) => Object.entries(MATRIX).filter(([, r]) => r.includes(role)).map(([p]) => p).sort();
const STEP_UP_MS = 5 * 60 * 1000;
const b64u = (b) => Buffer.from(b).toString("base64url");

export function createStaffMock({ send, users, buyerSessions }) {
  const accounts = new Map(); // id -> {id, email, displayName, role, disabled, enrolled, createdAt}
  const creds = new Map(); // credentialId -> staffId
  const enrolments = new Map(); // secret -> {staffId, used}
  const sessions = new Map(); // token -> {staffId, authAt}
  const challenges = new Map(); // challengeId -> {challenge, kind, staffId?}
  const audit = [];
  const locked = new Set(); // buyer ids
  const refunds = new Map(); // refundId -> status
  const deadOutbox = new Set();
  const retried = new Set();

  const reset = () => { accounts.clear(); creds.clear(); enrolments.clear(); sessions.clear(); challenges.clear(); audit.length = 0; locked.clear(); refunds.clear(); deadOutbox.clear(); retried.clear(); };

  const who = (req) => {
    const m = /^Bearer (stf_[A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? "");
    const s = m && sessions.get(m[1]);
    const a = s && accounts.get(s.staffId);
    return a && !a.disabled ? { token: m[1], session: s, account: a } : null;
  };
  const note = (w, action, targetType, targetId, reason) => audit.unshift({ id: randomBytes(8).toString("hex"), at: new Date().toISOString(), actorId: w?.account.id ?? null, actorRole: w?.account.role ?? "system", action, targetType, targetId, reason: reason ?? "", detail: null });
  const reasonOk = (r) => typeof r === "string" && r.trim().length >= 5 && r.length <= 300 && !/\S+@\S+\.\S+/.test(r) && !/\d[\d\s-]{7,}\d/.test(r);
  const fresh = (w) => Date.now() - w.session.authAt <= STEP_UP_MS;
  const newSession = (a) => { const token = `stf_${randomBytes(24).toString("base64url")}`; sessions.set(token, { staffId: a.id, authAt: Date.now() }); return token; };
  const view = (a) => ({ id: a.id, email: a.email, displayName: a.displayName, role: a.role, permissions: permissionsOf(a.role) });
  const options = (kind, a) => {
    const challenge = b64u(randomBytes(32)), challengeId = randomBytes(8).toString("hex");
    challenges.set(challengeId, { challenge, kind, staffId: a?.id });
    return { challengeId, options: kind === "create"
      ? { challenge, rp: { id: "localhost", name: "Solvelt" }, user: { id: b64u(Buffer.from(a.id)), name: a.email, displayName: a.displayName }, pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 60000, attestation: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" } }
      : { challenge, rpId: "localhost", timeout: 60000, userVerification: "required" } };
  };
  const proof = (cred, challengeId, type) => {
    try {
      const ch = challenges.get(String(challengeId));
      challenges.delete(String(challengeId));
      const cd = JSON.parse(Buffer.from(cred.response.clientDataJSON, "base64url").toString("utf8"));
      return ch && cd.type === type && cd.challenge === ch.challenge ? ch : null;
    } catch { return null; }
  };
  const masked = (e) => { const [l, d] = e.split("@"); const i = d.lastIndexOf("."); return `${l[0]}***@${d[0]}***${d.slice(i)}`; };
  const buyerView = (u) => ({ id: u.id, email: masked(u.email), name: u.displayName.split(" ")[0] + (u.displayName.includes(" ") ? ` ${u.displayName.split(" ").at(-1)[0]}.` : ""), relayEmail: masked(`relay-${u.id.slice(0, 8)}@relay.test`), emailVerified: !!u.verified, locked: locked.has(u.id), lockedAt: null, deleted: false, redacted: false, createdAt: new Date().toISOString(), passkeys: 0, activeSessions: 1, addresses: 0, orders: 1, hasPassword: true, demo: u.email.includes("demo") });
  const ORDER = (payments, w) => ({
    id: "11111111-1111-1111-1111-111111111111", number: "MP-1001", status: "paid", createdAt: "2026-11-05T10:00:00Z", paidAt: "2026-11-05T10:01:00Z", placedAt: null, failureCode: null, currency: "USD", demo: false,
    itemsCents: 9000, shippingCents: 700, taxCents: 300, totalCents: 10000, paidCents: 10000, refundedCents: 2500,
    buyer: { accountId: null, name: "Jane B.", guestEmail: "g***@e***.com", relayEmail: "r***@r***.test", shipCountry: "US" }, lines: 2,
    groups: [{ id: "g1", sellerOrderNumber: "SO-77", totalCents: 10000, refundedCents: 2500 }],
    refunds: [{ id: "22222222-2222-2222-2222-222222222222", amountCents: 2500, status: refunds.get("22222222-2222-2222-2222-222222222222") ?? "reserved", reason: "seller_cancel", attempt: 0, createdAt: "2026-11-05T11:00:00Z", updatedAt: "2026-11-05T11:00:00Z", retryable: !retried.has(`${w?.account.id}:refund`) }],
    payment: payments ? { paymentIntentId: "pi_fake_000001", disputes: [], refunds: [{ id: "22222222-2222-2222-2222-222222222222", stripeRefundId: null, portalRefundId: "r-1", key: "portal:r-1" }] } : null,
  });

  /** Returns true when the request was one of ours. */
  async function handle(req, res, path, body, url) {
    // ---- test hooks
    if (path === "/__test/staff-seed") {   // ?role=&tag= : a staff member with a one-time enrolment secret
      const role = url.searchParams.get("role") ?? "support", tag = url.searchParams.get("tag") ?? randomBytes(3).toString("hex");
      const a = { id: randomUUID(), email: `${tag}@staff.example`, displayName: `Staff ${tag}`, role, disabled: false, enrolled: false, createdAt: new Date().toISOString(), leak: url.searchParams.get("leak") === "1" };   // leak: this mock answers the Stripe block to ANY role (the page must not rely on the API for that)
      accounts.set(a.id, a);
      const secret = `ste_${randomBytes(16).toString("hex")}`;
      enrolments.set(secret, { staffId: a.id, used: false });
      send(res, 200, { id: a.id, email: a.email, secret });
      return true;
    }
    if (path === "/__test/staff-stale") {   // ?staffId= : the passkey check of that member's sessions is old
      for (const s of sessions.values()) if (s.staffId === url.searchParams.get("staffId")) s.authAt = Date.now() - 2 * STEP_UP_MS;
      send(res, 204);
      return true;
    }
    if (path === "/__test/staff-revoke") {   // ?staffId= : the API ends every session of that member (a dead token)
      for (const [t, s] of [...sessions.entries()]) if (s.staffId === url.searchParams.get("staffId")) sessions.delete(t);
      send(res, 204);
      return true;
    }
    if (path === "/__test/staff-state") { send(res, 200, { audit: audit.filter((a) => a.actorId === url.searchParams.get("staffId")), locked: [...locked], retried: [...retried] }); return true; }
    if (path === "/__test/staff-reset") { reset(); send(res, 204); return true; }
    if (!path.startsWith("/api/v1/staff/")) return false;
    const p = path.slice("/api/v1/staff".length);
    const method = req.method;

    // ---- anonymous
    if (p === "/auth/enrol/options" && method === "POST") {
      const e = enrolments.get(String(body.token));
      if (!e || e.used) return send(res, 400, { code: "invalid_token", message: "This enrolment link is invalid, used or has expired." }), true;
      send(res, 200, options("create", accounts.get(e.staffId)));
      return true;
    }
    if (p === "/auth/enrol" && method === "POST") {
      const e = enrolments.get(String(body.token));
      const ch = e && !e.used && proof(body.credential ?? {}, body.challengeId, "webauthn.create");
      if (!ch || ch.staffId !== e.staffId) return send(res, 400, { code: "invalid_challenge", message: "Start again." }), true;
      e.used = true;
      const a = accounts.get(e.staffId);
      a.enrolled = true; creds.set(body.credential.id, a.id);
      note({ account: a }, "staff.enrol", "staff", a.id, "passkey registered from an enrolment link");
      send(res, 201, { token: newSession(a), staff: view(a) });
      return true;
    }
    if (p === "/auth/passkey/options" && method === "POST") { send(res, 200, options("get")); return true; }
    if (p === "/auth/passkey/sign-in" && method === "POST") {
      const ch = proof(body.credential ?? {}, body.challengeId, "webauthn.get");
      const a = ch && accounts.get(creds.get(body.credential.id));
      if (!a || a.disabled) return send(res, 401, { code: "invalid_credentials", message: "The passkey was not accepted." }), true;
      note({ account: a }, "staff.sign_in", "staff", a.id, "passkey sign-in");
      send(res, 200, { token: newSession(a), staff: view(a) });
      return true;
    }

    // ---- everything else needs a staff session (a buyer's token is not one)
    const w = who(req);
    if (!w) return send(res, 401, { code: "unauthorized", message: "Sign in to continue." }), true;
    const can = (perm) => MATRIX[perm]?.includes(w.account.role);
    const forbid = () => send(res, 403, { code: "forbidden", message: "Your role cannot do this." });
    const needReason = () => send(res, 422, { code: "validation_failed", message: "Some fields need attention.", errors: { reason: "Say why, in at least 5 characters (no email address, phone or card number)." } });
    const needStepUp = () => send(res, 403, { code: "reauthentication_required", message: "Confirm with your passkey again first." });

    if (p === "/me" && method === "GET") { send(res, 200, { ...view(w.account), stepUpUntil: fresh(w) ? new Date(w.session.authAt + STEP_UP_MS).toISOString() : null }); return true; }
    if (p === "/auth/sign-out" && method === "POST") { sessions.delete(w.token); send(res, 204); return true; }
    if (p === "/auth/reauthenticate/options" && method === "POST") { send(res, 200, options("get", w.account)); return true; }
    if (p === "/auth/reauthenticate" && method === "POST") {
      const ch = proof(body.credential ?? {}, body.challengeId, "webauthn.get");
      if (!ch || ch.staffId !== w.account.id || creds.get(body.credential.id) !== w.account.id) return send(res, 400, { code: "invalid_credential", message: "The passkey could not be verified." }), true;
      w.session.authAt = Date.now();
      note(w, "staff.step_up", "staff", w.account.id, "passkey re-check");
      send(res, 204);
      return true;
    }

    // ---- buyers
    if (p === "/buyers/lookup" && method === "POST") {
      if (!can("buyers.view")) return forbid(), true;
      const reason = body.reason;
      if (!reasonOk(reason)) return needReason(), true;
      const email = body.email, u = email ? users.get(String(email).trim().toLowerCase()) : body.id ? [...users.values()].find((x) => x.id === body.id) : null;
      note(w, u ? "buyer.lookup" : "buyer.lookup_miss", u ? "buyer" : null, u?.id ?? null, reason);
      if (!u) return send(res, 404, { code: "not_found", message: "Not found." }), true;
      send(res, 200, buyerView(u));
      return true;
    }
    let m;
    if ((m = /^\/buyers\/([^/]+)\/(reveal|lock|unlock|sign-out|orders)$/.exec(p))) {
      const u = [...users.values()].find((x) => x.id === m[1]);
      const need = { reveal: "buyers.reveal", lock: "buyers.lock", unlock: "buyers.lock", "sign-out": "buyers.sign_out", orders: "orders.view" }[m[2]];
      if (!can(need)) return forbid(), true;
      const reason = body.reason;
      if (!reasonOk(reason)) return needReason(), true;
      if (m[2] !== "orders" && !fresh(w)) return needStepUp(), true;
      if (!u) return send(res, 404, { code: "not_found", message: "Not found." }), true;
      if (m[2] === "reveal") { note(w, "buyer.reveal", "buyer", u.id, reason); send(res, 200, { email: body.fields?.includes("email") ? u.email : null, name: body.fields?.includes("name") ? u.displayName : null, phone: null, addresses: null, redacted: false }); return true; }
      if (m[2] === "orders") { note(w, "buyer.orders", "buyer", u.id, reason); send(res, 200, [{ id: "o1", number: "MP-1001", status: "paid", createdAt: "2026-11-05T10:00:00Z", totalCents: 10000, refundedCents: 2500, demo: false }]); return true; }
      if (m[2] === "lock") { locked.add(u.id); for (const [t, id] of [...buyerSessions.entries()]) if (id === u.id) buyerSessions.delete(t); }
      if (m[2] === "unlock") locked.delete(u.id);
      if (m[2] === "sign-out") for (const [t, id] of [...buyerSessions.entries()]) if (id === u.id) buyerSessions.delete(t);
      note(w, `buyer.${m[2] === "sign-out" ? "sign_out_all" : m[2]}`, "buyer", u.id, reason);
      send(res, 204);
      return true;
    }

    // ---- orders and queues
    if (p === "/orders/lookup" && method === "POST") {
      if (!can("orders.view")) return forbid(), true;
      const reason = body.reason;
      if (!reasonOk(reason)) return needReason(), true;
      if (body.number !== "MP-1001") return send(res, 404, { code: "not_found", message: "Not found." }), true;
      note(w, "order.lookup", "order", ORDER(false, w).id, reason);
      send(res, 200, ORDER(can("payments.view") || w.account.leak === true, w));
      return true;
    }
    if ((m = /^\/orders\/([^/]+)\/refunds\/([^/]+)\/retry$/.exec(p)) && method === "POST") {
      if (!can("refunds.retry")) return forbid(), true;
      if (!reasonOk(body.reason)) return needReason(), true;
      if (!fresh(w)) return needStepUp(), true;
      if (retried.has(`${w.account.id}:refund`)) return send(res, 409, { code: "already_queued", message: "It is already queued." }), true;
      retried.add(`${w.account.id}:refund`); note(w, "refund.retry", "order", m[1], body.reason);
      send(res, 204);
      return true;
    }
    if (p === "/ingests" && method === "GET") { if (!can("ingests.view")) return forbid(), true; send(res, 200, { stuckAfterMinutes: 15, orders: [{ id: "33333333-3333-3333-3333-333333333333", number: "MP-2002", paidAt: "2026-11-05T09:00:00Z", totalCents: 4200, demo: false, message: { status: "dead", attempts: 8, lastError: "invalid_shipping_speed", nextAttemptAt: "2026-11-05T09:05:00Z" }, retryable: !retried.has(`${w.account.id}:ingest`) }] }); return true; }
    if ((m = /^\/ingests\/([^/]+)\/retry$/.exec(p)) && method === "POST") {
      if (!can("ingests.retry")) return forbid(), true;
      if (!reasonOk(body.reason)) return needReason(), true;
      if (!fresh(w)) return needStepUp(), true;
      retried.add(`${w.account.id}:ingest`); note(w, "ingest.retry", "order", m[1], body.reason);
      send(res, 204);
      return true;
    }
    if (p.startsWith("/outbox") && method === "GET") {
      if (!can("outbox.view")) return forbid(), true;
      send(res, 200, { counts: { pending: 1, delivered: 40, dead: 1 }, messages: [{ id: "44444444-4444-4444-4444-444444444444", type: "email.send", status: "dead", attempts: 8, nextAttemptAt: "2026-11-05T09:00:00Z", lastError: "SmtpException", createdAt: "2026-11-05T08:00:00Z", deliveredAt: null, deadAt: "2026-11-05T09:00:00Z", retryable: !deadOutbox.has(`${w.account.id}:44444444-4444-4444-4444-444444444444`) }], next: null });
      return true;
    }
    if ((m = /^\/outbox\/([^/]+)\/retry$/.exec(p)) && method === "POST") {
      if (!can("outbox.retry")) return forbid(), true;
      if (!reasonOk(body.reason)) return needReason(), true;
      if (!fresh(w)) return needStepUp(), true;
      deadOutbox.add(`${w.account.id}:${m[1]}`); note(w, "outbox.retry", "outbox", m[1], body.reason);
      send(res, 204);
      return true;
    }
    if (p === "/dead-letters" && method === "GET") { if (!can("deadletters.view")) return forbid(), true; send(res, 200, { bookingConfirms: [{ messageId: "55555555-5555-5555-5555-555555555555", lastError: "confirm_unexpected_403", attempts: 8, deadAt: "2026-11-05T09:00:00Z", bookingId: "66666666-6666-6666-6666-666666666666", bookingNumber: "BK-7001", bookingStatus: "Hold", demo: false, paymentId: "77777777-7777-7777-7777-777777777777", paymentStatus: "captured", currency: "USD", amountCents: 12500, capturedCents: 12500, refundedCents: 0, needsPerson: true, retryable: !deadOutbox.has(`${w.account.id}:55555555-5555-5555-5555-555555555555`), steps: ["Ask the portal what it knows about this booking.", "If the portal has it, or the cause is fixed: retry the message below.", "If not: refund the PaymentIntent in the Stripe dashboard and tell the buyer."] }], counts: { applied: 100, parked: 1 }, parked: [{ id: "evt-parked-1", type: "order.shipped", aggregateType: "order", aggregateKey: "MP-9", receivedAt: "2026-11-05T05:00:00Z", ageHours: 5, lastReplayAt: null, note: null, retryable: true }] }); return true; }
    if (p === "/dead-letters/retry" && method === "POST") {
      if (!can("deadletters.retry")) return forbid(), true;
      if (!reasonOk(body.reason)) return needReason(), true;
      if (!fresh(w)) return needStepUp(), true;
      note(w, "deadletter.retry", "inbound_event", String(body.eventId), body.reason);
      send(res, 200, { replayed: 0 });
      return true;
    }
    if (p.startsWith("/stripe/failures") && method === "GET") { if (!can("stripe.view")) return forbid(), true; send(res, 200, { total: 1, events: [{ id: "evt_a", type: "charge.refunded", outcome: "unmatched", objectId: "ch_1", receivedAt: "2026-11-05T08:00:00Z" }], next: null }); return true; }

    // ---- staff accounts and audit (admin)
    if (p === "/accounts" && method === "GET") { if (!can("staff.manage")) return forbid(), true; send(res, 200, [...accounts.values()].map((a) => ({ ...view(a), enrolled: a.enrolled, disabled: a.disabled, passkeys: [...creds.values()].filter((x) => x === a.id).length, createdAt: a.createdAt, lastSignInAt: null }))); return true; }
    if (p === "/accounts" && method === "POST") {
      if (!can("staff.manage")) return forbid(), true;
      if (!reasonOk(body.reason)) return needReason(), true;
      if (!fresh(w)) return needStepUp(), true;
      if ([...accounts.values()].some((a) => a.email === String(body.email).toLowerCase())) return send(res, 409, { code: "email_in_use", message: "A staff account with that address exists." }), true;
      const a = { id: randomUUID(), email: String(body.email).toLowerCase(), displayName: body.displayName, role: body.role, disabled: false, enrolled: false, createdAt: new Date().toISOString() };
      accounts.set(a.id, a);
      const secret = `ste_${randomBytes(16).toString("hex")}`;
      enrolments.set(secret, { staffId: a.id, used: false });
      note(w, "staff.create", "staff", a.id, body.reason);
      send(res, 201, { account: { ...view(a), enrolled: false, disabled: false, passkeys: 0, createdAt: a.createdAt, lastSignInAt: null }, enrolmentToken: secret, expiresAt: new Date(Date.now() + 86400000).toISOString() });
      return true;
    }
    if ((m = /^\/accounts\/([^/]+)\/(role|disable|enable|sign-out|enrolment)$/.exec(p)) && method === "POST") {
      if (!can("staff.manage")) return forbid(), true;
      if (!reasonOk(body.reason)) return needReason(), true;
      if (!fresh(w)) return needStepUp(), true;
      const a = accounts.get(m[1]);
      if (!a) return send(res, 404, { code: "not_found", message: "Not found." }), true;
      if ((m[2] === "disable" || (m[2] === "role" && body.role !== "admin")) && a.role === "admin" && [...accounts.values()].filter((x) => x.role === "admin" && !x.disabled && x.enrolled).length <= 1) return send(res, 409, { code: "last_admin", message: "There must always be one active admin." }), true;
      if (m[2] === "role") a.role = body.role;
      if (m[2] === "disable") a.disabled = true;
      if (m[2] === "enable") a.disabled = false;
      if (m[2] === "enrolment") { const secret = `ste_${randomBytes(16).toString("hex")}`; enrolments.set(secret, { staffId: a.id, used: false }); note(w, "staff.enrolment", "staff", a.id, body.reason); send(res, 200, { enrolmentToken: secret, expiresAt: new Date(Date.now() + 86400000).toISOString() }); return true; }
      for (const [t, s] of [...sessions.entries()]) if (s.staffId === a.id && m[2] !== "enable") sessions.delete(t);
      note(w, `staff.${m[2] === "sign-out" ? "sign_out_all" : m[2]}`, "staff", a.id, body.reason);
      send(res, 204);
      return true;
    }
    if (p.startsWith("/audit") && method === "GET") {
      if (!can("audit.view")) return forbid(), true;
      const action = url.searchParams.get("action");
      send(res, 200, { entries: audit.filter((a) => !action || a.action === action).slice(0, 50), next: null });
      return true;
    }
    return send(res, 404, { code: "not_found", message: "Not found." }), true;
  }
  return { handle, reset };
}
