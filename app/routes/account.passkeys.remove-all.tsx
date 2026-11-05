import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/account.passkeys.remove-all";
import { AccountNav } from "~/components/AccountNav";
import { ErrorSummary } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Card } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { hasRecentAuth } from "~/lib/session.server";

/**
 * "Remove all passkeys" (M1-85): a confirmation page, because it takes away every passkey at once. It needs a recent sign-in like removing one, and an account with no
 * password keeps its passkeys (they are its only way in). An API that does not have the bulk route yet (404 or 405) gets an honest message, not a broken page.
 */
export function meta() {
  return [{ title: "Remove all passkeys | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const BACK = "/account/passkeys";
const CONFIRM = `/account/confirm?next=${encodeURIComponent("/account/passkeys/remove-all")}`;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    const passkeys = await api.passkeys(ctx);
    if (passkeys.length === 0) throw redirect(BACK, { headers: privateHeaders });   // nothing to remove
    return { count: passkeys.length };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const cfg = getConfig();
  if (!hasRecentAuth(session, Date.now() / 1000, cfg.reauthWindowSeconds)) return redirect(CONFIRM, { headers: privateHeaders });
  try {
    await api.deleteAllPasskeys(ctx);
    return redirect(`${BACK}?done=all-removed`, { headers: privateHeaders });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403) return redirect(CONFIRM, { headers: privateHeaders });                       // the API's own clock says "sign in again"
      if (e.status === 409 && e.code === "no_passkeys") return redirect(BACK, { headers: privateHeaders });
      if (e.status === 409 && e.code === "last_sign_in_method") return formError({ message: "These passkeys are the only way you can sign in, so they stay. Set a password first, then remove them." }, 409);
      if ((e.status === 404 || e.status === 405)) return formError({ message: "Removing all passkeys at once is not available yet. You can remove them one at a time on the passkeys page." }, 501);
      if (e.status !== 401) return formError({ message: "We could not remove your passkeys. Please try again." }, 503);
    }
    return failAccount(e, request);
  }
}

export default function RemoveAllPasskeys({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <div className="stack">
      <h1>Remove all passkeys?</h1>
      <AccountNav />
      <Card className="stack">
        <p>This removes all {loaderData.count} of your passkeys from your account. You will sign in with your password instead. We send you an email to say it happened.</p>
        <ErrorSummary submission={a} message={a?.message} />
        <div className="row">
          <Form method="post">
            <CsrfField />
            <Button type="submit" disabled={busy}>{busy ? "Removing…" : "Remove all passkeys"}</Button>
          </Form>
          <Link to={BACK} className="btn btn-secondary">Cancel</Link>
        </div>
      </Card>
    </div>
  );
}
