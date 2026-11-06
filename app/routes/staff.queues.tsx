import { Link, useFetcher, useSearchParams } from "react-router";
import type { Route } from "./+types/staff.queues";
import { ReasonField, StaffCsrf, money, when, TableWrap } from "~/components/StaffUi";
import { FormMessage } from "~/components/AuthForm";
import { Badge, EmptyState } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { apiMessage, assertStaffCsrf, can, failStaff, requirePermission, requireStaff, staffForm, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi, type StaffBookingConfirm, type StaffIngest, type StaffOutbox, type StaffParked, type StaffStripeEvent } from "~/lib/staff-api.server";

export function meta() {
  return [{ title: "Queues | Solvelt staff" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

const TABS = [
  { id: "ingests", label: "Stuck orders", permission: "ingests.view" },
  { id: "outbox", label: "Outbox", permission: "outbox.view" },
  { id: "dead-letters", label: "Portal events", permission: "deadletters.view" },
  { id: "stripe", label: "Stripe failures", permission: "stripe.view" },
] as const;

type Data =
  | { tab: "ingests"; ingests: StaffIngest[]; after: number }
  | { tab: "outbox"; outbox: StaffOutbox; status: string }
  | { tab: "dead-letters"; parked: StaffParked[]; counts: Record<string, number>; bookingConfirms: StaffBookingConfirm[] }
  | { tab: "stripe"; events: StaffStripeEvent[]; total: number; next: string | null };

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx, me } = await requireStaff(request, context);
  const tabs = TABS.filter((t) => can(me, t.permission));
  if (tabs.length === 0) requirePermission(me, "outbox.view");
  const url = new URL(request.url);
  const tab = tabs.find((t) => t.id === url.searchParams.get("tab"))?.id ?? tabs[0]!.id;
  const retry = { ingests: can(me, "ingests.retry"), outbox: can(me, "outbox.retry"), "dead-letters": can(me, "deadletters.retry"), stripe: false };
  try {
    let data: Data;
    if (tab === "ingests") { const r = await staffApi.ingests(ctx); data = { tab, ingests: r.orders, after: r.stuckAfterMinutes }; }
    else if (tab === "outbox") { const status = ["pending", "delivered", "dead"].includes(url.searchParams.get("status") ?? "") ? url.searchParams.get("status")! : "dead"; data = { tab, outbox: await staffApi.outbox(ctx, { status, ...(url.searchParams.get("before") ? { before: url.searchParams.get("before")! } : {}) }), status }; }
    else if (tab === "dead-letters") { const r = await staffApi.deadLetters(ctx); data = { tab, parked: r.parked, counts: r.counts, bookingConfirms: r.bookingConfirms ?? [] }; }
    else { const r = await staffApi.stripeFailures(ctx, url.searchParams.get("before") ?? undefined); data = { tab: "stripe", events: r.events, total: r.total, next: r.next }; }
    return { tabs: tabs.map((t) => ({ id: t.id, label: t.label })), data, canRetry: retry[tab], canRetryOutbox: can(me, "outbox.retry") };
  } catch (e) {
    return failStaff(e, request);
  }
}

type Result = { kind: "retried"; replayed?: number } | { kind: "error"; message: string };

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertStaffCsrf(request, form);
  const { ctx, me } = await requireStaff(request, context);
  const kind = String(form.get("kind") ?? ""), id = String(form.get("id") ?? ""), reason = String(form.get("reason") ?? "").trim();
  try {
    if (kind === "ingest") { requirePermission(me, "ingests.retry"); await staffApi.retryIngest(ctx, id, reason); return staffForm<Result>({ kind: "retried" }); }
    if (kind === "outbox") { requirePermission(me, "outbox.retry"); await staffApi.retryOutbox(ctx, id, reason); return staffForm<Result>({ kind: "retried" }); }
    if (kind === "dead-letter") { requirePermission(me, "deadletters.retry"); const r = await staffApi.retryDeadLetter(ctx, id, reason); return staffForm<Result>({ kind: "retried", replayed: r.replayed }); }
    throw new Response("Bad request", { status: 400, headers: staffHeaders });
  } catch (e) {
    if (e instanceof Response) throw e;
    const m = apiMessage(e);
    if (m) return staffForm<Result>({ kind: "error", message: m }, 400);
    return failStaff(e, request);
  }
}

