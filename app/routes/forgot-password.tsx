import { Form, Link, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/forgot-password";
import { AuthPage, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, formError } from "~/lib/auth.server";
import { str, validateEmail } from "~/lib/validation";

export function meta() {
  return [{ title: "Reset your password | Solvelt" }, { name: "robots", content: "noindex" }];
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const email = str(form, "email").trim();
  const err = validateEmail(email);
  if (err) return formError({ sent: false, error: err, message: null });
  try {
    await api.forgotPassword(apiCtx(request, context, null), email);
  } catch (e) {
    if (e instanceof ApiError && e.status === 429) return formError({ sent: false, error: null, message: "Too many attempts. Please wait a moment and try again." }, 429);
    // Any other failure looks the same as success to the user: never reveal whether an account exists.
  }
  return formError({ sent: true, error: null, message: null }, 200);
}

export default function ForgotPassword() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  if (a?.sent) {
    return <AuthPage title="Check your inbox"><FormMessage kind="ok">If an account exists for that address, we have sent a link to reset the password.</FormMessage><Link to="/sign-in">Back to sign in</Link></AuthPage>;
  }
  return (
    <AuthPage title="Reset your password" intro="Enter your email and we will send you a link to choose a new password.">
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        {a?.message && <FormMessage kind="error">{a.message}</FormMessage>}
        <Input label="Email" name="email" type="email" autoComplete="email" error={a?.error ?? undefined} required />
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
        <Link to="/sign-in">Back to sign in</Link>
      </Form>
    </AuthPage>
  );
}
