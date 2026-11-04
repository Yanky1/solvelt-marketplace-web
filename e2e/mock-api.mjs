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
const outbox = []; // {kind, email, token}
const seen = []; // recorded request metadata (no bodies)

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
    if (path === "/__test/revoke") { const t = url.searchParams.get("token"); if (t) sessions.delete(t); return send(res, 204); }
    if (path === "/__test/tokens") {
      const email = url.searchParams.get("email");
      const uid = email ? users.get(email.toLowerCase())?.id : undefined;
      return send(res, 200, [...sessions].filter(([, id]) => !email || id === uid).map(([t]) => t));
    }
    if (path === "/__test/seen") return send(res, 200, seen);
    if (path === "/__test/reset") { addresses.clear(); passkeys.clear(); challenges.clear(); users.clear(); sessions.clear(); outbox.length = 0; seen.length = 0; return send(res, 204); }
    return send(res, 404, { code: "not_found", message: "Not found" });
  }

  seen.push({ method: req.method, path, forwardingOk: forwardingOk(req), hasAuth: !!req.headers.authorization, clientIp: req.headers["x-solvelt-client-ip"] ?? null });
  const body = ["POST", "PUT", "PATCH"].includes(req.method ?? "") ? await readBody(req) : {};

  if (path === "/api/v1/auth/sign-up" && req.method === "POST") {
    const email = String(body.email ?? "").toLowerCase();
    if (String(body.password ?? "").length < 12) return send(res, 422, { code: "validation_failed", message: "Invalid", errors: { password: "Use at least 12 characters." } });
    if (!users.has(email)) {
      const token = randomBytes(12).toString("hex");
      users.set(email, { id: randomBytes(6).toString("hex"), email, displayName: String(body.displayName), password: String(body.password), verified: false, verifyToken: token });
      outbox.push({ kind: "verify", email, token });
    } // an existing address gets the same 204: no enumeration
    return send(res, 204);
  }
  if (path === "/api/v1/auth/verify-email" && req.method === "POST") {
    const u = [...users.values()].find((x) => x.verifyToken === body.token && body.token);
    if (!u) return send(res, 400, { code: "invalid_token", message: "Invalid or expired" });
    u.verified = true; u.verifyToken = undefined;
    return send(res, 204);
  }
  if (path === "/api/v1/auth/sign-in" && req.method === "POST") {
    const u = users.get(String(body.email ?? "").toLowerCase());
    if (!u || u.password !== body.password) return send(res, 401, { code: "invalid_credentials", message: "Invalid" });
    if (!u.verified) return send(res, 403, { code: "email_not_verified", message: "Verify first" });
    const token = `tok_${randomBytes(24).toString("hex")}`;
    sessions.set(token, u.id);
    return send(res, 200, { token, user: { id: u.id, displayName: u.displayName } });
  }
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
    for (const [t, id] of sessions) if (id === u.id) sessions.delete(t); // all devices signed out
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
      challenge, rp: { id: "localhost", name: "Solvelt" }, user: { id: b64u(Buffer.from(u.id)), name: u.email, displayName: u.displayName },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], timeout: 60000, attestation: "none",
      authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
      excludeCredentials: [...passkeys.values()].filter((p) => p.userId === u.id).map((p) => ({ type: "public-key", id: p.credentialId })),
    } });
  }
  if (path === "/api/v1/account/passkeys" && (req.method === "GET" || req.method === "POST")) {
    const u = userFor(req);
    if (!u) return send(res, 401, { code: "unauthorized", message: "Sign in required" });
    if (req.method === "GET") return send(res, 200, [...passkeys.values()].filter((p) => p.userId === u.id).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt, lastUsedAt: p.lastUsedAt })));
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
    passkeys.delete(hit[0]);
    return send(res, 204);
  }
  if (path === "/api/v1/auth/passkey/options" && req.method === "POST") {
    const challenge = b64u(randomBytes(32)), challengeId = randomBytes(8).toString("hex");
    challenges.set(challengeId, { challenge, kind: "get" });
    return send(res, 200, { challengeId, options: { challenge, rpId: "localhost", timeout: 60000, userVerification: "preferred" } });
  }
  if (path === "/api/v1/auth/passkey/sign-in" && req.method === "POST") {
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
