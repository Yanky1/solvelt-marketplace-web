import { Form, useActionData, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/staff.orders";
import { ReasonField, StaffCsrf, money, when, TableWrap } from "~/components/StaffUi";
import { FormMessage } from "~/components/AuthForm";
import { Badge, Card } from "~/components/ui/display";
import { Button, Input } from "~/components/ui/form";
import { apiMessage, assertStaffCsrf, can, failStaff, requirePermission, requireStaff, staffForm, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi, type StaffOrder } from "~/lib/staff-api.server";

export function meta() {
  return [{ title: "Orders | Solvelt staff" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { me } = await requireStaff(request, context);
  requirePermission(me, "orders.view");
  return { canRetry: can(me, "refunds.retry"), canPayments: can(me, "payments.view") };
}

type Result = { kind: "order"; order: StaffOrder } | { kind: "retried" } | { kind: "error"; message: string };
const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertStaffCsrf(request, form);
  const { ctx, me } = await requireStaff(request, context);
  const intent = text(form, "intent"), reason = text(form, "reason");
  try {
    if (intent === "find") {
      requirePermission(me, "orders.view");
      return staffForm<Result>({ kind: "order", order: await staffApi.findOrder(ctx, text(form, "number"), reason) });
    }
    if (intent === "retry") {
      requirePermission(me, "refunds.retry");
      await staffApi.retryRefund(ctx, text(form, "orderId"), text(form, "refundId"), reason);
      return staffForm<Result>({ kind: "retried" });
    }
    throw new Response("Bad request", { status: 400, headers: staffHeaders });
  } catch (e) {
    if (e instanceof Response) throw e;
    const m = apiMessage(e);
    if (m) return staffForm<Result>({ kind: "error", message: m }, 400);
    if (e && typeof e === "object" && (e as { status?: number }).status === 404 && intent === "find") return staffForm<Result>({ kind: "error", message: "No order found." }, 404);
    return failStaff(e, request);
  }
}

// The Stripe block and the refund ids are shown only to a role that holds payments.view, whatever the API sent (M7W-07: the page does not rely only on the API answering payment: null).
function OrderCard({ order, canRetry, canPayments }: { order: StaffOrder; canRetry: boolean; canPayments: boolean }) {
  const retry = useFetcher<Result>();
  const done = retry.data?.kind === "retried";
  return (
    <Card className="stack" data-testid="order-card">
      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <h2>{order.number}</h2><div className="row"><Badge>{order.status}</Badge>{order.demo && <Badge tone="gold">Demo</Badge>}</div>
      </div>
      <dl className="stack" style={{ margin: 0 }}>
        <div><dt className="muted">Buyer</dt><dd>{order.buyer.name}{order.buyer.guestEmail ? ` (guest ${order.buyer.guestEmail})` : ""} · {order.buyer.shipCountry}</dd></div>
        <div><dt className="muted">Total / paid / refunded</dt><dd>{money(order.totalCents, order.currency)} / {money(order.paidCents, order.currency)} / {money(order.refundedCents, order.currency)}</dd></div>
        <div><dt className="muted">Placed / paid</dt><dd>{when(order.createdAt)} / {when(order.paidAt)}</dd></div>
        {order.failureCode && <div><dt className="muted">Failure</dt><dd>{order.failureCode}</dd></div>}
      </dl>
      <TableWrap label="Seller orders"><table className="table"><caption className="muted">Seller orders</caption>
        <thead><tr><th scope="col">Seller order</th><th scope="col">Total</th><th scope="col">Refunded</th></tr></thead>
        <tbody>{order.groups.map((g) => <tr key={g.id}><th scope="row">{g.sellerOrderNumber ?? "not sent yet"}</th><td>{money(g.totalCents, order.currency)}</td><td>{money(g.refundedCents, order.currency)}</td></tr>)}</tbody>
      </table></TableWrap>
      <h3>Refunds</h3>
      {order.refunds.length === 0 ? <p className="muted">None.</p> : (
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {order.refunds.map((r) => (
            <li key={r.id}>
              <div>{money(r.amountCents, order.currency)} · <Badge tone={r.status === "succeeded" ? "ok" : r.status === "reserved" ? "gold" : "err"}>{r.status}</Badge> · {r.reason}{canPayments && order.payment?.refunds.find((x) => x.id === r.id)?.stripeRefundId ? ` · ${order.payment.refunds.find((x) => x.id === r.id)?.stripeRefundId}` : ""}</div>
              {canRetry && r.retryable && !done && (
                <retry.Form method="post" className="stack">
                  <StaffCsrf /><input type="hidden" name="intent" value="retry" /><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="refundId" value={r.id} />
                  <ReasonField id={`retry-${r.id}`} />
                  <Button type="submit" disabled={retry.state !== "idle"}>Retry this refund</Button>
                </retry.Form>
              )}
            </li>
          ))}
        </ul>
      )}
      {done && <FormMessage kind="ok">Queued again. Stripe is asked under the same key as before, so the buyer is refunded once.</FormMessage>}
      {retry.data?.kind === "error" && <FormMessage kind="error">{retry.data.message}</FormMessage>}
      {canPayments && order.payment && (
        <div className="stack"><h3>Payment</h3>
          <div>Intent: <code>{order.payment.paymentIntentId ?? "—"}</code></div>
          {order.payment.disputes.length > 0 && <ul>{order.payment.disputes.map((d) => <li key={d.disputeId}>Dispute {d.disputeId}: {d.lastEventType}{d.closed ? " (closed)" : ""}</li>)}</ul>}
        </div>
      )}
    </Card>
  );
}

export default function StaffOrders({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>() as Result | undefined;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="stack">
      <h2>Find an order</h2>
      <Card><Form method="post" className="stack">
        <StaffCsrf /><input type="hidden" name="intent" value="find" />
        <Input label="Order number" name="number" required maxLength={40} autoComplete="off" hint="For example MP-1001" />
        <ReasonField />
        <Button type="submit" disabled={busy}>Look up</Button>
      </Form></Card>
      {a?.kind === "error" && <FormMessage kind="error">{a.message}</FormMessage>}
      {a?.kind === "order" && <OrderCard order={a.order} canRetry={loaderData.canRetry} canPayments={loaderData.canPayments} />}
    </div>
  );
}
