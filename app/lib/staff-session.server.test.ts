import { describe, expect, it } from "vitest";
import { csrfTokenFor, csrfValid, newVisitor, open, seal } from "./session.server";
import { clearStaffCookie, newStaffVisitor, openStaff, readStaffSession, safeStaffNext, sealStaff, staffCookie, staffCookieName, staffCsrfTokenFor, staffCsrfValid, STAFF_MAX_AGE_SECONDS } from "./staff-session.server";

const SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
const cfg = { publicOrigin: "https://shop.example.com", sessionCookieSecret: SECRET };

describe("the staff cookie is its own thing (M7W-01)", () => {
  it("round-trips and keeps the token out of the clear", () => {
    const d = { ...newStaffVisitor(), token: "stf_secretsecretsecret" };
    const sealed = sealStaff(d, SECRET);
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("stf_secretsecretsecret");
    expect(openStaff(sealed, SECRET)).toEqual(d);
  });

  it("a buyer cookie never opens as a staff session, and a staff cookie never as a buyer one", () => {
    const buyer = seal({ ...newVisitor(), token: "stf_looks_like_staff_but_is_buyer_cookie" }, SECRET);
    const staff = sealStaff({ ...newStaffVisitor(), token: "stf_abcdefghijklmnop" }, SECRET);
    expect(openStaff(buyer, SECRET)).toBeNull();
    expect(open(staff, SECRET)).toBeNull();
  });

  it("refuses a token that is not a staff token, a tampered cookie, a wrong secret and an old one", () => {
    expect(openStaff(sealStaff({ ...newStaffVisitor(), token: "buyer_token_value" }, SECRET), SECRET)).toBeNull();
    const sealed = sealStaff(newStaffVisitor(), SECRET);
    const raw = Buffer.from(sealed, "base64url"); raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(openStaff(raw.toString("base64url"), SECRET)).toBeNull();
    expect(openStaff(sealed, "Tn4Wb8Ke2Vr6Pj0Hs3Dy7Lc9Mf1Ga5QxZu8o")).toBeNull();
    expect(openStaff(sealStaff({ sid: "x".repeat(32), iat: 1000 }, SECRET), SECRET, 1000 + STAFF_MAX_AGE_SECONDS + 1)).toBeNull();
    expect(openStaff("garbage", SECRET)).toBeNull();
  });

  it("a buyer's CSRF token is worthless on a staff form and the reverse", () => {
    const sid = "s".repeat(32);
    expect(staffCsrfValid(sid, staffCsrfTokenFor(sid, SECRET), SECRET)).toBe(true);
    expect(staffCsrfValid(sid, csrfTokenFor(sid, SECRET), SECRET)).toBe(false);
    expect(csrfValid(sid, staffCsrfTokenFor(sid, SECRET), SECRET)).toBe(false);
    expect(staffCsrfValid(sid, staffCsrfTokenFor("t".repeat(32), SECRET), SECRET)).toBe(false);
    expect(staffCsrfValid(sid, undefined, SECRET)).toBe(false);
    expect(staffCsrfValid(sid, "x".repeat(500), SECRET)).toBe(false);
  });
});

describe("the staff cookie header", () => {
  it("is HttpOnly, SameSite=Strict, Secure and __Host- on https, 8 hours at most", () => {
    const c = staffCookie({ ...newStaffVisitor(), token: "stf_abcdefghijklmnop" }, cfg);
    expect(c).toMatch(/^__Host-solvelt_staff=/);
    for (const part of ["HttpOnly", "SameSite=Strict", "Secure", "Path=/", `Max-Age=${STAFF_MAX_AGE_SECONDS}`]) expect(c).toContain(part);
    expect(c).not.toContain("Domain");
    expect(STAFF_MAX_AGE_SECONDS).toBe(8 * 3600);
  });
  it("is a different cookie from the buyer's, on http too", () => {
    expect(staffCookieName({ publicOrigin: "http://localhost:3000" })).toBe("solvelt_staff");
    expect(staffCookieName(cfg)).not.toBe("__Host-solvelt_session");
  });
  it("is read only from its own name, never from the buyer cookie", () => {
    const buyerOnly = new Request("https://shop.example.com/staff", { headers: { cookie: `__Host-solvelt_session=${seal(newVisitor(), SECRET)}` } });
    expect(readStaffSession(buyerOnly, cfg)).toBeNull();
    const value = sealStaff({ ...newStaffVisitor(), token: "stf_abcdefghijklmnop" }, SECRET);
    const both = new Request("https://shop.example.com/staff", { headers: { cookie: `a=b; __Host-solvelt_staff=${value}; c=d` } });
    expect(readStaffSession(both, cfg)?.token).toBe("stf_abcdefghijklmnop");
  });
  it("is cleared with Max-Age=0 and the same flags", () => {
    const c = clearStaffCookie(cfg);
    expect(c).toContain("Max-Age=0"); expect(c).toContain("HttpOnly"); expect(c).toContain("SameSite=Strict");
  });
});

describe("where sign-in may send a person", () => {
  it("only to a path inside /staff", () => {
    expect(safeStaffNext("/staff/buyers?x=1")).toBe("/staff/buyers?x=1");
    expect(safeStaffNext("/staff")).toBe("/staff");
    for (const bad of ["https://evil.example/staff", "//evil.example", "/account", "/staffer", "/staff\\evil", "/staff/\r\nSet-Cookie: a=b", "", undefined, null, 5, "/" + "a".repeat(400)]) expect(safeStaffNext(bad)).toBe("/staff");
  });
});
