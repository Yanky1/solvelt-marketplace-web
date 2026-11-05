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

import { bindPasskeyChallenge, checkPasskeyChallenge, hasRecentAuth, RECENT_AUTH_SECONDS, withoutPasskeyChallenge } from "./session.server";

describe("passkey challenge binding", () => {
  const base = { ...newVisitor(1000), token: "tok" };
  it("round-trips through the sealed cookie, with authAt", () => {
    const d = { ...bindPasskeyChallenge({ ...base, authAt: 1000 }, "chal-1", "get", 60_000, 1000) };
    expect(open(seal(d, SECRET), SECRET, 1001)).toEqual(d);
    expect(d.pk).toEqual({ cid: "chal-1", kind: "get", exp: 1065 });
  });
  it("accepts only the bound challenge, for the bound ceremony, before it expires", () => {
    const s = bindPasskeyChallenge(base, "chal-1", "get", 60_000, 1000);
    expect(checkPasskeyChallenge(s, "chal-1", "get", 1010)).toEqual({ ok: true });
    expect(checkPasskeyChallenge(s, "chal-2", "get", 1010)).toEqual({ ok: false, reason: "mismatch" });
    expect(checkPasskeyChallenge(s, "chal-1", "create", 1010)).toEqual({ ok: false, reason: "kind" });
    expect(checkPasskeyChallenge(s, "chal-1", "get", 1066)).toEqual({ ok: false, reason: "expired" });
    expect(checkPasskeyChallenge(s, "chal-1", "get", 1065)).toEqual({ ok: false, reason: "expired" });
  });
  it.each([undefined, null, "", 5, "x".repeat(300)])("rejects challenge id %j", (cid) => {
    expect(checkPasskeyChallenge(bindPasskeyChallenge(base, "chal-1", "get", 60_000, 1000), cid, "get", 1010).ok).toBe(false);
  });
  it("a session with no binding accepts nothing (a challenge minted in another session)", () => {
    expect(checkPasskeyChallenge(base, "chal-1", "get", 1010)).toEqual({ ok: false, reason: "none" });
  });
  it("is single use: dropping it leaves the rest of the session intact", () => {
    const s = withoutPasskeyChallenge(bindPasskeyChallenge({ ...base, authAt: 5 }, "chal-1", "get", 60_000, 1000));
    expect(s).toEqual({ ...base, authAt: 5 });
    expect(checkPasskeyChallenge(s, "chal-1", "get", 1010).ok).toBe(false);
  });
  it("caps and defaults the lifetime", () => {
    expect(bindPasskeyChallenge(base, "c", "get", 10_000_000, 1000).pk!.exp).toBe(1305);
    expect(bindPasskeyChallenge(base, "c", "get", undefined, 1000).pk!.exp).toBe(1065);
    expect(bindPasskeyChallenge(base, "c", "get", -5, 1000).pk!.exp).toBe(1065);
  });
  it("rejects a tampered shape on open", () => {
    expect(open(seal({ ...base, pk: { cid: "x", kind: "nope", exp: 1 } } as never, SECRET), SECRET, 1001)).toBeNull();
    expect(open(seal({ ...base, authAt: "now" } as never, SECRET), SECRET, 1001)).toBeNull();
  });
});

describe("recent sign-in", () => {
  const s = { ...newVisitor(1000), token: "tok" };
  it("is true only within the window after authAt, and only with a token", () => {
    expect(hasRecentAuth({ ...s, authAt: 1000 }, 1000 + RECENT_AUTH_SECONDS - 1)).toBe(true);
    expect(hasRecentAuth({ ...s, authAt: 1000 }, 1000 + RECENT_AUTH_SECONDS)).toBe(false);
    expect(hasRecentAuth(s, 1001)).toBe(false); // a session from before authAt existed must re-authenticate
    expect(hasRecentAuth({ sid: s.sid, iat: 1000, authAt: 1000 }, 1001)).toBe(false); // no token
    expect(hasRecentAuth({ ...s, authAt: 2000 }, 1500)).toBe(false); // from the future
  });
});

describe("the cart in the sealed session (decision M3W-01)", () => {
  it("round-trips the guest cart token and the item count, sealed (not readable in the cookie)", () => {
    const d = { ...newVisitor(), cart: "cart_secret_guest_token_0123456789", cn: 3 };
    const sealed = seal(d, SECRET);
    expect(Buffer.from(sealed, "base64url").toString("latin1")).not.toContain("cart_secret_guest_token");
    expect(open(sealed, SECRET)).toEqual(d);
  });
  it("refuses a cart token or count of the wrong kind or size", () => {
    const v = newVisitor();
    for (const bad of [{ cart: 5 }, { cart: "" }, { cart: "x".repeat(101) }, { cn: -1 }, { cn: 1.5 }, { cn: "3" }, { cn: 1_000_000 }]) {
      expect(open(seal({ ...v, ...bad } as never, SECRET), SECRET), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("the guest order grants in the sealed cookie", () => {
  const base = { sid: "x".repeat(32), iat: 1000 };
  it("round-trip as a list with their expiry", () => {
    const go = [{ n: "MP-A", t: "tok_aaaaaaaaaaaaaaaa", e: 5000 }, { n: "MP-B", t: "tok_bbbbbbbbbbbbbbbb" }];
    expect(open(seal({ ...base, go }, SECRET), SECRET, 1000)?.go).toEqual(go);
  });
  it("read a cookie of the older single-grant shape as a list of one", () => {
    const legacy = { ...base, go: { n: "MP-A", t: "tok_aaaaaaaaaaaaaaaa", e: 5000 } } as unknown as Parameters<typeof seal>[0];
    expect(open(seal(legacy, SECRET), SECRET, 1000)?.go).toEqual([{ n: "MP-A", t: "tok_aaaaaaaaaaaaaaaa", e: 5000 }]);
  });
  it("refuse more than five, an empty or oversized field and a bad expiry", () => {
    const g = (n: string, t = "tok_aaaaaaaaaaaaaaaa", e?: unknown) => ({ n, t, ...(e !== undefined ? { e } : {}) });
    const sealed = (go: unknown) => open(seal({ ...base, go } as unknown as Parameters<typeof seal>[0], SECRET), SECRET, 1000);
    expect(sealed(Array.from({ length: 6 }, (_, i) => g(`MP-${i}`)))).toBeNull();
    expect(sealed([g("")])).toBeNull();
    expect(sealed([g("x".repeat(41))])).toBeNull();
    expect(sealed([g("MP-A", "x".repeat(121))])).toBeNull();
    expect(sealed([g("MP-A", "tok_aaaaaaaaaaaaaaaa", "soon")])).toBeNull();
    expect(sealed([g("MP-A", "tok_aaaaaaaaaaaaaaaa", -1)])).toBeNull();
  });
});
