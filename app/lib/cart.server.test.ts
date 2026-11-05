import { beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_CART, api, type Cart } from "./api-client.server";
import { strip, cookieFor, healCartCount } from "./cart.server";
import { newVisitor, open, readSession, seal, sessionCookie, type SessionData } from "./session.server";
import { getConfig } from "./config.server";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.PUBLIC_ORIGIN = "http://localhost:3000";
  process.env.API_BASE_URL = "http://localhost:5080";
  process.env.SESSION_COOKIE_SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
  process.env.WEB_FORWARDING_KEY = "Tn4Wb8Ke2Vr6Pj0Hs3Dy7Lc9Mf1Ga5QxZu8o";
});

const cart = (over: Partial<Cart>): Cart => ({ ...EMPTY_CART, ...over });
const pair = (setCookie: string) => setCookie.split(";")[0]!;
const valueOf = (setCookie: string) => open(pair(setCookie).split("=")[1]!, process.env.SESSION_COOKIE_SECRET!);
/** What the next request sees: the browser sends the session cookie and the cart cookie together. */
const seen = (session: SessionData, ...setCookies: string[]) =>
  readSession(new Request("http://localhost:3000/", { headers: { cookie: [pair(sessionCookie(session, getConfig())), ...setCookies.map(pair)].join("; ") } }), getConfig());

describe("cart helpers", () => {
  it("strip never passes the guest token on", () => {
    expect(JSON.stringify(strip(cart({ cartToken: "cart_secret", itemCount: 2 })))).not.toContain("cart_secret");
    expect("cartToken" in strip(cart({ cartToken: "cart_secret" }))).toBe(false);
  });
  it("a new guest token and the count go into the CART cookie, sealed for this session; nothing changes when nothing changed", () => {
    const s = newVisitor();
    const out = cookieFor(s, cart({ cartToken: "cart_new", itemCount: 2 })) as { setCookie?: string };
    expect(out.setCookie).toMatch(/^solvelt_cart=/);
    expect(out.setCookie).toContain("HttpOnly");
    const next = seen(s, out.setCookie!)!;
    expect(next.cart).toBe("cart_new");
    expect(next.cn).toBe(2);
    const withCart = { ...s, cart: "cart_new", cn: 2 };
    expect(cookieFor(withCart, cart({ itemCount: 2 }))).toEqual({});
    expect(seen(s, (cookieFor(withCart, cart({ itemCount: 5 })) as { setCookie: string }).setCookie)!.cn).toBe(5);
  });
  it("a signed-in session never stores a guest token", () => {
    const signedIn = { ...newVisitor(), token: "tok" };
    const out = cookieFor(signedIn, cart({ cartToken: "cart_ignored", itemCount: 1 })) as { setCookie: string };
    expect(seen(signedIn, out.setCookie)!.cart).toBeUndefined();
  });
  it("the session cookie never holds the cart state, so a cart request cannot rewrite the token (M7W-09)", () => {
    const s: SessionData = { ...newVisitor(), token: "tok-tok-tok-tok", cart: "cart_x", cn: 4 };
    const inside = valueOf(sessionCookie(s, getConfig()))!;
    expect(inside.token).toBe("tok-tok-tok-tok");
    expect(inside.cart).toBeUndefined();
    expect(inside.cn).toBeUndefined();
    // a cart write is a different cookie altogether, and has no token in it
    const out = cookieFor({ ...s, cn: 1 }, cart({ itemCount: 4 })) as { setCookie: string };
    expect(out.setCookie).toMatch(/^solvelt_cart=/);
    expect(out.setCookie).not.toMatch(/^solvelt_session=/);
  });
  it("a cart cookie sealed for ANOTHER session id counts for nothing: a slow request that writes after a sign-in or a token rotation changes nothing", () => {
    const before = { ...newVisitor(), token: "old-token-old-token" };
    const late = (cookieFor(before, cart({ itemCount: 7 })) as { setCookie: string }).setCookie;   // written late, for the id the session had before the rotation
    const after = { ...newVisitor(), token: "new-token-new-token" };                              // the rotation: a new id and a new token
    const next = seen(after, late)!;
    expect(next.token).toBe("new-token-new-token");
    expect(next.cn).toBeUndefined();
    expect(next.cart).toBeUndefined();
  });
  it("a session cookie from before the split, with the cart state inside, still reads as before", () => {
    const old: SessionData = { ...newVisitor(), cart: "cart_old", cn: 3 };
    const next = readSession(new Request("http://localhost:3000/", { headers: { cookie: `solvelt_session=${seal(old, process.env.SESSION_COOKIE_SECRET!)}` } }), getConfig())!;
    expect(next.cart).toBe("cart_old");
    expect(next.cn).toBe(3);
  });
  it("without a session there is nothing to remember", () => {
    expect(cookieFor(null, cart({ cartToken: "x" }))).toEqual({});
  });
});

describe("healCartCount", () => {
  const req = () => new Request("http://localhost:3000/");
  const ctx = () => ({ socketAddress: "127.0.0.1" }) as never;
  const signedIn = { ...newVisitor(), token: "tok" };

  it("asks the API once per request however many loaders ask, and remembers the count in the sealed cookie", async () => {
    const spy = vi.spyOn(api, "cart").mockResolvedValue(cart({ itemCount: 3 }));
    const c = ctx();
    const [a, b] = await Promise.all([healCartCount(req(), c, signedIn, true), healCartCount(req(), c, signedIn, true)]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(a?.cn).toBe(3);
    expect(b).toBe(a);
    expect(a!.setCookie).toMatch(/^solvelt_cart=/);
    expect(seen(signedIn, a!.setCookie)?.cn).toBe(3);
    spy.mockRestore();
  });

  it("does nothing when the count is known, when nobody is signed in or when the session is a guest", async () => {
    const spy = vi.spyOn(api, "cart").mockResolvedValue(cart({ itemCount: 3 }));
    expect(await healCartCount(req(), ctx(), { ...signedIn, cn: 0 }, true)).toBeNull();
    expect(await healCartCount(req(), ctx(), signedIn, false)).toBeNull();
    expect(await healCartCount(req(), ctx(), newVisitor(), true)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("a failing cart call heals nothing and never throws (the next page load tries again)", async () => {
    const spy = vi.spyOn(api, "cart").mockRejectedValue(new Error("down"));
    expect(await healCartCount(req(), ctx(), signedIn, true)).toBeNull();
    spy.mockRestore();
  });
});
