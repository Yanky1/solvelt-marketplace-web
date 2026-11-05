import { beforeAll, describe, expect, it, vi } from "vitest";
import { EMPTY_CART, api, type Cart } from "./api-client.server";
import { strip, cookieFor, healCartCount } from "./cart.server";
import { newVisitor, open } from "./session.server";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.PUBLIC_ORIGIN = "http://localhost:3000";
  process.env.API_BASE_URL = "http://localhost:5080";
  process.env.SESSION_COOKIE_SECRET = "Xk9#Qz3vLp7Xw2Rt8YbN4mHc6Jd1Fs5GaU0e";
  process.env.WEB_FORWARDING_KEY = "Tn4Wb8Ke2Vr6Pj0Hs3Dy7Lc9Mf1Ga5QxZu8o";
});

const cart = (over: Partial<Cart>): Cart => ({ ...EMPTY_CART, ...over });
const valueOf = (setCookie: string) => open(setCookie.split(";")[0]!.split("=")[1]!, process.env.SESSION_COOKIE_SECRET!);

describe("cart helpers", () => {
  it("strip never passes the guest token on", () => {
    expect(JSON.stringify(strip(cart({ cartToken: "cart_secret", itemCount: 2 })))).not.toContain("cart_secret");
    expect("cartToken" in strip(cart({ cartToken: "cart_secret" }))).toBe(false);
  });
  it("a new guest token and the count go into the sealed cookie; nothing changes when nothing changed", () => {
    const s = newVisitor();
    const out = cookieFor(s, cart({ cartToken: "cart_new", itemCount: 2 })) as { setCookie?: string };
    const inside = valueOf(out.setCookie!)!;
    expect(inside.cart).toBe("cart_new");
    expect(inside.cn).toBe(2);
    expect(out.setCookie).toContain("HttpOnly");
    expect(cookieFor({ ...s, cart: "cart_new", cn: 2 }, cart({ itemCount: 2 }))).toEqual({});
    expect(valueOf((cookieFor({ ...s, cart: "cart_new", cn: 2 }, cart({ itemCount: 5 })) as { setCookie: string }).setCookie)!.cn).toBe(5);
  });
  it("a signed-in session never stores a guest token", () => {
    const signedIn = { ...newVisitor(), token: "tok" };
    const out = cookieFor(signedIn, cart({ cartToken: "cart_ignored", itemCount: 1 })) as { setCookie: string };
    expect(valueOf(out.setCookie)!.cart).toBeUndefined();
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
    expect(valueOf(a!.setCookie)?.cn).toBe(3);
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
