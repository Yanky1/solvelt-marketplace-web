import { randomUUID } from "node:crypto";
import { Form, Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/account.orders.$number";
import { AccountNav } from "~/components/AccountNav";
import { ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Badge, Breadcrumb, Card, formatMoney } from "~/components/ui/display";
import { Button, Select } from "~/components/ui/form";
import { safeFieldErrors } from "~/lib/api-errors";
import { ApiError, api, type OrderGroupView, type ShipmentView } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { isSafeId } from "~/lib/passkey.server";
import {
  ATTEMPT_REASON, CANCEL_REASONS, CANCEL_STATUS, REFUND_STATUS, RETURN_REASONS, RETURN_STATUS, formatDate, formatWindow, progressSteps, safeHttps, statusLabel, statusTone, trackingLabel,
} from "~/lib/orders";
import { cleanField, str } from "~/lib/validation";
import { DEMO_REFUSED_CODE, DEMO_REFUSED_TEXT } from "~/lib/demo";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `Order ${params.number} | Solvelt` }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.number)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  try {
    // `idem` is minted per page render: the return form carries it as the Idempotency-Key, so a double click or a re-sent form is one return.
    return { order: await api.order(ctx, params.number), idem: randomUUID(), done: new URL(request.url).searchParams.get("done") };
  } catch (e) {
    return failAccount(e, request);
  }
}

const CONFLICT_TEXT: Record<string, string> = {
  [DEMO_REFUSED_CODE]: DEMO_REFUSED_TEXT,
  not_cancellable: "This order can no longer be cancelled.",
  not_shipped: "This order has not shipped yet.",
  order_not_ready: "This order is not ready for that yet.",
  not_returnable: "These items can no longer be returned.",
  no_label: "There is no return label to refresh for this return.",
};
const INTENTS = ["cancel", "return", "confirm", "label"] as const;

export async function action({ request, context, params }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  if (!isSafeId(params.number)) throw new Response("Not found", { status: 404, headers: privateHeaders });
  const intent = str(form, "intent");
  const seller = str(form, "sellerOrderNumber");
  if (!(INTENTS as readonly string[]).includes(intent) || !isSafeId(seller)) throw new Response("Bad request", { status: 400, headers: privateHeaders });
  const back = (done: string) => new Response(null, { status: 303, headers: { ...privateHeaders, Location: `/account/orders/${encodeURIComponent(params.number)}?done=${done}#seller-${encodeURIComponent(seller)}` } });
  try {
    if (intent === "confirm") { await api.confirmDelivery(ctx, params.number, seller); return back("confirm"); }
    if (intent === "label") {
      const rid = str(form, "returnId");
      if (!isSafeId(rid)) throw new Response("Bad request", { status: 400, headers: privateHeaders });
      await api.refreshReturnLabel(ctx, params.number, rid);
      return back("label");
    }
    if (intent === "cancel") {
      const reason = str(form, "reason");
      if (!(reason in CANCEL_REASONS)) return formError({ intent, seller, fieldErrors: { reason: "Choose a reason." }, message: null }, 422);
      await api.requestCancel(ctx, params.number, { sellerOrderNumber: seller, reason, note: cleanField(form, "note").slice(0, 500) });
      return back("cancel");
    }
    // return: quantities come from `qty:<lineId>` fields
    const reason = str(form, "reason");
    const lines: { lineId: string; quantity: number }[] = [];
    for (const [k, v] of form.entries()) {
      if (!k.startsWith("qty:") || typeof v !== "string") continue;
      const lineId = k.slice(4);
      const quantity = Number(v);
      if (isSafeId(lineId) && Number.isInteger(quantity) && quantity > 0 && quantity <= 1000) lines.push({ lineId, quantity });
    }
    const fieldErrors: Record<string, string> = {};
    if (!(reason in RETURN_REASONS)) fieldErrors.reason = "Choose a reason.";
    if (lines.length === 0) fieldErrors.lines = "Choose at least one item and how many to return.";
    if (Object.keys(fieldErrors).length) return formError({ intent, seller, fieldErrors, message: null }, 422);
    const idem = str(form, "idem");
    await api.requestReturn(ctx, params.number, { sellerOrderNumber: seller, reason, comment: cleanField(form, "comment").slice(0, 1000), lines }, /^[A-Za-z0-9-]{8,64}$/.test(idem) ? idem : randomUUID());
    return back("return");
  } catch (e) {
    if (e instanceof Response) throw e;
    if (e instanceof ApiError && e.status === 422) return formError({ intent, seller, fieldErrors: safeFieldErrors(e.fieldErrors, ["reason", "lines", "note", "comment"]), message: e.code === "quantity_exceeded" ? "Some items can no longer be returned in that quantity. Check the quantities and try again." : null }, 422);
    if (e instanceof ApiError && e.status === 409) return formError({ intent, seller, fieldErrors: {}, message: CONFLICT_TEXT[e.code] ?? "That is not possible right now." }, 409);
    if (e instanceof ApiError && e.status !== 401 && e.status !== 404) return formError({ intent, seller, fieldErrors: {}, message: "We could not do that right now. Please try again." }, 503);
    return failAccount(e, request);
  }
}

