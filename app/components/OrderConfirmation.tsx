import { useEffect, useRef } from "react";
import { Link, useRevalidator } from "react-router";
import { Card, EmptyState, formatMoney } from "~/components/ui/display";
import { LinkButton } from "~/components/ui/form";
import { ORDER_STATUS_TEXT, WAITING_ORDER_STATUSES, startPolling } from "~/lib/checkout";
import type { ConfirmationData } from "~/lib/confirmation.server";

/** The order page for the buyer after paying and for a guest's emailed link; the data comes from `loadConfirmation`. */
export function OrderConfirmation({ order, lost }: Pick<ConfirmationData, "order" | "lost">) {
  const { revalidate, state } = useRevalidator();
  const waiting = !!order && WAITING_ORDER_STATUSES.has(order.status);
  // The router's busy/idle state and revalidate live in refs (updated in an effect): the polling effect depends only on `waiting`, so a revalidation (which flips `state`) cannot restart the poll count.
  const idle = useRef(true);
  const again = useRef(revalidate);
  useEffect(() => { idle.current = state === "idle"; again.current = revalidate; });
  useEffect(() => (waiting ? startPolling(() => again.current(), () => idle.current) : undefined), [waiting]);

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
