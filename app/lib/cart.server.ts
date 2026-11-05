import type { AppLoadContext } from "react-router";
import { ApiError, EMPTY_CART, api, type Cart } from "./api-client.server";
import { apiCtx } from "./auth.server";
import { getConfig } from "./config.server";
import { readSession, sessionCookie, type SessionData } from "./session.server";

/**
 * The guest cart token lives ONLY in the sealed, HttpOnly session cookie (decision M3W-01): never in loader data, HTML, JS, storage or a URL. These helpers read the cart for this
 * request and say what the cookie should look like afterwards (a new guest token, or the item count the header shows), without the token ever leaving the server.
 */
export interface CartResult { cart: Cart; session: SessionData | null; /** A Set-Cookie value when the cookie must change. */ setCookie?: string }

/** The cart as the API sees it for this visitor: the account's when signed in, otherwise the guest cart of the cookie (none = empty, no API call). */
export async function readCart(request: Request, context: AppLoadContext): Promise<CartResult> {
  const session = readSession(request, getConfig());
  if (!session || (!session.token && !session.cart)) return { cart: EMPTY_CART, session };
  try {
    const cart = await api.cart(apiCtx(request, context, session), session.cart);
    return { cart: strip(cart), session, ...cookieFor(session, cart) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return { cart: EMPTY_CART, session };   // a dead session: the root loader replaces the cookie
    throw e;
  }
}

/** Never hand the token on: the page and the browser only get what they display. */
export function strip(cart: Cart): Cart {
  const { cartToken: _t, ...rest } = cart;
  void _t;
  return rest;
}

/** The cookie after a cart answer: remembers a NEW guest token and the item count; null when nothing changed. */
export function cookieFor(session: SessionData | null, cart: Cart): { setCookie: string } | Record<string, never> {
  if (!session) return {};
  const next: SessionData = { ...session, cn: cart.itemCount };
  if (!session.token && cart.cartToken) next.cart = cart.cartToken;
  if (next.cn === session.cn && next.cart === session.cart) return {};
  return { setCookie: sessionCookie(next, getConfig()) };
}

/**
 * At sign-in (password or passkey): the guest cart of this browser is merged into the account's (the API does it atomically, once), then the old guest token is gone with the rotated cookie.
 * Returns the item count the header should show. Best effort: a failing cart never blocks signing in (the guest cart simply stays unmerged on the API and expires there).
 */
export async function afterSignIn(request: Request, context: AppLoadContext, newToken: string): Promise<{ cn?: number }> {
  const old = readSession(request, getConfig());
  const ctx = { request, socketAddress: context.socketAddress, sessionToken: newToken };
  try {
    const cart = old?.cart ? await api.cartMerge(ctx, old.cart) : await api.cart(ctx);
    return { cn: cart.itemCount };
  } catch {
    return {};
  }
}

export type HealedCount = { cn: number; setCookie: string } | null;
const healed = new WeakMap<object, Promise<HealedCount>>();

/**
 * Self-healing header count: a signed-in session whose cookie has no item count (the cart call at sign-in failed: afterSignIn is best effort) asks the API for the account's cart ONCE
 * and remembers the count in the cookie. Memoised per request (the load context is one object per request), so however many loaders ask it is at most one API call; null when
 * there is nothing to heal (not signed in, or the count is already known) or the API could not answer (the next page load tries again).
 */
export function healCartCount(request: Request, context: AppLoadContext, session: SessionData, signedIn: boolean): Promise<HealedCount> {
  if (!signedIn || !session.token || session.cn !== undefined) return Promise.resolve(null);
  const hit = healed.get(context);
  if (hit) return hit;
  const run = async (): Promise<HealedCount> => {
    try {
      const cart = await api.cart(apiCtx(request, context, session));
      return { cn: cart.itemCount, setCookie: sessionCookie({ ...session, cn: cart.itemCount }, getConfig()) };
    } catch {
      return null;
    }
  };
  const p = run();
  healed.set(context, p);
  return p;
}
