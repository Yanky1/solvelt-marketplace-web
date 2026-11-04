import { Form, Link, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/sign-in";
import { AuthPage, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, currentUser, formError, rotatedCookie } from "~/lib/auth.server";
import { safeNext } from "~/lib/csrf.server";
import { str, validateEmail, type FieldErrors } from "~/lib/validation";

const NONE: FieldErrors = {};

export function meta() {
  return [{ title: "Sign in | Solvelt" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await currentUser(request, context);
  if (user) throw redirect(safeNext(new URL(request.url).searchParams.get("next"), "/account"));
  return null;
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const email = str(form, "email").trim();
  const password = str(form, "password");
  const emailError = validateEmail(email);
  if (emailError || !password) {
    const fieldErrors: FieldErrors = {};
    if (emailError) fieldErrors.email = emailError;
    if (!password) fieldErrors.password = "Enter your password.";
    return formError({ fieldErrors, message: null, email });
  }
  try {
    const { token } = await api.signIn(apiCtx(request, context, null), { email, password });
    // New session id on every sign-in (no fixation); the token lives only in the sealed HttpOnly cookie.
    return redirect(safeNext(str(form, "next"), "/account"), { headers: { "Set-Cookie": rotatedCookie(token), "Cache-Control": "private, no-store" } });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403 && e.code === "email_not_verified") return formError({ fieldErrors: NONE, message: "Please verify your email address first. Check your inbox for the link.", email }, 403);
      if (e.status === 429) return formError({ fieldErrors: NONE, message: "Too many attempts. Please wait a moment and try again.", email }, 429);
      if (e.status === 401) return formError({ fieldErrors: NONE, message: "Email or password is incorrect.", email }, 401); // same text for unknown user and wrong password
    }
    return formError({ fieldErrors: NONE, message: "We could not sign you in right now. Please try again.", email }, 503);
  }
}

export default function SignIn() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  return (
    <AuthPage title="Sign in" intro={<>New here? <Link to={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>.</>}>
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        <input type="hidden" name="next" value={next} />
        {a?.message && <FormMessage kind="error">{a.message}</FormMessage>}
        <Input label="Email" name="email" type="email" autoComplete="email" defaultValue={a?.email ?? ""} error={a?.fieldErrors?.email} required />
        <Input label="Password" name="password" type="password" autoComplete="current-password" error={a?.fieldErrors?.password} required />
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        <p><Link to="/forgot-password">Forgot your password?</Link></p>
      </Form>
    </AuthPage>
  );
}
