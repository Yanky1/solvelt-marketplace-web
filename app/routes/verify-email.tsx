import { useEffect, useState } from "react";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/verify-email";
import { AuthPage, ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, formError, privateHeaders } from "~/lib/auth.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Verify your email | Solvelt" }, { name: "robots", content: "noindex" }];
}

export function headers() {
  return privateHeaders; // Referrer-Policy: no-referrer for these token pages is set once in server.js
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { token: url.searchParams.get("token") ?? "", sent: url.searchParams.has("sent") };
}

// Verification is a POST (confirm button), so mail scanners and link prefetchers cannot consume the token. It also needs the
// password chosen at sign-up (O-16): holding the emailed link alone is not enough. A wrong password and a bad or expired
// link get the same answer, and a wrong password leaves the link valid.
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const token = str(form, "token");
  const password = str(form, "password");
  if (!token) return formError({ done: false, message: "This verification link is not valid.", error: null, failed: false });
  if (!password) return formError({ done: false, message: null, error: "Enter the password you chose when you signed up.", failed: false });
  try {
    await api.verifyEmail(apiCtx(request, context, null), { token, password });
    return formError({ done: true, message: null, error: null, failed: false }, 200);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 410)) {
      return formError({ done: false, message: "We could not verify your email with that password and link. Check the password and try again. If the link has expired, request a new one.", error: null, failed: true }, 400);
    }
    if (e instanceof ApiError && e.status === 422) return formError({ done: false, message: null, error: "Enter the password you chose when you signed up.", failed: false }, 422);
    if (e instanceof ApiError && e.status === 429) return formError({ done: false, message: "Too many attempts. Please wait a moment and try again.", error: null, failed: false }, 429);
    return formError({ done: false, message: "We could not verify your email right now. Please try again.", error: null, failed: false }, 503);
  }
}

export default function VerifyEmail() {
  const loaded = useLoaderData<typeof loader>();
  const { sent } = loaded;
  const [token] = useState(loaded.token); // kept in state: the URL is cleaned below
  useEffect(() => {
    // The one-time token must not stay in the address bar and browser history. Keep the router's history state.
    if (token && window.location.search.includes("token=")) window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [token]);
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  if (a?.done) return <AuthPage title="Email verified"><FormMessage kind="ok">Your email is verified.</FormMessage><Link className="btn btn-primary" to="/sign-in">Sign in</Link></AuthPage>;
  if (!token) {
    return (
      <AuthPage title="Check your inbox" intro={sent ? "We sent you a link to verify your email address. It can take a minute to arrive." : "Open the verification link we emailed you."}>
        <p className="muted">If you did not get an email, check your spam folder or <Link to="/resend-verification">request a new link</Link>.</p>
      </AuthPage>
    );
  }
  return (
    <AuthPage title="Verify your email" intro="Enter the password you chose when you signed up to confirm your email address.">
      <Form method="post" action="/verify-email" className="stack" noValidate>
        <CsrfField />
        <input type="hidden" name="token" value={token} />
        <ErrorSummary submission={a} message={a?.message} errors={a?.error ? { password: a.error } : undefined} />
        <Input label="Password" name="password" type="password" autoComplete="current-password" error={a?.error ?? undefined} required />
        {Boolean(a?.failed) && <p><Link to="/resend-verification">Request a new verification link</Link></p>}
        <p><Link to="/forgot-password">Forgot your password?</Link> Resetting it also verifies your email.</p>
        <Button type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify email"}</Button>
      </Form>
    </AuthPage>
  );
}
