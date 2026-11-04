// Stateful mock of the marketplace API for E2E. The auth shapes are the ASSUMED contract (docs/DESIGN.md W1-21).
// Test-only hooks live under /__test and are not part of the contract.
import { createHmac, randomBytes } from "node:crypto";
import http from "node:http";

const port = Number(process.env.MOCK_API_PORT ?? 5080);
const forwardingKey = process.env.WEB_FORWARDING_KEY ?? "";

const users = new Map(); // email -> {id, email, displayName, password, verified}
const sessions = new Map(); // token -> userId
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
    if (path === "/__test/reset") { users.clear(); sessions.clear(); outbox.length = 0; seen.length = 0; return send(res, 204); }
    return send(res, 404, { code: "not_found", message: "Not found" });
  }

  seen.push({ method: req.method, path, forwardingOk: forwardingOk(req), hasAuth: !!req.headers.authorization, clientIp: req.headers["x-solvelt-client-ip"] ?? null });
  const body = req.method === "POST" ? await readBody(req) : {};

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
  send(res, 404, { code: "not_found", message: "Not found" });
}).listen(port, () => console.log(`mock api on :${port}`));
