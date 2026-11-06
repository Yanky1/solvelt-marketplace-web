import { Link } from "react-router";
import type { Route } from "./+types/account.questions";
import { AccountNav } from "~/components/AccountNav";
import { Badge, Card, EmptyState } from "~/components/ui/display";
import { api } from "~/lib/api-client.server";
import { failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { listingPath } from "~/lib/urls";

export function meta() {
  return [{ title: "Your questions | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    return { questions: await api.myQuestions(ctx) };
  } catch (e) {
    return failAccount(e, request);
  }
}

const STATE: Record<string, string> = { sending: "Sending to the seller", sent: "Sent to the seller", rejected: "Could not be sent" };

export default function MyQuestions({ loaderData }: Route.ComponentProps) {
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Your questions</h2>
      <p className="muted">Questions you asked sellers from a product page. When a seller answers, the answer appears on that product's page.</p>
      {loaderData.questions.length === 0 ? (
        <EmptyState title="No questions yet">Use "Ask the seller" on a product page.</EmptyState>
      ) : (
        <ul className="stack u-list-style-none-padding-0">
          {loaderData.questions.map((q) => (
            <li key={q.id}>
              <Card className="stack">
                <strong>{q.listing ? <Link to={listingPath(q.listing.slug)}>{q.listing.title}</Link> : "An item that is no longer listed"}</strong>
                <p className="u-white-space-pre-line-margin-0">{q.text}</p>
                <Badge tone={q.status === "rejected" ? "err" : q.status === "sent" ? "ok" : "neutral"}>{STATE[q.status] ?? q.status}</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
