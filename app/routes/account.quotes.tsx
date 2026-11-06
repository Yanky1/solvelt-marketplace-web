import { Link } from "react-router";
import type { Route } from "./+types/account.quotes";
import { AccountNav } from "~/components/AccountNav";
import { Badge, Card, EmptyState, formatMoney } from "~/components/ui/display";
import { LinkButton } from "~/components/ui/form";
import { api } from "~/lib/api-client.server";
import { failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { badgeTone, quoteStatus } from "~/lib/bookings";
import { formatDate } from "~/lib/orders";

export function meta() {
  return [{ title: "Your quotes | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    return { quotes: (await api.quoteRequests(ctx)).quotes };
  } catch (e) {
    return failAccount(e, request);
  }
}

export default function Quotes({ loaderData }: Route.ComponentProps) {
  const { quotes } = loaderData;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Quote requests</h2>
      {quotes.length === 0 ? (
        <EmptyState title="No quote requests yet" action={<LinkButton to="/search?type=service">Find a service</LinkButton>}>Some services are priced per job: ask for a quote and it appears here.</EmptyState>
      ) : (
        <ul className="stack u-list-style-none-padding-0" data-testid="quote-list">
          {quotes.map((q) => {
            const st = quoteStatus(q.status);
            return (
              <li key={q.id}>
                <Card className="stack">
                  <div className="row u-justify-content-space-between">
                    <h3 className="u-margin-0"><Link to={`/quotes/${encodeURIComponent(q.id)}`}>Request of {formatDate(q.createdAt)}</Link></h3>
                    <Badge tone={badgeTone(st.tone)}>{st.label}</Badge>
                  </div>
                  <p className="muted u-margin-0">{q.details.slice(0, 120)}{q.details.length > 120 ? "…" : ""}</p>
                  {q.priceCents != null && <strong>{formatMoney(q.priceCents, q.currency)}</strong>}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
