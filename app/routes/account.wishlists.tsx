import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.wishlists";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Card, EmptyState } from "~/components/ui/display";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { NAME_MAX } from "~/lib/lists";

export function meta() {
  return [{ title: "Wishlists | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    return await api.wishlists(ctx);
  } catch (e) {
    return failAccount(e, request);
  }
}

/** Creating a list. Errors the buyer can fix are shown on the form; anything else is the usual account failure. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const name = String(form.get("name") ?? "").slice(0, NAME_MAX * 4);
  try {
    const created = await api.createWishlist(ctx, name);
    return redirect(created ? `/account/wishlists/${encodeURIComponent(created.id)}` : "/account/wishlists", { headers: privateHeaders });
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) return formError({ error: "You already have a list with that name." }, 409);
    if (e instanceof ApiError && e.status === 422) return formError({ error: e.fieldErrors?.name ?? (e.code === "too_many_lists" ? "You have reached the limit of lists. Delete one first." : "Check the name and try again.") }, 422);
    return failAccount(e, request);
  }
}

export default function Wishlists({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const error = actionData && "error" in actionData ? actionData.error : null;
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Wishlists</h2>
      <p className="muted">Save things for later. Lists are private unless you share one with a link. We tell you when something on a list drops in price or is back in stock.</p>
      <Form method="post" className="row u-align-items-flex-end-margin-bottom-var-s3" noValidate>
        <CsrfField />
        <label className="field u-flex-1-1-14rem">
          <span>New list</span>
          <input className="input" name="name" maxLength={NAME_MAX} required aria-invalid={error ? true : undefined} aria-describedby={error ? "wl-error" : undefined} autoComplete="off" />
        </label>
        <Button type="submit" disabled={busy}>Create list</Button>
      </Form>
      {error && <div id="wl-error"><FormMessage kind="error">{error}</FormMessage></div>}
      {loaderData.wishlists.length === 0 ? (
        <EmptyState title="No lists yet">Create a list, then use "Save to a list" on any product.</EmptyState>
      ) : (
        <ul className="grid u-list-style-none-padding-0">
          {loaderData.wishlists.map((w) => (
            <li key={w.id}>
              <Card className="stack">
                <h3 className="u-margin-0"><Link to={`/account/wishlists/${encodeURIComponent(w.id)}`}>{w.name}</Link></h3>
                <span className="muted">{w.itemCount === 1 ? "1 item" : `${w.itemCount} items`}{w.shared ? " · shared by link" : " · private"}</span>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