function Steps({ status }: { status: string }) {
  if (status === "cancelled" || status === "refunded") return null;
  return (
    <ol className="row" aria-label="Order progress" style={{ listStyle: "none", padding: 0 }}>
      {progressSteps(status).map((s) => (
        <li key={s.label}><Badge tone={s.done ? "ok" : "neutral"}>{s.label}{s.done ? <span className="sr-only"> (done)</span> : <span className="sr-only"> (not yet)</span>}</Badge></li>
      ))}
    </ol>
  );
}

function Tracking({ number, s }: { number: string; s: ShipmentView }) {
  const link = safeHttps(s.trackingUrl);
  const local = s.method === "local";
  return (
    <section aria-label={`Shipment ${s.trackingNumber ?? ""}`.trim()} className="stack">
      <h4 style={{ margin: 0 }}>{local ? "Local delivery" : `Shipped${s.carrier ? ` with ${s.carrier}` : ""}`}{s.voided ? " (cancelled label)" : ""}</h4>
      {s.trackingStatus && <p><Badge tone={s.trackingStatus === "delivered" ? "ok" : s.trackingStatus === "failure" ? "err" : "gold"}>{trackingLabel(s.trackingStatus)}</Badge>{s.trackingStatusDetail ? <> <span className="muted">{s.trackingStatusDetail}</span></> : null}</p>}
      {s.trackingNumber && <p className="muted">Tracking number: {link ? <a href={link} rel="noopener noreferrer" target="_blank">{s.trackingNumber}</a> : s.trackingNumber}</p>}
      {local && s.etaWindowStart && !s.deliveredAt && <p>Delivery window: {formatDate(s.etaWindowStart)}, {formatWindow(s.etaWindowStart, s.etaWindowEnd)}</p>}
      {s.eta && !s.deliveredAt && <p>{local ? "Estimated arrival" : "Expected"}: {formatDate(s.eta, local)}</p>}
      {local && s.driverFirstName && !s.deliveredAt && <p>Your driver is {s.driverFirstName}.</p>}
      {s.position && <p role="status">Your driver is on the way to you now (last update {formatDate(s.position.at, true)}).</p>}
      {s.deliveredAt && <p>Delivered {formatDate(s.deliveredAt, true)}{s.placement ? `, left at: ${s.placement.replace(/_/g, " ")}` : ""}.</p>}
      {s.proofCount > 0 && (
        <div className="row">
          {Array.from({ length: s.proofCount }, (_, i) => (
            <a key={i} href={`/account/orders/${encodeURIComponent(number)}/proof/${encodeURIComponent(s.id)}/${i}`} target="_blank" rel="noopener noreferrer">
              <img src={`/account/orders/${encodeURIComponent(number)}/proof/${encodeURIComponent(s.id)}/${i}`} alt={`Proof of delivery ${i + 1} of ${s.proofCount}`} width={120} height={120} loading="lazy" style={{ objectFit: "cover", borderRadius: "var(--r-ctl)" }} />
            </a>
          ))}
        </div>
      )}
      {s.timeline && s.timeline.length > 0 && (
        <details>
          <summary>Tracking history</summary>
          <ol>{[...s.timeline].reverse().map((e, i) => <li key={i}>{formatDate(e.at, true)}: {e.detail ?? trackingLabel(e.status)}{e.location ? `, ${e.location}` : ""}</li>)}</ol>
        </details>
      )}
    </section>
  );
}

