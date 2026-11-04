import { useEffect, useState } from "react";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/unsubscribe";
import { AuthPage, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, formError, privateHeaders } from "~/lib/auth.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Stop emails | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders; // Referrer-Policy: no-referrer for this token page is set once in server.js
}

export function loader({ request }: Route.LoaderArgs) {
  return { token: new URL(request.url).searchParams.get("token") ?? "" };
}

// A POST behind a confirm button, like verification: a mail scanner or link prefetcher that opens the link changes nothing. The token can only switch mail OFF.
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const token = str(form, "token");
  if (!token || token.length > 200) return formError({ done: false, expired: false, message: "This link is not valid." }, 400);
  try {
    await api.unsubscribe(apiCtx(request, context, null), token);
    return formError({ done: true, expired: false, message: null }, 200);
  } catch (e) {
    if (e instanceof ApiError && e.code === "expired_token") return formError({ done: false, expired: true, message: "This link has expired." }, 400);
    if (e instanceof ApiError && (e.status === 400 || e.status === 404)) return formError({ done: false, expired: false, message: "This link is not valid. You can change your email settings after signing in." }, 400);
    if (e instanceof ApiError && e.status === 429) return formError({ done: false, expired: false, message: "Too many attempts. Please wait a moment and try again." }, 429);
    return formError({ done: false, expired: false, message: "We could not do that right now. Please try again." }, 503);
  }
}

export default function Unsubscribe() {
  const loaded = useLoaderData<typeof loader>();
  const [token] = useState(loaded.token); // kept in state: the URL is cleaned below
  useEffect(() => {
    if (token && window.location.search.includes("token=")) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [token]);
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  if (a?.done) return <AuthPage title="You are unsubscribed"><FormMessage kind="ok">We will not send you those emails any more.</FormMessage><p><Link to="/account/notifications/preferences">Change your email settings</Link></p></AuthPage>;
  if (a?.expired) return <AuthPage title="This link has expired"><FormMessage kind="error">Links in our emails stop working after 90 days.</FormMessage><p>Sign in to choose which emails you get: <Link to="/account/notifications/preferences">email settings</Link>.</p></AuthPage>;
  if (!token) return <AuthPage title="Stop emails" intro="Open the “stop these emails” link from one of our emails, or change your settings after signing in."><Link className="btn btn-secondary" to="/account/notifications/preferences">Email settings</Link></AuthPage>;
  return (
    <AuthPage title="Stop these emails?" intro="Confirm to stop the emails from this link. You can switch them back on in your email settings.">
      <Form method="post" action="/unsubscribe" className="stack" noValidate>
        <CsrfField />
        <input type="hidden" name="token" value={token} />
        {a?.message && <FormMessage kind="error">{a.message}</FormMessage>}
        <Button type="submit" disabled={busy}>{busy ? "Working…" : "Stop these emails"}</Button>
      </Form>
    </AuthPage>
  );
}
