import { describe, expect, it } from "vitest";
import { csrfTokenFor, csrfValid, newVisitor, open, readSession, seal, sessionCookie } from "./session.server";

const SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
const OTHER = "Tn4Wb8Ke2Vr6Pj0Hs3Dy7Lc9Mf1Ga5QxZu8o";
const cfg = { publicOrigin: "https://shop.example.com", sessionCookieSecret: SECRET };

describe("sealed session", () => {
  it("round-trips and never contains the token in clear text", () => {
    const d = { ...newVisitor(), token: "tok_super_secret_value" };
    const sealed = seal(d, SECRET);
    expect(sealed).not.toContain("tok_super_secret_value");
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("tok_super_secret_value");
    expect(open(sealed, SECRET)).toEqual(d);
  });
  it("rejects tampering, a wrong secret, garbage and expired cookies", () => {
    const sealed = seal(newVisitor(), SECRET);
    const raw = Buffer.from(sealed, "base64url");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 1;
    expect(open(raw.toString("base64url"), SECRET)).toBeNull();
    expect(open(sealed, OTHER)).toBeNull();
    expect(open("not-a-cookie", SECRET)).toBeNull();
    expect(open("", SECRET)).toBeNull();
    expect(open(seal({ sid: "x".repeat(32), iat: 1000 }, SECRET), SECRET, 1000 + 60 * 60 * 24 * 31)).toBeNull();
  });
  it("produces a fresh ciphertext each time (random IV)", () => {
    const d = newVisitor();
    expect(seal(d, SECRET)).not.toBe(seal(d, SECRET));
  });
});

describe("session cookie", () => {
  it("is HttpOnly, SameSite=Lax, Secure and __Host- prefixed on https", () => {
    const c = sessionCookie({ ...newVisitor(), token: "tok" }, cfg);
    expect(c).toMatch(/^__Host-solvelt_session=/);
    expect(c).toContain("HttpOnly");
    expect(c).toContain("SameSite=Lax");
    expect(c).toContain("Secure");
    expect(c).toContain("Path=/");
    expect(c).not.toContain("Domain");
  });
  it("is readable back from a Cookie header among other cookies", () => {
    const d = { ...newVisitor(), token: "tok" };
    const value = sessionCookie(d, cfg).split(";")[0]!;
    expect(readSession(new Request("https://x", { headers: { cookie: `a=b; ${value}; solvelt_theme=dark` } }), cfg)).toEqual(d);
    expect(readSession(new Request("https://x", { headers: { cookie: "a=b" } }), cfg)).toBeNull();
    expect(readSession(new Request("https://x"), cfg)).toBeNull();
  });
  it("uses a plain name without Secure on http localhost", () => {
    const c = sessionCookie(newVisitor(), { ...cfg, publicOrigin: "http://localhost:3000" });
    expect(c).toMatch(/^solvelt_session=/);
    expect(c).not.toContain("Secure");
  });
});

describe("csrf token", () => {
  it("validates only for its own session id and secret", () => {
    const t = csrfTokenFor("sid-aaaaaaaaaaaaaaaaaaaa", SECRET);
    expect(csrfValid("sid-aaaaaaaaaaaaaaaaaaaa", t, SECRET)).toBe(true);
    expect(csrfValid("sid-bbbbbbbbbbbbbbbbbbbb", t, SECRET)).toBe(false);
    expect(csrfValid("sid-aaaaaaaaaaaaaaaaaaaa", t, OTHER)).toBe(false);
  });
  it.each([undefined, null, "", "x", 5, "a".repeat(500)])("rejects %j", (v) => { expect(csrfValid("sid-aaaaaaaaaaaaaaaaaaaa", v, SECRET)).toBe(false); });
  it("is not derived with the cookie key (differs from the sealed value)", () => {
    expect(csrfTokenFor("sid", SECRET)).not.toBe(seal({ sid: "sid", iat: 1 }, SECRET));
  });
});