function ActionForms({ g, idem, error }: { g: OrderGroupView; idem: string; error: { intent: string; seller: string; fieldErrors: Record<string, string>; message: string | null } | undefined }) {
  const busy = useNavigation().state !== "idle";
  const mine = error && error.seller === g.sellerOrderNumber ? error : undefined;
  const seller = g.sellerOrderNumber ?? "";
  return (
    <div className="stack">
      {mine && <ErrorSummary submission={mine} message={mine.message} errors={mine.fieldErrors} />}
      {g.canConfirmDelivery && (
        <Form method="post">
          <CsrfField /><input type="hidden" name="sellerOrderNumber" value={seller} /><input type="hidden" name="intent" value="confirm" />
          <Button type="submit" variant="secondary" disabled={busy}>I received this order</Button>
        </Form>
      )}
      {g.canCancel && (
        <details open={mine?.intent === "cancel"}>
          <summary>Cancel this order</summary>
          <Form method="post" className="stack" noValidate>
            <CsrfField /><input type="hidden" name="sellerOrderNumber" value={seller} /><input type="hidden" name="intent" value="cancel" />
            <Select label="Why do you want to cancel?" name="reason" defaultValue="" error={mine?.intent === "cancel" ? mine.fieldErrors.reason : undefined}>
              <option value="" disabled>Choose a reason</option>
              {Object.entries(CANCEL_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <div className="field"><label htmlFor={`note-${seller}`}>Note for the seller (optional)</label><textarea id={`note-${seller}`} className="input" name="note" maxLength={500} rows={3} /></div>
            <p className="muted">The seller decides whether it can still be cancelled. If it ships first, you can return it instead.</p>
            <Button type="submit" variant="danger" disabled={busy}>Request cancellation</Button>
          </Form>
        </details>
      )}
      {g.canReturn && (
        <details open={mine?.intent === "return"}>
          <summary>Return items</summary>
          <Form method="post" className="stack" noValidate>
            <CsrfField /><input type="hidden" name="sellerOrderNumber" value={seller} /><input type="hidden" name="intent" value="return" /><input type="hidden" name="idem" value={`${idem}-${seller}`.slice(0, 64)} />
            <fieldset className="stack">
              <legend>Which items, and how many?</legend>
              {g.lines.filter((l) => l.returnableQty > 0).map((l) => (
                <div key={l.lineId} className="field">
                  <label htmlFor={`qty-${l.lineId}`}>{l.title}{l.variantName ? ` (${l.variantName})` : ""}: how many (up to {l.returnableQty})</label>
                  <input id={`qty-${l.lineId}`} className="input" type="number" inputMode="numeric" name={`qty:${l.lineId}`} min={0} max={l.returnableQty} defaultValue={0} />
                </div>
              ))}
              {mine?.intent === "return" && mine.fieldErrors.lines && <span className="field-error">{mine.fieldErrors.lines}</span>}
            </fieldset>
            <Select label="Reason" name="reason" defaultValue="" error={mine?.intent === "return" ? mine.fieldErrors.reason : undefined}>
              <option value="" disabled>Choose a reason</option>
              {Object.entries(RETURN_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <div className="field"><label htmlFor={`comment-${seller}`}>Anything the seller should know (optional)</label><textarea id={`comment-${seller}`} className="input" name="comment" maxLength={1000} rows={3} /></div>
            <Button type="submit" disabled={busy}>Request return</Button>
          </Form>
        </details>
      )}
    </div>
  );
}

export default function OrderPage({ loaderData }: Route.ComponentProps) {
  const { order, idem, done } = loaderData;
  const a = useActionData<typeof action>();
  const money = (c: number) => formatMoney(c, order.currency);
  const notice = done === "cancel" ? "Your cancellation request was sent to the seller." : done === "return" ? "Your return request was sent to the seller." : done === "confirm" ? "Thank you. We told the seller you received it." : done === "label" ? "Your return label link was refreshed." : null;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <Breadcrumb items={[{ label: "Orders", to: "/account/orders" }, { label: `Order ${order.number}` }]} />
      <h2>Order {order.number}</h2>
      <p className="muted">Placed {formatDate(order.createdAt)}</p>
      {notice && <FormMessage kind="ok">{notice}</FormMessage>}
      {order.groups.map((g) => (
        <Card key={g.sellerOrderNumber ?? g.sellerName} className="stack" id={`seller-${g.sellerOrderNumber ?? ""}`} aria-labelledby={`h-${g.sellerOrderNumber}`}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 id={`h-${g.sellerOrderNumber}`} style={{ margin: 0 }}>{g.sellerName}{g.sellerOrderNumber ? <span className="muted"> · {g.sellerOrderNumber}</span> : null}</h3>
            <Badge tone={statusTone(g.status)}>{statusLabel(g.status)}</Badge>
          </div>
          <Steps status={g.status} />
          {g.oversold && <FormMessage kind="error">The seller is short of stock for part of this order and will contact you.</FormMessage>}
          {g.deliveryAttemptsFailed > 0 && g.status !== "delivered" && <FormMessage kind="error">A delivery attempt did not work{g.lastAttemptFailedReason && ATTEMPT_REASON[g.lastAttemptFailedReason] ? `: ${ATTEMPT_REASON[g.lastAttemptFailedReason]}` : ""}. The seller will try again or contact you.</FormMessage>}
          <table className="table table-fit">
            <caption className="sr-only">Items from {g.sellerName}</caption>
            <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Price</th></tr></thead>
            <tbody>
              {g.lines.map((l) => (
                <tr key={l.lineId}>
                  <td>{l.title}{l.variantName ? <span className="muted"> ({l.variantName})</span> : null}{l.shippedQty > 0 && <div className="muted">{l.shippedQty} shipped{l.returnedQty > 0 ? `, ${l.returnedQty} returned` : ""}{l.refundedQty > 0 ? `, ${l.refundedQty} refunded` : ""}{l.cancelledQty > 0 ? `, ${l.cancelledQty} cancelled` : ""}</div>}</td>
                  <td>{l.quantity}</td>
                  <td>{money(l.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Items {money(g.itemsCents)} · Shipping {money(g.shippingCents)} · Tax {money(g.taxCents)} · <strong>Total {money(g.totalCents)}</strong></p>
          {g.shipments.filter((s) => !s.voided).map((s) => <Tracking key={s.id} number={order.number} s={s} />)}
          {g.cancelRequest && <p>Cancellation request: <Badge>{CANCEL_STATUS[g.cancelRequest.status] ?? "In progress"}</Badge>{g.cancelRequest.decisionNote ? <> <span className="muted">“{g.cancelRequest.decisionNote}”</span></> : null}</p>}
          {g.returns.map((r) => (
            <section key={r.returnId} aria-label="Return" className="stack">
              <h4 style={{ margin: 0 }}>Return requested {formatDate(r.createdAt)} <Badge tone={r.status === "rejected" || r.status === "failed" ? "err" : r.status === "approved" || r.status === "received" || r.status === "refunded" ? "ok" : "neutral"}>{RETURN_STATUS[r.status] ?? "In progress"}</Badge></h4>
              {r.decisionNote && <p className="muted">“{r.decisionNote}”</p>}
              {r.label && safeHttps(r.label.url) && <p><a href={safeHttps(r.label.url)!} rel="noopener noreferrer" target="_blank">Print your return label</a>{r.label.carrier ? ` (${r.label.carrier})` : ""} <span className="muted">· link valid until {formatDate(r.label.expiresAt, true)}</span></p>}
              {r.canRefreshLabel && !r.label && (
                <Form method="post">
                  <CsrfField /><input type="hidden" name="sellerOrderNumber" value={g.sellerOrderNumber ?? ""} /><input type="hidden" name="intent" value="label" /><input type="hidden" name="returnId" value={r.returnId} />
                  <Button type="submit" variant="secondary">Get a new return label link</Button>
                </Form>
              )}
            </section>
          ))}
          {g.refunds.length > 0 && (
            <section aria-label="Refunds" className="stack">
              <h4 style={{ margin: 0 }}>Refunds</h4>
              <ul>{g.refunds.map((r, i) => <li key={i}>{money(r.amountCents + r.shippingCents)} · {REFUND_STATUS[r.status] ?? r.status} · {formatDate(r.createdAt)}</li>)}</ul>
              <p className="muted">Refunds go back to your original payment method.</p>
            </section>
          )}
          <p><Link className="btn btn-secondary" to={`/account/messages/new?order=${encodeURIComponent(order.number)}&seller=${encodeURIComponent(g.sellerOrderNumber ?? "")}`}>Message {g.sellerName}</Link></p>
          <ActionForms g={g} idem={idem} error={a} />
        </Card>
      ))}
      <Card className="stack">
        <h3 style={{ margin: 0 }}>Delivery address</h3>
        <address style={{ fontStyle: "normal" }}>
          {order.shipTo.name}<br />{order.shipTo.line1}<br />{order.shipTo.line2 && <>{order.shipTo.line2}<br /></>}
          {order.shipTo.city}{order.shipTo.region ? `, ${order.shipTo.region}` : ""} {order.shipTo.postalCode}<br />{order.shipTo.country}
        </address>
        {order.giftMessage && <p className="muted">Gift message: {order.giftMessage}</p>}
        <p><strong>Order total {money(order.totalCents)}</strong>{order.refundedCents > 0 ? <span className="muted"> · {money(order.refundedCents)} refunded</span> : null}</p>
      </Card>
    </div>
  );
}
