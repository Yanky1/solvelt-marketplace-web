import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/sign-up";
import { AuthPage, ErrorSummary } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, currentUser, formError } from "~/lib/auth.server";
import { safeFieldErrors } from "~/lib/api-errors";
import { cleanField, str, validateDisplayName, validateEmail, validateNewPassword, type FieldErrors } from "~/lib/validation";

const NONE: FieldErrors = {};

export function meta() {
  return [{ title: "Create account | Solvelt" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await currentUser(request, context);
  if (user) throw redirect("/account");
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const email = str(form, "email").trim();
  const displayName = cleanField(form, "displayName");
  const password = str(form, "password");
  const fieldErrors: FieldErrors = {};
  const e1 = validateDisplayName(displayName), e2 = validateEmail(email), e3 = validateNewPassword(password);
  if (e1) fieldErrors.displayName = e1;
  if (e2) fieldErrors.email = e2;
  if (e3) fieldErrors.password = e3;
  if (Object.keys(fieldErrors).length) return formError({ fieldErrors, message: null, email, displayName });
  try {
    await api.signUp(apiCtx(request, context, null), { email, password, displayName });
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      // Whatever the API says about the email (e.g. "already registered") is replaced by a fixed message: no enumeration.
      const safe = safeFieldErrors(e.fieldErrors, ["displayName", "email", "password"], ["email"]);
      if (Object.keys(safe).length) return formError({ fieldErrors: safe, message: null, email, displayName }, 422);
      return formError({ fieldErrors: NONE, message: "We could not create your account with those details. Please check them and try again.", email, displayName }, 422);
    }
    if (e instanceof ApiError && e.status === 429) return formError({ fieldErrors: NONE, message: "Too many attempts. Please wait a moment and try again.", email, displayName }, 429);
    return formError({ fieldErrors: NONE, message: "We could not create your account right now. Please try again.", email, displayName }, 503);
  }
  // The same page whether or not the email already had an account (no account enumeration); no email in the URL.
  return redirect("/verify-email?sent=1");
}

export default function SignUp() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <AuthPage title="Create your account" intro={<>Already have one? <Link to="/sign-in">Sign in</Link>.</>}>
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
        <Input label="Name" name="displayName" autoComplete="name" defaultValue={a?.displayName ?? ""} error={a?.fieldErrors?.displayName} required />
        <Input label="Email" name="email" type="email" autoComplete="email" defaultValue={a?.email ?? ""} error={a?.fieldErrors?.email} required />
        <Input label="Password" name="password" type="password" autoComplete="new-password" hint="At least 12 characters." error={a?.fieldErrors?.password} required />
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</Button>
      </Form>
    </AuthPage>
  );
}
