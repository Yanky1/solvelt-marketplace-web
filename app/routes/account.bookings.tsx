import { Link } from "react-router";
import type { Route } from "./+types/account.bookings";
import { AccountNav } from "~/components/AccountNav";
import { Badge, Card, EmptyState, formatMoney } from "~/components/ui/display";
import { LinkButton } from "~/components/ui/form";
import { api } from "~/lib/api-client.server";
import { failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { badgeTone, bookingStatus } from "~/lib/bookings";
import { formatDate } from "~/lib/orders";

export function meta() {
  return [{ title: "Your bookings | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    const { bookings } = await api.bookings(ctx);
    return { bookings };
  } catch (e) {
    return failAccount(e, request);
  }
}

export default function Bookings({ loaderData }: Route.ComponentProps) {
  const { bookings } = loaderData;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Bookings</h2>
      {bookings.length === 0 ? (
        <EmptyState title="No bookings yet" action={<LinkButton to="/search?type=service">Find a service</LinkButton>}>When you book a service it appears here, with its time and status.</EmptyState>
      ) : (
        <ul className="stack u-list-style-none-padding-0" data-testid="booking-list">
          {bookings.map((b) => {
            const st = bookingStatus(b.status);
            return (
              <li key={b.id}>
                <Card className="stack">
                  <div className="row u-justify-content-space-between">
                    <h3 className="u-margin-0"><Link to={`/bookings/${encodeURIComponent(b.id)}`}>{b.number ? `Booking ${b.number}` : "Booking"}</Link></h3>
                    <Badge tone={badgeTone(st.tone)}>{st.label}</Badge>
                  </div>
                  <div className="row u-justify-content-space-between">
                    <span>{b.startAt ? formatDate(b.startAt, true) : "Time to be set"}</span>
                    <strong>{formatMoney(b.totalCents, b.currency)}</strong>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
