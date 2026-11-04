import { Link } from "react-router";
import type { Route } from "./+types/account.messages";
import { AccountNav } from "~/components/AccountNav";
import { Badge, Card, EmptyState } from "~/components/ui/display";
import { api } from "~/lib/api-client.server";
import { failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { formatDate } from "~/lib/orders";

export function meta() {
  return [{ title: "Messages | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const q = new URL(request.url).searchParams;
  const before = q.get("before"), beforeId = q.get("beforeId");
  try {
    return await api.threads(ctx, before && beforeId ? { before, beforeId } : undefined);
  } catch (e) {
    return failAccount(e, request);
  }
}

export default function Messages({ loaderData }: Route.ComponentProps) {
  const { threads, unreadCount, next } = loaderData;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Messages {unreadCount > 0 && <Badge tone="gold">{unreadCount} unread</Badge>}</h2>
      {threads.length === 0 ? (
        <EmptyState title="No messages yet">Write to a seller from an order, or ask a question on a product page. Replies appear here.</EmptyState>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0 }}>
          {threads.map((t) => (
            <li key={t.id}>
              <Card className="stack">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h3 style={{ margin: 0, fontWeight: t.unreadCount > 0 ? 700 : 600 }}>
                    <Link to={`/account/messages/${encodeURIComponent(t.id)}`}>{t.sellerName ?? "Seller"}: {t.subject}</Link>
                    {t.unreadCount > 0 && <span className="sr-only"> ({t.unreadCount} unread)</span>}
                  </h3>
                  <span className="muted">{formatDate(t.lastMessageAt)}</span>
                </div>
                {t.preview && <p className="muted" style={{ margin: 0 }}>{t.preview}</p>}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {next && <Link className="btn btn-secondary" to={`/account/messages?before=${encodeURIComponent(next.before)}&beforeId=${encodeURIComponent(next.beforeId)}`}>Older conversations</Link>}
    </div>
  );
}
