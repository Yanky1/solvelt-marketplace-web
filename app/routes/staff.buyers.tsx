import { useState } from "react";
import { Form, useActionData, useFetcher, useNavigation } from "react-router";
import type { Route } from "./+types/staff.buyers";
import { ReasonField, StaffCsrf, money, when, TableWrap } from "~/components/StaffUi";
import { FormMessage } from "~/components/AuthForm";
import { Badge, Card } from "~/components/ui/display";
import { Button, Checkbox, Input, Select } from "~/components/ui/form";
import { apiMessage, assertStaffCsrf, can, failStaff, requirePermission, requireStaff, staffForm, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi, type StaffBuyer, type StaffBuyerOrder, type StaffRevealed } from "~/lib/staff-api.server";

export function meta() {
  return [{ title: "Buyers | Solvelt staff" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { me } = await requireStaff(request, context);
  requirePermission(me, "buyers.view");
  return { canReveal: can(me, "buyers.reveal"), canLock: can(me, "buyers.lock"), canSignOut: can(me, "buyers.sign_out"), canOrders: can(me, "orders.view") };
}

type Result =
  | { kind: "found"; buyer: StaffBuyer }
  | { kind: "revealed"; data: StaffRevealed }
  | { kind: "locked"; locked: boolean }
  | { kind: "signedOut" }
  | { kind: "orders"; orders: StaffBuyerOrder[] }
  | { kind: "error"; message: string };

const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

/** Buyers are looked up ONE at a time (by exact email, order number or account id) and shown masked; the real values need the break-glass reveal (passkey check, reason, audited). */
export async function action({ request, context }: Route.ActionArgs): Promise<ReturnType<typeof staffForm<Result>>> {
  const form = await request.formData();
  assertStaffCsrf(request, form);
  const { ctx, me } = await requireStaff(request, context);
  const intent = text(form, "intent"), reason = text(form, "reason"), id = text(form, "id");
  try {
    switch (intent) {
      case "find": {
        requirePermission(me, "buyers.view");
        const key = text(form, "key");
        if (key !== "email" && key !== "order" && key !== "id") return staffForm<Result>({ kind: "error", message: "Choose what you are searching by." }, 400);
        return staffForm<Result>({ kind: "found", buyer: await staffApi.findBuyer(ctx, key, text(form, "value"), reason) });
      }
      case "reveal": {
        requirePermission(me, "buyers.reveal");
        const fields = form.getAll("fields").map(String);
        return staffForm<Result>({ kind: "revealed", data: await staffApi.reveal(ctx, id, fields, reason) });
      }
      case "lock": case "unlock":
        requirePermission(me, "buyers.lock");
        await staffApi.lock(ctx, id, intent === "lock", reason);
        return staffForm<Result>({ kind: "locked", locked: intent === "lock" });
      case "signout":
        requirePermission(me, "buyers.sign_out");
        await staffApi.signOutBuyer(ctx, id, reason);
        return staffForm<Result>({ kind: "signedOut" });
      case "orders":
        requirePermission(me, "orders.view");
        return staffForm<Result>({ kind: "orders", orders: await staffApi.buyerOrders(ctx, id, reason) });
      default:
        throw new Response("Bad request", { status: 400, headers: staffHeaders });
    }
  } catch (e) {
    if (e instanceof Response) throw e;
    const m = apiMessage(e);
    if (m) return staffForm<Result>({ kind: "error", message: m }, 400);
    if (e && typeof e === "object" && "status" in e && (e as { status: number }).status === 404 && intent === "find") return staffForm<Result>({ kind: "error", message: "No buyer found." }, 404);
    return failStaff(e, request);
  }
}

function Panel({ buyer, perms }: { buyer: StaffBuyer; perms: { canReveal: boolean; canLock: boolean; canSignOut: boolean; canOrders: boolean } }) {
  const lock = useFetcher<Result>(), reveal = useFetcher<Result>(), out = useFetcher<Result>(), orders = useFetcher<Result>();
  const locked = lock.data?.kind === "locked" ? lock.data.locked : buyer.locked;
  const revealed = reveal.data?.kind === "revealed" ? reveal.data.data : null;
  const msg = [lock, reveal, out, orders].map((f) => (f.data?.kind === "error" ? f.data.message : null)).find(Boolean);
  return (
    <Card className="stack" data-testid="buyer-card">
      <div className="row u-justify-content-space-between-flex-wrap-wrap">
        <h2>{buyer.name}</h2>
        <div className="row">
          {locked && <Badge tone="err">Locked</Badge>}{buyer.deleted && <Badge>Deleted</Badge>}{buyer.demo && <Badge tone="gold">Demo</Badge>}{!buyer.emailVerified && <Badge>Not verified</Badge>}
        </div>
      </div>
      <dl className="stack u-margin-0">
        <div><dt className="muted">Email (masked)</dt><dd>{buyer.email ?? "—"}</dd></div>
        <div><dt className="muted">Account id</dt><dd><code>{buyer.id}</code></dd></div>
        <div><dt className="muted">Joined</dt><dd>{when(buyer.createdAt)}</dd></div>
        <div><dt className="muted">Passkeys / active sessions / addresses / orders</dt><dd>{buyer.passkeys} / {buyer.activeSessions} / {buyer.addresses} / {buyer.orders}</dd></div>
      </dl>
      {msg && <FormMessage kind="error">{msg}</FormMessage>}
      {out.data?.kind === "signedOut" && <FormMessage kind="ok">Every session of this buyer was ended.</FormMessage>}
      {perms.canLock && (
        <lock.Form method="post" className="stack">
          <StaffCsrf /><input type="hidden" name="id" value={buyer.id} /><input type="hidden" name="intent" value={locked ? "unlock" : "lock"} />
          <ReasonField id={`lock-${buyer.id}`} />
          <Button type="submit" variant={locked ? "secondary" : "primary"} disabled={lock.state !== "idle"}>{locked ? "Unlock this account" : "Lock this account"}</Button>
        </lock.Form>
      )}
      {perms.canSignOut && (
        <out.Form method="post" className="stack">
          <StaffCsrf /><input type="hidden" name="id" value={buyer.id} /><input type="hidden" name="intent" value="signout" />
          <ReasonField id={`out-${buyer.id}`} />
          <Button type="submit" variant="secondary" disabled={out.state !== "idle"}>Sign this buyer out everywhere</Button>
        </out.Form>
      )}
      {perms.canReveal && (
        <reveal.Form method="post" className="stack">
          <h3>Break-glass reveal</h3>
          <p className="muted">Shows the real values once, needs a fresh passkey check and is recorded.</p>
          <StaffCsrf /><input type="hidden" name="id" value={buyer.id} /><input type="hidden" name="intent" value="reveal" />
          <fieldset className="row u-flex-wrap-wrap-border-0-padding-0"><legend className="muted">Show</legend>
            {["email", "name", "phone", "addresses"].map((f) => <Checkbox key={f} name="fields" value={f} label={f} />)}
          </fieldset>
          <ReasonField id={`reveal-${buyer.id}`} />
          <Button type="submit" disabled={reveal.state !== "idle"}>Reveal</Button>
          {revealed && (
            <div role="status" data-testid="revealed" className="stack">
              {revealed.redacted && <FormMessage kind="ok">This account was erased: nothing is left to show.</FormMessage>}
              {revealed.email && <div>Email: {revealed.email}</div>}{revealed.name && <div>Name: {revealed.name}</div>}{revealed.phone && <div>Phone: {revealed.phone}</div>}
              {revealed.addresses?.map((a, i) => <div key={i}>{a.name}, {a.line1}{a.line2 ? `, ${a.line2}` : ""}, {a.city} {a.postalCode} {a.country}</div>)}
            </div>
          )}
        </reveal.Form>
      )}
      {perms.canOrders && (
        <orders.Form method="post" className="stack">
          <h3>Orders</h3>
          <StaffCsrf /><input type="hidden" name="id" value={buyer.id} /><input type="hidden" name="intent" value="orders" />
          <ReasonField id={`orders-${buyer.id}`} />
          <Button type="submit" variant="secondary" disabled={orders.state !== "idle"}>List their orders</Button>
          {orders.data?.kind === "orders" && (
            <TableWrap label="Last orders"><table className="table"><caption className="muted">Last orders</caption>
              <thead><tr><th scope="col">Order</th><th scope="col">Status</th><th scope="col">Total</th><th scope="col">Refunded</th><th scope="col">Placed</th></tr></thead>
              <tbody>{orders.data.orders.map((o) => <tr key={o.id}><th scope="row">{o.number}{o.demo ? " (demo)" : ""}</th><td>{o.status}</td><td>{money(o.totalCents)}</td><td>{money(o.refundedCents)}</td><td>{when(o.createdAt)}</td></tr>)}</tbody>
            </table></TableWrap>
          )}
        </orders.Form>
      )}
    </Card>
  );
}

export default function StaffBuyers({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>() as Result | undefined;
  const busy = useNavigation().state !== "idle";
  const [key, setKey] = useState("email");
  return (
    <div className="stack">
      <h2>Find a buyer</h2>
      <Card>
        <Form method="post" className="stack">
          <StaffCsrf /><input type="hidden" name="intent" value="find" />
          <Select label="Search by" name="key" value={key} onChange={(e) => setKey(e.target.value)}><option value="email">Exact email address</option><option value="order">Order number</option><option value="id">Account id</option></Select>
          <Input label="Value" name="value" required maxLength={254} autoComplete="off" />
          <ReasonField />
          <Button type="submit" disabled={busy}>Look up</Button>
        </Form>
      </Card>
      {a?.kind === "error" && <FormMessage kind="error">{a.message}</FormMessage>}
      {a?.kind === "found" && <Panel buyer={a.buyer} perms={loaderData} />}
    </div>
  );
}
