import { Form, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/account.confirm";
import { AuthPage, ErrorSummary } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount, revokePreviousSession, rotatedCookie } from "~/lib/auth.server";
import { safeNext } from "~/lib/csrf.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Confirm it is you | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

export function loader({ request, context }: Route.LoaderArgs) {
  requireAccount(request, context);
  return null;
}

/** Re-authentication for sensitive changes (O-11): the password is checked by the API, which issues a fresh session. */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const password = str(form, "password");
  if (!password) return formError({ message: null, error: "Enter your password." });
  try {
    const me = await api.me(ctx);
    if (!me.email) throw new ApiError(503, "unavailable", "No email");
    const { token } = await api.signIn({ ...ctx, sessionToken: undefined }, { email: me.email, password });
    await revokePreviousSession(request, context);
    return redirect(safeNext(str(form, "next"), "/account"), { headers: { "Set-Cookie": rotatedCookie(token), ...privateHeaders } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      if (e.code === "invalid_credentials") return formError({ message: null, error: "That password is not correct." }, 401);
      return failAccount(e, request); // the session itself is dead
    }
    if (e instanceof ApiError && e.status === 429) return formError({ message: "Too many attempts. Please wait a moment and try again.", error: null }, 429);
    if (e instanceof ApiError) return formError({ message: "We could not check your password right now. Please try again.", error: null }, 503);
    return failAccount(e, request);
  }
}

export default function Confirm() {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  return (
    <AuthPage title="Confirm it is you" intro="For your security, please enter your password to continue. This protects your account if someone else is using your device.">
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        <input type="hidden" name="next" value={params.get("next") ?? ""} />
        <ErrorSummary submission={a} message={a?.message} errors={a?.error ? { password: a.error } : undefined} />
        <Input label="Password" name="password" type="password" autoComplete="current-password" error={a?.error ?? undefined} required />
        <Button type="submit" disabled={busy}>{busy ? "Checking…" : "Confirm"}</Button>
      </Form>
    </AuthPage>
  );
}
