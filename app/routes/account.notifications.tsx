import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/account.notifications";
import { AccountNav } from "~/components/AccountNav";
import { CsrfField } from "~/components/Shell";
import { Badge, Card, EmptyState } from "~/components/ui/display";
import { Button, LinkButton } from "~/components/ui/form";
import { api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { notificationLink, notificationText } from "~/lib/notifications";
import { formatDate } from "~/lib/orders";
import { isSafeId } from "~/lib/passkey.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Notifications | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const q = new URL(request.url).searchParams;
  const before = q.get("before"), beforeId = q.get("beforeId");
  try {
    return await api.notifications(ctx, before && beforeId ? { before, beforeId } : undefined);
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const intent = str(form, "intent");
  try {
    if (intent === "read-all") await api.markAllNotificationsRead(ctx);
    else if (intent === "open") {
      // Opening a notification marks it read, then goes to what it is about (our own pages only).
      const id = str(form, "id"), to = str(form, "to");
      if (!isSafeId(id)) throw new Response("Bad request", { status: 400, headers: privateHeaders });
      await api.markNotificationRead(ctx, id);
      if (/^\/account\/(orders|messages|bookings)(\/[A-Za-z0-9_%-]+)?$/.test(to)) return redirect(to, { headers: privateHeaders });
    } else throw new Response("Bad request", { status: 400, headers: privateHeaders });
  } catch (e) {
    return failAccount(e, request);
  }
  return redirect("/account/notifications", { headers: privateHeaders });
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { notifications, unreadCount, next } = loaderData;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <div className="row u-justify-content-space-between-margin-bottom-var-s2">
        <h2 className="u-margin-0">Notifications {unreadCount > 0 && <Badge tone="gold">{unreadCount} unread</Badge>}</h2>
        <div className="row">
          <LinkButton variant="secondary" to="/account/notifications/preferences">Email settings</LinkButton>
          {unreadCount > 0 && (
            <Form method="post"><CsrfField /><input type="hidden" name="intent" value="read-all" /><Button type="submit" variant="secondary">Mark all as read</Button></Form>
          )}
        </div>
      </div>
      {notifications.length === 0 ? (
        <EmptyState title="Nothing new">Updates about your orders, deliveries, refunds and messages appear here.</EmptyState>
      ) : (
        <ul className="stack u-list-style-none-padding-0">
          {notifications.map((n) => {
            const link = notificationLink(n);
            return (
              <li key={n.id}>
                <Card className="row u-justify-content-space-between">
                  <div>
                    <p className={n.read ? "u-m0 u-fw-400" : "u-m0 u-fw-700"}>
                      {!n.read && <span className="sr-only">Unread: </span>}{notificationText(n)}
                    </p>
                    <span className="muted">{formatDate(n.createdAt, true)}</span>
                  </div>
                  <Form method="post">
                    <CsrfField /><input type="hidden" name="intent" value="open" /><input type="hidden" name="id" value={n.id} /><input type="hidden" name="to" value={link ?? ""} />
                    <Button type="submit" variant={n.read ? "ghost" : "secondary"}>{link ? (n.read ? "View" : "View and mark as read") : "Mark as read"}</Button>
                  </Form>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
      {next && <Link className="btn btn-secondary" to={`/account/notifications?before=${encodeURIComponent(next.before)}&beforeId=${encodeURIComponent(next.beforeId)}`}>Older notifications</Link>}
    </div>
  );
}
