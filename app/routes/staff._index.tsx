import { Link } from "react-router";
import type { Route } from "./+types/staff._index";
import { NAV } from "~/components/StaffUi";
import { Card } from "~/components/ui/display";
import { can, requireStaff, staffHeaders } from "~/lib/staff-auth.server";
import { staffApi } from "~/lib/staff-api.server";

export function meta() {
  return [{ title: "Staff | Solvelt" }, { name: "robots", content: "noindex, nofollow" }];
}
export function headers() {
  return staffHeaders;
}

/** The start page: what this role can open, and the numbers somebody should look at (dead outbox messages, parked events, stuck orders). */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx, me } = await requireStaff(request, context);
  const [outbox, dead, ingests] = await Promise.all([
    can(me, "outbox.view") ? staffApi.outbox(ctx, { status: "dead" }).catch(() => null) : null,
    can(me, "deadletters.view") ? staffApi.deadLetters(ctx).catch(() => null) : null,
    can(me, "ingests.view") ? staffApi.ingests(ctx).catch(() => null) : null,
  ]);
  return { me, deadOutbox: outbox?.counts.dead ?? null, parked: dead?.counts["parked"] ?? null, stuck: ingests?.orders.length ?? null };
}

export default function StaffHome({ loaderData: d }: Route.ComponentProps) {
  const tiles: { label: string; value: number | null; to: string }[] = [
    { label: "Orders the portal has not taken", value: d.stuck, to: "/staff/queues?tab=ingests" },
    { label: "Dead outbox messages", value: d.deadOutbox, to: "/staff/queues?tab=outbox" },
    { label: "Parked portal events", value: d.parked, to: "/staff/queues?tab=dead-letters" },
  ];
  return (
    <div className="stack">
      <p>Signed in as <strong>{d.me.displayName}</strong> ({d.me.role}). Every action here is recorded with who, what, why and when.</p>
      <div className="row u-flex-wrap-wrap-gap-var-s2">
        {tiles.filter((t) => t.value !== null).map((t) => (
          <Card key={t.label}><strong>{t.value}</strong><div><Link to={t.to} className="btn btn-ghost u-min-width-200px u-font-size-var-fs-xl-1-75rem">{t.label}</Link></div></Card>
        ))}
      </div>
      <Card className="stack"><h2>Open</h2>
        <div className="row u-flex-wrap-wrap">{NAV.filter((n) => d.me.permissions.includes(n.permission)).map((n) => <Link key={n.to} to={n.to} className="btn btn-secondary">{n.label}</Link>)}</div>
      </Card>
    </div>
  );
}
