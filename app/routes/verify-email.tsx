import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import type { Route } from "./+types/verify-email";
import { AuthPage, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, formError, privateHeaders } from "~/lib/auth.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Verify your email | Solvelt" }, { name: "robots", content: "noindex" }];
}

export function headers() {
  return { ...privateHeaders, "Referrer-Policy": "no-referrer" }; // the link carries a one-time token
}

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return { token: url.searchParams.get("token") ?? "", sent: url.searchParams.has("sent") };
}

// Verification is a POST (confirm button), so mail scanners and link prefetchers cannot consume the token.
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const token = str(form, "token");
  if (!token) return formError({ done: false, message: "This verification link is not valid." });
  try {
    await api.verifyEmail(apiCtx(request, context, null), token);
    return formError({ done: true, message: null }, 200);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 404 || e.status === 410 || e.status === 422)) return formError({ done: false, message: "This verification link is invalid or has expired. Sign in to request a new one." }, 400);
    return formError({ done: false, message: "We could not verify your email right now. Please try again." }, 503);
  }
}

export default function VerifyEmail() {
  const { token, sent } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  if (a?.done) return <AuthPage title="Email verified"><FormMessage kind="ok">Your email is verified.</FormMessage><Link className="btn btn-primary" to="/sign-in">Sign in</Link></AuthPage>;
  if (!token) {
    return (
      <AuthPage title="Check your inbox" intro={sent ? "We sent you a link to verify your email address. It can take a minute to arrive." : "Open the verification link we emailed you."}>
        <p className="muted">If you did not get an email, check your spam folder, or try to <Link to="/sign-in">sign in</Link> to request another.</p>
      </AuthPage>
    );
  }
  return (
    <AuthPage title="Verify your email" intro="Confirm to finish setting up your account.">
      <Form method="post" className="stack">
        <CsrfField />
        <input type="hidden" name="token" value={token} />
        {a?.message && <FormMessage kind="error">{a.message}</FormMessage>}
        <Button type="submit" disabled={busy}>{busy ? "Verifying…" : "Verify email"}</Button>
      </Form>
    </AuthPage>
  );
}
