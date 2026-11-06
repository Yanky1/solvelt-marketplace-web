import { Form, Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/resend-verification";
import { AuthPage, ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, formError } from "~/lib/auth.server";
import { str, validateEmail } from "~/lib/validation";

export function meta() {
  return [{ title: "Resend verification email | Solvelt" }, { name: "robots", content: "noindex" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const email = str(form, "email").trim();
  const err = validateEmail(email);
  if (err) return formError({ sent: false, error: err, message: null });
  try {
    await api.resendVerification(apiCtx(request, context, null), email);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return formError({ sent: false, error: null, message: "Too many attempts. Please wait a moment and try again." }, 429);
    // Any other outcome looks like success: never reveal whether an account exists or is already verified.
  }
  return formError({ sent: true, error: null, message: null }, 200);
}

export default function ResendVerification() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  if (a?.sent) {
    return <AuthPage title="Check your inbox"><FormMessage kind="ok">If that address has an account that still needs verifying, we have sent a new link. Older links stop working.</FormMessage><Link to="/sign-in" className="link-standalone">Back to sign in</Link></AuthPage>;
  }
  return (
    <AuthPage title="Resend verification email" intro="Enter the email you signed up with and we will send a new verification link.">
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        <ErrorSummary submission={a} message={a?.message} errors={a?.error ? { email: a.error } : undefined} />
        <Input label="Email" name="email" type="email" autoComplete="email" error={a?.error ?? undefined} required />
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send new link"}</Button>
        <Link to="/sign-in" className="link-standalone">Back to sign in</Link>
      </Form>
    </AuthPage>
  );
}
