import { data, redirect, type AppLoadContext } from "react-router";
import { ApiError, api, type CheckoutOrder } from "~/lib/api-client.server";
import { apiCtx, privateHeaders } from "~/lib/auth.server";
import { FINAL_ORDER_STATUSES, guestTokenFor, hasReturnParams, withoutGrant } from "~/lib/checkout";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { cartCookie, readSession, sessionCookie } from "~/lib/session.server";

export interface ConfirmationData { order: CheckoutOrder | null; lost: boolean; cartEmptied: boolean }

/**
 * One order, for the page after payment (`/checkout/confirmation/:number`) and for the link in the mail (`/orders/:number`): the page follows the order's real status from the API, the address's own
 * query string is never believed. A return from Stripe carries `payment_intent`, its client secret and `redirect_status`: none of it is used or kept, the address is cleaned by a 303 first (L3). A
 * guest reads the order with the order-access token that the sealed cookie holds for exactly this order number and only until the API's expiry; once the order is final, the token is dropped from
 * the cookie (the emailed link remains) (L4).
 */
export async function loadConfirmation(request: Request, context: AppLoadContext, number: string, barePath: string) {
  if (!isSafeId(number)) throw data("Not found", { status: 404, headers: privateHeaders });
  if (hasReturnParams(new URL(request.url))) throw redirect(barePath, { status: 303, headers: privateHeaders });
  const cfg = getConfig();
  const session = readSession(request, cfg);
  // the grant for THIS order wins when there is one (a signed-in browser may open a guest's link); the account is the fallback
  const guestToken = guestTokenFor(session?.go, number);
  const lost = { order: null, lost: true, cartEmptied: false } satisfies ConfirmationData;
  if (!session?.token && !guestToken) return data(lost, { headers: privateHeaders });
  const ctx = apiCtx(request, context, session);
  try {
    let order: CheckoutOrder | undefined;
    let viaGrant = false;
    if (guestToken) {
      try { order = await api.checkoutOrder({ ...ctx, sessionToken: undefined }, number, guestToken); viaGrant = true; }
      catch (e) { if (!(e instanceof ApiError && (e.status === 404 || e.status === 401)) || !session?.token) throw e; }
    }
    order ??= await api.checkoutOrder(ctx, number);
    const done = order.status === "paid" || order.status === "placed";
    const headers = new Headers(privateHeaders);
    // a paid order emptied the cart: the header count follows (the cart cookie); a final order no longer needs the guest token (the session cookie, only when there is a grant to drop)
    const dropGrant = viaGrant && FINAL_ORDER_STATUSES.has(order.status);
    if (session && dropGrant) {
      const left = withoutGrant(session.go, number);
      const { go: _go, ...rest } = session;
      void _go;
      headers.append("Set-Cookie", sessionCookie({ ...rest, ...(left ? { go: left } : {}) }, cfg));
    }
    if (session && done && session.cn !== 0) headers.append("Set-Cookie", cartCookie(session.sid, { ...(session.cart !== undefined ? { cart: session.cart } : {}), cn: 0 }, cfg));
    return data({ order, lost: false, cartEmptied: done } satisfies ConfirmationData, { headers });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 401)) return data(lost, { headers: privateHeaders });
    throw data("Unavailable", { status: 503, headers: privateHeaders });
  }
}
