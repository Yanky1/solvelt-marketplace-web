import { Form, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/account.privacy";
import { AccountNav } from "~/components/AccountNav";
import { AuthPage, ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Checkbox, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { apiCtx, assertCsrf, failAccount, formError, privateHeaders, requireAccount, rotatedCookie } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { hasRecentAuth } from "~/lib/session.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Privacy | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const fe = (fieldErrors: Record<string, string>, message: string | null = null) => ({ fieldErrors, message });
const CONFIRM = "/account/confirm?next=%2Faccount%2Fprivacy";

export function loader({ request, context }: Route.LoaderArgs) {
  requireAccount(request, context);
  const q = new URL(request.url).searchParams.get("export");
  return { exportFailed: q === "failed", exportWait: q === "wait" };
}

/**
 * Deleting the account: the password is checked by the API, which also needs a sign-in no older than ten minutes (else the person confirms first and comes back here). When it works the
 * account is locked out at once (the API erases the personal data in a job), and this browser is signed out and sent to the home page.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  requireAccount(request, context);
  if (str(form, "intent") !== "delete") throw new Response("Bad request", { status: 400, headers: privateHeaders });
  if (!hasRecentAuth(session, Date.now() / 1000, getConfig().reauthWindowSeconds)) return redirect(CONFIRM, { headers: privateHeaders });
  const password = str(form, "password");
  if (form.get("understood") !== "on") return formError(fe({ understood: "Tick the box to confirm." }), 422);
  if (!password) return formError(fe({ password: "Enter your password." }), 422);
  try {
    await api.deleteAccount(apiCtx(request, context, session), password);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403) return redirect(CONFIRM, { headers: privateHeaders });
      if (e.status === 401 && e.code === "invalid_credentials") return formError(fe({ password: "The password is not correct." }), 401);
      if (e.status === 429) return formError(fe({}, "Too many attempts. Please wait a moment and try again."), 429);
      if (e.status === 409) return formError(fe({}, "Your account changed while you were doing this. Please try again."), 409);
      if (e.status !== 401 && e.status !== 404) return formError(fe({}, "We could not delete your account right now. Please try again."), 503);
    }
    return failAccount(e, request);
  }
  return redirect("/?account=deleted", { headers: { "Set-Cookie": rotatedCookie(), ...privateHeaders } });
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  return (
    <div>
      <h1>Your account</h1>
      <AccountNav />
      <AuthPage title="Privacy">
        <section className="stack" aria-labelledby="download-h">
          <h2 id="download-h">Download my data</h2>
          <p className="muted">Get a file with what we hold about you: your profile and addresses, orders and tracking, cancellations and returns, bookings, carts, messages, notifications and email settings, and the names of your passkeys. It may ask you to confirm your password first. We email you when a download is made, and you can download once every ten minutes.</p>
          {loaderData.exportWait && <FormMessage kind="error">You can download your data once every ten minutes. Please try again later.</FormMessage>}
          {loaderData.exportFailed && <FormMessage kind="error">We could not prepare your file right now. Please try again.</FormMessage>}
          <Form method="post" action="/account/privacy/export" reloadDocument>
            <CsrfField />
            <Button type="submit">Download my data</Button>
          </Form>
        </section>
        <section className="stack" aria-labelledby="delete-h">
          <h2 id="delete-h">Delete my account</h2>
          <p className="muted">This signs you out everywhere at once and erases your personal data: your profile, addresses, messages, notifications and settings. Orders stay only as accounting records, without your personal details once they are closed. It cannot be undone, and you cannot get this account back.</p>
          <Form method="post" className="stack" noValidate>
            <CsrfField />
            <input type="hidden" name="intent" value="delete" />
            <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
            <Input label="Your password" name="password" type="password" autoComplete="current-password" error={a?.fieldErrors?.password} required />
            <Checkbox name="understood" label="I understand that my account and personal data will be deleted for good." error={a?.fieldErrors?.understood} />
            <Button type="submit" variant="danger" disabled={busy}>{busy ? "Deleting…" : "Delete my account"}</Button>
          </Form>
        </section>
      </AuthPage>
    </div>
  );
}
