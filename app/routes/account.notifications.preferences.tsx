import { Form, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/account.notifications.preferences";
import { AccountNav } from "~/components/AccountNav";
import { FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Checkbox } from "~/components/ui/form";
import { api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, privateHeaders, requireAccount } from "~/lib/auth.server";
import { CATEGORIES, CATEGORY_KEYS } from "~/lib/notifications";

export function meta() {
  return [{ title: "Email settings | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  try {
    return { prefs: (await api.notificationPrefs(ctx)).email, saved: new URL(request.url).searchParams.has("saved") };
  } catch (e) {
    return failAccount(e, request);
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  // An unticked box is not sent by the browser, so every category is sent explicitly: ticked = on, absent = off.
  const email: Record<string, boolean> = {};
  for (const k of CATEGORY_KEYS) email[k] = form.get(`email:${k}`) === "on";
  try {
    await api.saveNotificationPrefs(ctx, email);
  } catch (e) {
    return failAccount(e, request);
  }
  return redirect("/account/notifications/preferences?saved=1", { headers: privateHeaders });
}

export default function Preferences({ loaderData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <h2>Email settings</h2>
      <p className="muted">Choose which updates we email you. Everything still appears in your notifications here. Emails never include what a seller wrote to you: they only say there is a message.</p>
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        {loaderData.saved && <FormMessage kind="ok">Settings saved.</FormMessage>}
        <fieldset className="stack">
          <legend>Email me about</legend>
          {CATEGORIES.map((c) => (
            <Checkbox key={c.key} name={`email:${c.key}`} defaultChecked={loaderData.prefs[c.key] !== false} label={<>{c.label}<span className="muted"> · {c.hint}</span></>} />
          ))}
        </fieldset>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save settings"}</Button>
      </Form>
    </div>
  );
}
