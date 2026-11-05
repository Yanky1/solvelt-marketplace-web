import { Link, useLocation, useRouteLoaderData } from "react-router";
import { Input } from "~/components/ui/form";
import { formatMoney } from "~/components/ui/display";
import type { StaffMe } from "~/lib/staff-api.server";

/** What the staff layout route hands every staff page. */
export interface StaffLayoutData { csrf: string; me: StaffMe | null }

export const useStaffLayout = (): StaffLayoutData => useRouteLoaderData("routes/staff") as StaffLayoutData ?? { csrf: "", me: null };

/** The staff CSRF token (NOT the buyer's: the staff area has its own). */
export function StaffCsrf() {
  return <input type="hidden" name="csrf" value={useStaffLayout().csrf} />;
}

/** Every action that changes something or shows personal data asks WHY. The API refuses an email address or a long number in it. */
export function ReasonField({ error, id = "reason" }: { error?: string | undefined; id?: string }) {
  return <Input id={id} name="reason" label="Reason" hint="The ticket or order number and why. Never an email address, phone or card number." required minLength={5} maxLength={300} autoComplete="off" error={error} />;
}

export const NAV: { to: string; label: string; permission: string }[] = [
  { to: "/staff/buyers", label: "Buyers", permission: "buyers.view" },
  { to: "/staff/orders", label: "Orders", permission: "orders.view" },
  { to: "/staff/queues", label: "Queues", permission: "outbox.view" },
  { to: "/staff/accounts", label: "Staff accounts", permission: "staff.manage" },
  { to: "/staff/audit", label: "Audit log", permission: "audit.view" },
];

export function StaffNav({ me }: { me: StaffMe }) {
  const here = useLocation().pathname;
  return (
    <nav aria-label="Staff" className="row" style={{ flexWrap: "wrap", gap: "var(--s1)" }}>
      {NAV.filter((n) => me.permissions.includes(n.permission)).map((n) => (
        <Link key={n.to} to={n.to} className={`btn ${here.startsWith(n.to) ? "btn-secondary" : "btn-ghost"}`} aria-current={here.startsWith(n.to) ? "page" : undefined}>{n.label}</Link>
      ))}
    </nav>
  );
}

/** A data table that scrolls sideways inside its own keyboard-focusable region (a phone never gets a horizontal page scroll). */
export function TableWrap({ label, children }: { label: string; children: React.ReactNode }) {
  // A scrollable region must be reachable by keyboard (axe: scrollable-region-focusable), so this one element is focusable on purpose.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
  return <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

export const money = (cents: number, currency = "USD") => formatMoney(cents, currency);
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
