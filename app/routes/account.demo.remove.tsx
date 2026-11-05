import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.demo.remove";
import { AccountNav } from "~/components/AccountNav";
import { CsrfField } from "~/components/Shell";
import { Card } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { demoMode } from "~/lib/demo.server";

/**
 * The confirmation before demo data is removed (M9). A page, not a pop-up: it works without a script, has its own address a test can open, and "Cancel" is a plain link
 * back. Removal only ever touches rows marked as demo for this account (the API enforces it); this page says so.
 */
export function meta() {
  return [{ title: "Remove demo data | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: privateHeaders });

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  if (!(await demoMode(ctx)).buttons) throw NOT_FOUND();
  try {
    const status = await api.demoStatus(ctx);
    if (!status.hasDemoData) throw redirect("/account/demo", { headers: privateHeaders });   // nothing to remove
    return { counts: status.counts };
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
    await api.demoRemove(ctx);
    return redirect("/account/demo?done=removed", { headers: privateHeaders });
  } catch (e) {
    return failAccount(e, request);
  }
}

export default function RemoveDemo({ loaderData }: Route.ComponentProps) {
  const { counts } = loaderData;
  const busy = useNavigation().state !== "idle";
  return (
    <div className="stack">
      <h1>Remove demo data?</h1>
      <AccountNav />
      <Card className="stack">
        <p>This removes the demo data added to your account: {counts.orders} orders, {counts.bookings} bookings, {counts.threads} message threads, {counts.notifications} notifications, {counts.addresses} address and the demo cart. Anything that is really yours stays exactly as it is.</p>
        <div className="row">
          <Form method="post">
            <CsrfField />
            <Button type="submit" variant="primary" disabled={busy}>{busy ? "Removing…" : "Remove demo data"}</Button>
          </Form>
          <Link to="/account/demo" className="btn btn-secondary">Cancel</Link>
        </div>
      </Card>
    </div>
  );
}
