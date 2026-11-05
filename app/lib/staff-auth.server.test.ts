import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.PUBLIC_ORIGIN = "http://localhost:3000";
  process.env.API_BASE_URL = "http://localhost:5080";
  process.env.SESSION_COOKIE_SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
  process.env.WEB_FORWARDING_KEY = "Tn4Wb8Ke2Vr6Pj0Hs3Dy7Lc9Mf1Ga5QxZu8o";
});

import { csrfTokenFor, newVisitor, sessionCookie } from "./session.server";
import { assertStaffCsrf, can, requirePermission } from "./staff-auth.server";
import type { StaffMe } from "./staff-api.server";
import { isStaffPath, STAFF_PATH } from "./staff-path";
import { tokenFromHash } from "./staff-enrol";
import { newStaffVisitor, staffCookie, staffCsrfTokenFor } from "./staff-session.server";

const O = "http://localhost:3000";
const cfg = { publicOrigin: O, sessionCookieSecret: SECRET };

/** A staff browser: its cookie, and the CSRF token its pages carry. */
function staffBrowser() {
  const s = { ...newStaffVisitor(), token: "stf_abcdefghijklmnopqrstuvwx" };
  return { s, cookie: staffCookie(s, cfg).split(";")[0]!, csrf: staffCsrfTokenFor(s.sid, SECRET) };
}
const post = (cookie: string | null, fields: Record<string, string>, headers: Record<string, string> = { origin: O }) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return { request: new Request(`${O}/staff/anything`, { method: "POST", headers: { ...headers, ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(fields as Record<string, string>) }), form };
};
const refused = (fn: () => unknown) => { try { fn(); } catch (e) { return e as Response; } throw new Error("did not refuse"); };

describe("assertStaffCsrf (security review MED-1: the wiring itself is tested)", () => {
  it("accepts this session's staff token from this origin", () => {
    const b = staffBrowser();
    const { request, form } = post(b.cookie, { csrf: b.csrf });
    expect(assertStaffCsrf(request, form).sid).toBe(b.s.sid);
  });

  it.each(["missing", "buyer", "other", "empty", "garbage"])("refuses a %s token with a 403", (kind) => {
    const b = staffBrowser();
    const other = staffBrowser();
    const buyer = newVisitor();
    const tokens: Record<string, Record<string, string>> = {
      missing: {},
      buyer: { csrf: csrfTokenFor(b.s.sid, SECRET) },            // a BUYER's token for the same session id
      other: { csrf: other.csrf },                                // another staff session's token
      empty: { csrf: "" },
      garbage: { csrf: "x".repeat(300) },
    };
    void buyer;
    const { request, form } = post(b.cookie, tokens[kind]!);
    expect(refused(() => assertStaffCsrf(request, form)).status).toBe(403);
  });

  it("refuses a foreign or missing Origin even with the right token", () => {
    const b = staffBrowser();
    for (const headers of [{ origin: "https://evil.example" }, {} as Record<string, string>, { origin: "null" }]) {
      const { request, form } = post(b.cookie, { csrf: b.csrf }, headers);
      expect(refused(() => assertStaffCsrf(request, form)).status).toBe(403);
    }
  });

  it("refuses a request with no staff cookie, and one that carries only a buyer cookie", () => {
    const b = staffBrowser();
    const buyerCookie = sessionCookie({ ...newVisitor(), token: "tok_buyer_token_value" }, cfg).split(";")[0]!;
    for (const cookie of [null, buyerCookie]) {
      const { request, form } = post(cookie, { csrf: b.csrf });
      expect(refused(() => assertStaffCsrf(request, form)).status).toBe(403);
    }
  });
});

