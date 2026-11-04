import { Link } from "react-router";
import type { Route } from "./+types/account.orders";
import { AccountNav } from "~/components/AccountNav";
import { Badge, Card, EmptyState, formatMoney } from "~/components/ui/display";
import { LinkButton } from "~/components/ui/form";
import { api } from "~/lib/api-client.server";
import { failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { formatDate, statusLabel, statusTone } from "~/lib/orders";

export function meta() {
  return [{ title: "Your orders | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const q = new URL(request.url).searchParams;
  const before = q.get("before"), beforeId = q.get("beforeId");
  try {
    return await api.orders(ctx, before && beforeId ? { before, beforeId } : undefined);
  } catch (e) {
    return failAccount(e, request);
  }
}

export default function Orders({ loaderData }: Route.ComponentProps) {
  const { orders, next } = loaderData;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Orders</h2>
      {orders.length === 0 ? (
        <EmptyState title="No orders yet" action={<LinkButton to="/">Start shopping</LinkButton>}>When you place an order it appears here, with tracking and returns.</EmptyState>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {orders.map((o) => (
            <li key={o.number}>
              <Card className="stack">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0 }}><Link to={`/account/orders/${encodeURIComponent(o.number)}`}>Order {o.number}</Link></h3>
                  <span className="muted">{formatDate(o.createdAt)}</span>
                </div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {o.groups.map((g) => (
                    <li key={g.sellerOrderNumber ?? g.sellerName} className="row" style={{ justifyContent: "space-between" }}>
                      <span>
                        {g.sellerName}
                        {g.firstItem && <span className="muted">: {g.firstItem}{g.itemCount > 1 ? ` and ${g.itemCount - 1} more` : ""}</span>}
                      </span>
                      <Badge tone={statusTone(g.status)}>{statusLabel(g.status)}</Badge>
                    </li>
                  ))}
                </ul>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>{formatMoney(o.totalCents, o.currency)}</strong>
                  {o.refundedCents > 0 && <span className="muted">{formatMoney(o.refundedCents, o.currency)} refunded</span>}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {next && <LinkButton variant="secondary" to={`/account/orders?before=${encodeURIComponent(next.before)}&beforeId=${encodeURIComponent(next.beforeId)}`}>Older orders</LinkButton>}
    </div>
  );
}
