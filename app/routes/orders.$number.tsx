import { data, redirect } from "react-router";
import type { Route } from "./+types/orders.$number";
import { OrderConfirmation } from "~/components/OrderConfirmation";
import { privateHeaders } from "~/lib/auth.server";
import { looksLikeGuestToken } from "~/lib/checkout";
import { loadConfirmation } from "~/lib/confirmation.server";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { newVisitor, readSession, sessionCookie } from "~/lib/session.server";

export function meta() {
  // the token is in the address only until the redirect below; never let a referrer or a crawler keep a page that had one
  return [{ title: "Your order | Solvelt" }, { name: "robots", content: "noindex" }, { name: "referrer", content: "no-referrer" }];
}
export function headers() {
  return privateHeaders;   // Referrer-Policy: no-referrer for /orders/* is set once in server.js
}

/**
 * The link in the order mail: `/orders/<number>?guest=<token>`. The token is sealed into the HttpOnly session cookie for exactly this order and the browser is sent to the same address WITHOUT it (303),
 * so the token never stays in the address bar, the history or a referrer. Without a token this is the order page, read with whatever the cookie holds. A link whose token is not token-shaped is
 * ignored (the page then says it cannot show the order).
 */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const number = params.number;
  if (!isSafeId(number)) throw data("Not found", { status: 404, headers: privateHeaders });
  const bare = `/orders/${encodeURIComponent(number)}`;
  const url = new URL(request.url);
  if (url.searchParams.has("guest")) {
    const token = url.searchParams.get("guest");
    const cfg = getConfig();
    if (!looksLikeGuestToken(token)) throw redirect(bare, { status: 303, headers: privateHeaders });
    const session = readSession(request, cfg) ?? newVisitor();
    // a signed-in browser keeps its account; the grant is for the guest reading of this one order
    throw redirect(bare, { status: 303, headers: { ...privateHeaders, "Set-Cookie": sessionCookie({ ...session, go: { n: number, t: token } }, cfg) } });
  }
  return loadConfirmation(request, context, number, bare);
}

export default function GuestOrder({ loaderData }: Route.ComponentProps) {
  return <OrderConfirmation order={loaderData.order} lost={loaderData.lost} />;
}
