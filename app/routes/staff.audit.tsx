import { Form, Link } from "react-router";
import type { Route } from "./+types/staff.audit";
import { when, TableWrap } from "~/components/StaffUi";
import { EmptyState } from "~/components/ui/display";
import { Button, Input } from "~/components/ui/form";
import { failStaff, requirePermission, requireStaff, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi } from "~/lib/staff-api.server";

export function meta() {
  return [{ title: "Audit log | Solvelt staff" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

/** Read only: who, what, why, when. Ids only; the API never stores a buyer's name, address or email here. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx, me } = await requireStaff(request, context);
  requirePermission(me, "audit.view");
  const u = new URL(request.url);
  const action = (u.searchParams.get("action") ?? "").trim().slice(0, 60);
  const before = u.searchParams.get("before") ?? undefined;
  try {
    const r = await staffApi.audit(ctx, { ...(action ? { action } : {}), ...(before ? { before } : {}) });
    return { ...r, action };
  } catch (e) { return failStaff(e, request); }
}

export default function StaffAudit({ loaderData: d }: Route.ComponentProps) {
  return (
    <div className="stack">
      <h2>Audit log</h2>
      <Form method="get" className="row u-align-items-flex-end-flex-wrap-wrap">
        <Input label="Action" name="action" defaultValue={d.action} hint="For example buyer.reveal" maxLength={60} />
        <Button type="submit" variant="secondary">Filter</Button>
      </Form>
      {d.entries.length === 0 ? <EmptyState title="No entries">Nothing matches.</EmptyState> : (
        <TableWrap label="Newest first"><table className="table"><caption className="muted">Newest first</caption>
          <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">On</th><th scope="col">Why</th></tr></thead>
          <tbody>{d.entries.map((e) => (
            <tr key={e.id}><th scope="row">{when(e.at)}</th><td>{e.actorRole}{e.actorId ? <div className="muted"><code>{e.actorId.slice(0, 8)}</code></div> : null}</td><td>{e.action}</td><td>{e.targetType ? <code>{e.targetType} {e.targetId?.slice(0, 13)}</code> : "—"}</td><td>{e.reason}</td></tr>
          ))}</tbody>
        </table></TableWrap>
      )}
      {d.next && <p><Link to={`/staff/audit?${d.action ? `action=${encodeURIComponent(d.action)}&` : ""}before=${encodeURIComponent(d.next)}`}>Older</Link></p>}
    </div>
  );
}
