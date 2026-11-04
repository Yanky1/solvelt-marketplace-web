import { useEffect } from "react";
import { Link, data, useRevalidator } from "react-router";
import type { Route } from "./+types/checkout.confirmation.$number";
import { Card, EmptyState, formatMoney } from "~/components/ui/display";
import { LinkButton } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, privateHeaders } from "~/lib/auth.server";
import { ORDER_STATUS_TEXT } from "~/lib/checkout";
import { getConfig } from "~/lib/config.server";
import { isSafeId } from "~/lib/passkey.server";
import { readSession, sessionCookie } from "~/lib/session.server";

export function meta() {
  return [{ title: "Your order | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

/** Where the buyer lands after Stripe: the page follows the order's real status from the API (the redirect's own query string is never believed). */
export async function loader({ request, context, params }: Route.LoaderArgs) {
  const number = params.number;
  if (!isSafeId(number)) throw data("Not found", { status: 404, headers: privateHeaders });
  const cfg = getConfig();
  const session = readSession(request, cfg);
  // a signed-in buyer's own order, or a guest's through the order-access token that checkout sealed into the cookie for exactly this order
  const guestToken = !session?.token && session?.go?.n === number ? session.go.t : undefined;
  if (!session?.token && !guestToken) return data({ order: null as null, lost: true, cartEmptied: false }, { headers: privateHeaders });
  try {
    const order = await api.checkoutOrder(apiCtx(request, context, session), number, guestToken);
    const done = order.status === "paid" || order.status === "placed";
    // a paid order emptied the cart: the header count follows (the sealed cookie keeps the last count the server saw)
    const headers: Record<string, string> = { ...privateHeaders };
    if (done && session && session.cn !== 0) headers["Set-Cookie"] = sessionCookie({ ...session, cn: 0 }, cfg);
    return data({ order, lost: false, cartEmptied: done }, { headers });
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 401)) return data({ order: null as null, lost: true, cartEmptied: false }, { headers: privateHeaders });
    throw data("Unavailable", { status: 503, headers: privateHeaders });
  }
}

const WAITING = new Set(["pending_payment", "payment_processing", "paid"]);

export default function Confirmation({ loaderData }: Route.ComponentProps) {
  const { order, lost } = loaderData;
  const { revalidate, state } = useRevalidator();
  const waiting = !!order && WAITING.has(order.status);
  useEffect(() => {
    if (!waiting) return;
    // up to about two minutes, every 3 seconds; after that the page stays as it is and says where to look
    let n = 0;
    const t = setInterval(() => { if (++n > 40) clearInterval(t); else if (state === "idle") revalidate(); }, 3000);
    return () => clearInterval(t);
  }, [waiting, revalidate, state]);

  if (lost || !order) {
    return (
      <EmptyState title="We can't show this order here" action={<LinkButton to="/">Keep shopping</LinkButton>}>
        If you just paid, your order is safe: we email you a confirmation with a link to follow it. Signed-in buyers find it under Your orders.
      </EmptyState>
    );
  }
  const text = ORDER_STATUS_TEXT[order.status] ?? { title: "Your order", text: "We are updating its status.", tone: "wait" as const };
  return (
    <div className="stack">
      <h1>{text.title}</h1>
      <p role="status" data-testid="order-status" data-status={order.status}>{text.text}</p>
      <Card className="stack">
        <p style={{ margin: 0 }}>Order <strong>{order.number}</strong>{order.totalCents !== undefined && <> · Total <strong>{formatMoney(order.totalCents, order.currency ?? "USD")}</strong></>}</p>
        {order.groups?.map((g) => (
          <div key={`${g.sellerName}:${g.brandName}`}>
            <strong>{g.brandName || g.sellerName}</strong>
            <ul style={{ margin: 0 }}>{g.lines.map((l, i) => <li key={i}>{l.quantity} x {l.title}{l.variantName ? `, ${l.variantName}` : ""}</li>)}</ul>
          </div>
        ))}
      </Card>
      {order.status === "placed" && <p><Link to={`/account/orders/${encodeURIComponent(order.number)}`}>Follow this order</Link> (signed-in buyers) or use the link in your confirmation email.</p>}
      {text.tone === "bad" && <LinkButton to="/cart">Back to your cart</LinkButton>}
      {waiting && <p className="muted"><noscript>Refresh this page in a moment. </noscript>This page checks by itself every few seconds.</p>}
    </div>
  );
}
