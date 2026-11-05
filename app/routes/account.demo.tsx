import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.demo";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Card } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { api, type DemoCounts } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { demoMode } from "~/lib/demo.server";

/** Test mode only (M9): fill an account with demo data, see what is there, take it away (the confirm page). Answers 404 unless demo mode is on at the API and here. */
export function meta() {
  return [{ title: "Demo data | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: privateHeaders });
/** Only these keys select a message; nothing from the query string is ever shown. */
const NOTICES = { filled: "Demo data added. Have a look around: your orders, bookings, messages and notifications now have examples.", already: "Demo data is already there. Remove it first to start again.", removed: "Demo data removed. Anything that is yours is untouched." } as const;

const ROWS: [keyof DemoCounts, string][] = [["addresses", "Addresses"], ["carts", "Carts"], ["cartLines", "Cart items"], ["orders", "Orders"], ["bookings", "Bookings"], ["threads", "Message threads"], ["messages", "Messages"], ["notifications", "Notifications"]];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!(await demoMode(ctx)).buttons) throw NOT_FOUND();
  try {
    const status = await api.demoStatus(ctx);
    const key = new URL(request.url).searchParams.get("done");
    const notice: keyof typeof NOTICES | null = key === "filled" || key === "already" || key === "removed" ? key : null;
    return { status, notice };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  if (!(await demoMode(ctx)).buttons) throw NOT_FOUND();
  try {
    const r = await api.demoFill(ctx);
    return redirect(`/account/demo?done=${r.created ? "filled" : "already"}`, { headers: privateHeaders });
  } catch (e) {
    return failAccount(e, request);
  }
}

export default function Demo({ loaderData }: Route.ComponentProps) {
  const { status, notice } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="stack">
      <h1>Demo data</h1>
      <AccountNav />
      <Card className="stack">
        <h2>Test mode</h2>
        <p>This marketplace is in test mode. Add demo data to get a realistic account to click through: an address, a cart, past orders, bookings, a message thread and notifications. Nothing real is sent: no emails, payments or seller messages.</p>
        {notice && <FormMessage kind="ok">{NOTICES[notice]}</FormMessage>}
        <dl className="demo-counts" aria-label="What is in your account as demo data">
          {ROWS.map(([k, label]) => <div key={k}><dt>{label}</dt><dd>{status.counts[k]}</dd></div>)}
        </dl>
        <div className="row">
          {!status.hasDemoData && (
            <Form method="post">
              <CsrfField />
              <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Fill with demo data"}</Button>
            </Form>
          )}
          {status.hasDemoData && <Link to="/account/demo/remove" className="btn btn-secondary">Remove demo data</Link>}
          <Link to="/account/orders" className="btn btn-ghost">Your orders</Link>
        </div>
      </Card>
    </div>
  );
}
