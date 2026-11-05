import { beforeEach, describe, expect, it, vi } from "vitest";
import { newVisitor, readSession, type SessionData } from "./session.server";

const SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
const cfg = { publicOrigin: "https://shop.example.com", sessionCookieSecret: SECRET };
vi.mock("./config.server", () => ({ getConfig: vi.fn() }));
import { getConfig } from "./config.server";
import { tokenOf } from "./api-client.server";
import { cookieWithNewToken, signInHeaders } from "./auth.server";

const read = (setCookie: string) => readSession(new Request("https://shop.example.com/", { headers: { cookie: setCookie.split(";")[0]! } }), cfg);

describe("tokenOf (the answer of a password change or a passkey removal)", () => {
  it("is the token of a 200 { token } answer", () => {
    expect(tokenOf({ token: "abcdefgh_-ABC123" })).toBe("abcdefgh_-ABC123");
  });
  it("is undefined for a 204 (no body), an empty answer and anything that is not a plausible token", () => {
    for (const v of [undefined, null, "", "x", 5, [], {}, { token: "" }, { token: "short" }, { token: 12345678 }, { token: null }, { token: "has space in it" }, { token: "new\nline-token" }, { token: "t".repeat(513) }, { token: "é-not-ascii-token" }])
      expect(tokenOf(v), JSON.stringify(v)).toBeUndefined();
  });
});

describe("cookieWithNewToken", () => {
  beforeEach(() => vi.mocked(getConfig).mockReturnValue(cfg as never));
  const T0 = Math.floor(Date.now() / 1000) - 600;   // ten minutes ago
  const old: SessionData = { ...newVisitor(T0), token: "old-token-old-token", authAt: T0 + 100, cn: 3 };

  it("carries the new token under a new session id; the item count is not carried (the old cart cookie is void under the new id and the root loader reads the count again)", () => {
    const set = cookieWithNewToken(old, "new-token-new-token", false, T0 + 500);
    const s = read(set)!;
    expect(s.token).toBe("new-token-new-token");
    expect(s.sid).not.toBe(old.sid);
    expect(s.cn).toBeUndefined();
    expect(set).toMatch(/^__Host-solvelt_session=/);
  });
  it("restarts the recent sign-in clock after a password change, and never extends it after a passkey removal", () => {
    expect(read(cookieWithNewToken(old, "new-token-new-token", true, T0 + 500))!.authAt).toBe(T0 + 500);
    expect(read(cookieWithNewToken(old, "new-token-new-token", false, T0 + 500))!.authAt).toBe(T0 + 100);
    const never: SessionData = { ...newVisitor(T0), token: "old-token-old-token" };
    expect(read(cookieWithNewToken(never, "new-token-new-token", false, T0 + 500))!.authAt).toBeUndefined();   // no step-up before: none invented
  });
  it("does not carry the old token, a passkey challenge binding or a wrong-password count into the new session", () => {
    const busy: SessionData = { ...old, pk: { cid: "c", kind: "get", exp: 9_999_999_999 }, rf: 2 };
    const s = read(cookieWithNewToken(busy, "new-token-new-token", false, T0 + 500))!;
    expect(JSON.stringify(s)).not.toContain("old-token-old-token");
    expect(s.pk).toBeUndefined();
    expect(s.rf).toBeUndefined();
  });
});

describe("signInHeaders", () => {
  beforeEach(() => vi.mocked(getConfig).mockReturnValue(cfg as never));
  it("sets the session cookie and a cart cookie for the SAME new id: the token is only in the first", () => {
    const h = signInHeaders("tok-tok-tok-tok-tok", { cn: 2 });
    const cookies = h.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^__Host-solvelt_session=/);
    expect(cookies[1]).toMatch(/^__Host-solvelt_cart=/);
    const s = readSession(new Request("https://shop.example.com/", { headers: { cookie: cookies.map((c) => c.split(";")[0]).join("; ") } }), cfg)!;
    expect(s.token).toBe("tok-tok-tok-tok-tok");
    expect(s.cn).toBe(2);
    expect(h.get("Cache-Control")).toBe("private, no-store");
  });
  it("sets no cart cookie when the cart call failed (the count then heals on the first page)", () => {
    const cookies = signInHeaders("tok-tok-tok-tok-tok", {}).getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(readSession(new Request("https://shop.example.com/", { headers: { cookie: cookies[0]!.split(";")[0]! } }), cfg)!.cn).toBeUndefined();
  });
});
