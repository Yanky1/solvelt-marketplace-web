import { beforeAll, describe, expect, it } from "vitest";
import { EMPTY_CART, type Cart } from "./api-client.server";
import { strip, cookieFor } from "./cart.server";
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