/** One retry button with its reason, folded away until wanted. The result stays after the list reloads (the fetcher is keyed by the row), so "Queued again." is not lost with the row's button. */
function RetryRow({ kind, id, label, retryable }: { kind: "ingest" | "outbox" | "dead-letter"; id: string; label: string; retryable: boolean }) {
  const f = useFetcher<Result>({ key: `${kind}-${id}` });
  if (f.data?.kind === "retried") return <FormMessage kind="ok">{f.data.replayed !== undefined ? `Replayed: ${f.data.replayed} event(s) applied.` : "Queued again."}</FormMessage>;
  if (!retryable) return <>—</>;
  return (
    <details>
      <summary>{label}</summary>
      <f.Form method="post" className="stack">
        <StaffCsrf /><input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={id} />
        <ReasonField id={`reason-${id}`} />
        {f.data?.kind === "error" && <FormMessage kind="error">{f.data.message}</FormMessage>}
        <Button type="submit" disabled={f.state !== "idle"}>Retry</Button>
      </f.Form>
    </details>
  );
}

export default function StaffQueues({ loaderData: { tabs, data, canRetry, canRetryOutbox } }: Route.ComponentProps) {
  const [params] = useSearchParams();
  void params;
  return (
    <div className="stack">
      <h2>Queues</h2>
      <nav aria-label="Queues" className="row u-flex-wrap-wrap">
        {tabs.map((t) => <Link key={t.id} to={`/staff/queues?tab=${t.id}`} className={`btn ${t.id === data.tab ? "btn-secondary" : "btn-ghost"}`} aria-current={t.id === data.tab ? "page" : undefined}>{t.label}</Link>)}
      </nav>
      {data.tab === "ingests" && (
        data.ingests.length === 0 ? <EmptyState title="Nothing stuck">Every paid order was taken by the portal within {data.after} minutes.</EmptyState> : (
          <TableWrap label="Data"><table className="table"><caption className="muted">Paid, not yet taken by the portal (after {data.after} minutes)</caption>
            <thead><tr><th scope="col">Order</th><th scope="col">Paid</th><th scope="col">Total</th><th scope="col">Message</th><th scope="col">Action</th></tr></thead>
            <tbody>{data.ingests.map((o) => (
              <tr key={o.id}><th scope="row">{o.number}{o.demo ? " (demo)" : ""}</th><td>{when(o.paidAt)}</td><td>{money(o.totalCents)}</td>
                <td>{o.message ? <>{o.message.status} · {o.message.attempts} tries{o.message.lastError ? ` · ${o.message.lastError}` : ""}</> : "none"}</td>
                <td>{canRetry ? <RetryRow kind="ingest" id={o.id} label="Retry…" retryable={o.retryable} /> : "—"}</td></tr>
            ))}</tbody>
          </table></TableWrap>
        )
      )}
      {data.tab === "outbox" && (
        <>
          <p className="muted">Pending {data.outbox.counts.pending} · delivered {data.outbox.counts.delivered} · dead {data.outbox.counts.dead}. Payloads are never shown.</p>
          <nav aria-label="Status" className="row">{["dead", "pending", "delivered"].map((s) => <Link key={s} to={`/staff/queues?tab=outbox&status=${s}`} className={`btn ${s === data.status ? "btn-secondary" : "btn-ghost"}`}>{s}</Link>)}</nav>
          {data.outbox.messages.length === 0 ? <EmptyState title="No messages">Nothing with this status.</EmptyState> : (
            <TableWrap label="Outbox, newest first"><table className="table"><caption className="muted">Outbox, newest first</caption>
              <thead><tr><th scope="col">Type</th><th scope="col">Status</th><th scope="col">Tries</th><th scope="col">Error</th><th scope="col">Created</th><th scope="col">Action</th></tr></thead>
              <tbody>{data.outbox.messages.map((m) => (
                <tr key={m.id}><th scope="row">{m.type}</th><td><Badge tone={m.status === "dead" ? "err" : m.status === "delivered" ? "ok" : "gold"}>{m.status}</Badge></td><td>{m.attempts}</td><td>{m.lastError ?? "—"}</td><td>{when(m.createdAt)}</td>
                  <td>{canRetry ? <RetryRow kind="outbox" id={m.id} label="Retry…" retryable={m.retryable} /> : "—"}</td></tr>
              ))}</tbody>
            </table></TableWrap>
          )}
          {data.outbox.next && <p><Link to={`/staff/queues?tab=outbox&status=${data.status}&before=${encodeURIComponent(data.outbox.next)}`}>Older</Link></p>}
        </>
      )}
      {data.tab === "dead-letters" && data.bookingConfirms.length > 0 && (
        <section className="stack" aria-labelledby="dead-confirms">
          <h3 id="dead-confirms">Dead booking confirms</h3>
          <p className="muted">The buyer paid, the portal was never told, and nobody has told the buyer. A person has to act.</p>
          <TableWrap label="Dead booking confirms, table"><table className="table"><caption className="muted">Newest first</caption>
            <thead><tr><th scope="col">Booking</th><th scope="col">Paid</th><th scope="col">Error</th><th scope="col">Action</th></tr></thead>
            <tbody>{data.bookingConfirms.map((c) => (
              <tr key={c.messageId}>
                <th scope="row">{c.bookingNumber ?? "unknown (payload purged)"}{c.demo ? " (demo)" : ""}<div className="muted">{c.bookingStatus ?? "—"}</div></th>
                <td>{c.amountCents !== null ? money(c.amountCents, c.currency ?? "USD") : "—"} <Badge tone={c.needsPerson ? "err" : "ok"}>{c.needsPerson ? "needs a person" : (c.paymentStatus ?? "—")}</Badge></td>
                <td>{c.lastError ?? "—"}</td>
                <td>
                  <details><summary>What to do</summary><ol>{c.steps.map((s) => <li key={s}>{s}</li>)}</ol></details>
                  {canRetryOutbox ? <RetryRow kind="outbox" id={c.messageId} label="Retry the confirm…" retryable={c.retryable} /> : null}
                </td>
              </tr>
            ))}</tbody>
          </table></TableWrap>
        </section>
      )}
      {data.tab === "dead-letters" && (
        data.parked.length === 0 ? <EmptyState title="Nothing parked">Every portal event was applied.</EmptyState> : (
          <TableWrap label="Portal events waiting for something we do not know yet (bodies are never shown)"><table className="table"><caption className="muted">Portal events waiting for something we do not know yet (bodies are never shown)</caption>
            <thead><tr><th scope="col">Event</th><th scope="col">About</th><th scope="col">Waiting</th><th scope="col">Note</th><th scope="col">Action</th></tr></thead>
            <tbody>{data.parked.map((p) => (
              <tr key={p.id}><th scope="row">{p.type}<div className="muted"><code>{p.id}</code></div></th><td>{p.aggregateType} {p.aggregateKey}</td><td>{p.ageHours} h</td><td>{p.note ?? "—"}</td>
                <td>{canRetry ? <RetryRow kind="dead-letter" id={p.id} label="Replay…" retryable={p.retryable} /> : "—"}</td></tr>
            ))}</tbody>
          </table></TableWrap>
        )
      )}
      {data.tab === "stripe" && (
        <>
          <p className="muted">{data.total} event(s) we could not match to an order, or that report a failure. Only ids and types are kept: resend from the Stripe dashboard if one needs another go.</p>
          {data.events.length === 0 ? <EmptyState title="No failures">Nothing to look at.</EmptyState> : (
            <TableWrap label="Stripe events, newest first"><table className="table"><caption className="muted">Stripe events, newest first</caption>
              <thead><tr><th scope="col">Type</th><th scope="col">Outcome</th><th scope="col">Object</th><th scope="col">Received</th><th scope="col">Event id</th></tr></thead>
              <tbody>{data.events.map((e) => <tr key={e.id}><th scope="row">{e.type}</th><td>{e.outcome}</td><td><code>{e.objectId ?? "—"}</code></td><td>{when(e.receivedAt)}</td><td><code>{e.id}</code></td></tr>)}</tbody>
            </table></TableWrap>
          )}
          {data.next && <p><Link to={`/staff/queues?tab=stripe&before=${encodeURIComponent(data.next)}`}>Older</Link></p>}
        </>
      )}
    </div>
  );
}