describe("every staff action refuses a forged request before it calls the API", () => {
  afterEach(() => vi.restoreAllMocks());

  const routes: [string, () => Promise<{ action: (a: never) => Promise<unknown> }>, Record<string, string>][] = [
    ["buyers", () => import("../routes/staff.buyers"), {}],
    ["orders", () => import("../routes/staff.orders"), {}],
    ["queues", () => import("../routes/staff.queues"), {}],
    ["accounts", () => import("../routes/staff.accounts"), {}],
    ["sign-out", () => import("../routes/staff.sign-out"), {}],
    ["sign-in", () => import("../routes/staff.sign-in"), {}],
    ["enrol", () => import("../routes/staff.enrol"), {}],
    ["confirm", () => import("../routes/staff.confirm"), {}],
    ["passkey", () => import("../routes/staff.passkey"), { step: "sign-in" }],
  ];

  it.each(routes)("%s", async (_name, load, params) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("the API must not be called"); });
    const { action } = await load();
    const b = staffBrowser();
    const other = staffBrowser();
    const attempts: [string | null, Record<string, string>, Record<string, string>][] = [
      [b.cookie, {}, { origin: O }],                                                 // no token
      [b.cookie, { csrf: csrfTokenFor(b.s.sid, SECRET) }, { origin: O }],            // a buyer's token
      [b.cookie, { csrf: other.csrf }, { origin: O }],                                // another session's token
      [b.cookie, { csrf: b.csrf }, { origin: "https://evil.example" }],              // a foreign origin
      [null, { csrf: b.csrf }, { origin: O }],                                        // no cookie
    ];
    for (const [cookie, fields, headers] of attempts) {
      const request = new Request(`${O}/staff/x`, { method: "POST", headers: { ...headers, ...(cookie ? { cookie } : {}), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ intent: "find", ...fields }) });
      let thrown: unknown;
      try { await action({ request, context: { socketAddress: "127.0.0.1" }, params } as never); } catch (e) { thrown = e; }
      expect(thrown, `${_name}: a forged request must be refused`).toBeInstanceOf(Response);
      expect((thrown as Response).status).toBe(403);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("requirePermission (security review LOW-4)", () => {
  const me = (permissions: string[]): StaffMe => ({ id: "1", email: "a@b.c", displayName: "A", role: "support", permissions, stepUpUntil: null });

  it("passes with the permission and answers 403 without it", () => {
    expect(() => requirePermission(me(["orders.view"]), "orders.view")).not.toThrow();
    const r = refused(() => requirePermission(me(["orders.view"]), "audit.view"));
    expect(r.status).toBe(403);
    expect(r.headers.get("Cache-Control")).toBe("private, no-store");
    expect(refused(() => requirePermission(me([]), "orders.view")).status).toBe(403);
  });
  it("can() is exact, never a prefix or substring match", () => {
    expect(can(me(["orders.view"]), "orders.view")).toBe(true);
    expect(can(me(["orders.view"]), "orders")).toBe(false);
    expect(can(me(["orders.view_all"]), "orders.view")).toBe(false);
  });
});

describe("the staff path (security review LOW-5)", () => {
  it.each(["/staff", "/staff/", "/staff/buyers", "/staff/buyers.data", "/staff.data", "/staff/passkey/sign-in"])("%s is staff", (p) => expect(isStaffPath(p)).toBe(true));
  it.each(["/", "/staffer", "/staff-picks", "/staff-picks/x", "/account/staff", "/stafff", "/Staff"])("%s is not", (p) => expect(isStaffPath(p)).toBe(false));
  it("server.js uses exactly the same expression", () => {
    const m = /const STAFF_PATH = (\/.*\/);/.exec(readFileSync("server.js", "utf8"));
    expect(m, "STAFF_PATH in server.js").toBeTruthy();
    expect(m![1]).toBe(String(STAFF_PATH));
  });
});

describe("the enrolment fragment (security review LOW-7)", () => {
  it("reads a plain and an escaped secret", () => {
    expect(tokenFromHash("#ste_abc123")).toBe("ste_abc123");
    expect(tokenFromHash("#ste%5Fabc")).toBe("ste_abc");
  });
  it("never throws on a malformed escape", () => {
    expect(() => tokenFromHash("#ste_abc%E0%A4%A")).not.toThrow();
    expect(tokenFromHash("#ste_abc%E0%A4%A")).toBe("ste_abc%E0%A4%A");
  });
  it("is empty for nothing or for something absurd", () => {
    expect(tokenFromHash("")).toBe("");
    expect(tokenFromHash("#")).toBe("");
    expect(tokenFromHash("#" + "a".repeat(500))).toBe("");
  });
});
