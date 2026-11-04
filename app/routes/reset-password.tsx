import { useEffect, useState } from "react";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/reset-password";
import { AuthPage, ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, formError, privateHeaders } from "~/lib/auth.server";
import { str, validateNewPassword } from "~/lib/validation";

export function meta() {
  return [{ title: "Choose a new password | Solvelt" }, { name: "robots", content: "noindex" }];
}

export function headers() {
  return privateHeaders; // Referrer-Policy: no-referrer for these token pages is set once in server.js
}

export function loader({ request }: Route.LoaderArgs) {
  return { token: new URL(request.url).searchParams.get("token") ?? "" };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const token = str(form, "token");
  const password = str(form, "password");
  const err = validateNewPassword(password);
  if (err) return formError({ done: false, error: err, message: null });
  if (!token) return formError({ done: false, error: null, message: "This reset link is not valid." });
  try {
    await api.resetPassword(apiCtx(request, context, null), { token, password });
    return formError({ done: true, error: null, message: null }, 200);
  } catch (e) {
    if (e instanceof ApiError && [400, 404, 410, 422].includes(e.status)) return formError({ done: false, error: null, message: "This reset link is invalid or has expired. Request a new one." }, 400);
    return formError({ done: false, error: null, message: "We could not reset your password right now. Please try again." }, 503);
  }
}

export default function ResetPassword() {
  const loaded = useLoaderData<typeof loader>();
  const [token] = useState(loaded.token); // kept in state: the URL is cleaned below
  useEffect(() => {
    if (token && window.location.search.includes("token=")) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [token]);
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  if (a?.done) return <AuthPage title="Password changed"><FormMessage kind="ok">Your password was changed. All other devices were signed out.</FormMessage><Link className="btn btn-primary" to="/sign-in">Sign in</Link></AuthPage>;
  if (!token) return <AuthPage title="Link not valid" intro="This reset link is missing its token."><Link to="/forgot-password">Request a new link</Link></AuthPage>;
  return (
    <AuthPage title="Choose a new password">
      <Form method="post" action="/reset-password" className="stack" noValidate>
        <CsrfField />
        <input type="hidden" name="token" value={token} />
        <ErrorSummary submission={a} message={a?.message} errors={a?.error ? { password: a.error } : undefined} />
        <Input label="New password" name="password" type="password" autoComplete="new-password" hint="At least 12 characters." error={a?.error ?? undefined} required />
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button>
      </Form>
    </AuthPage>
  );
}
