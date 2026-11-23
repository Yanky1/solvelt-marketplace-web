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

type Result = { fieldErrors: Record<string, string>; message: string | null; challengeId?: string; sent?: boolean };
const fe = (fieldErrors: Record<string, string>, message: string | null = null, extra: Partial<Result> = {}): Result => ({ fieldErrors, message, ...extra });
const CONFIRM = "/account/confirm?next=%2Faccount%2Fprivacy";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An account made by phone has no password (DESIGN W3-06): it deletes with a code texted to its own proven number instead. Which way is offered comes from the API; when that cannot be read
 * the page offers the password, as before (an account with a password never gets the text option: the API refuses it too).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const q = new URL(request.url).searchParams.get("export");
  const methods = await api.signInMethods(ctx).catch((e: unknown) => { if (e instanceof ApiError && e.status === 401) return failAccount(e, request); return null; });
  return { exportFailed: q === "failed", exportWait: q === "wait", phoneLast4: methods && !methods.hasPassword && methods.phoneLast4 ? methods.phoneLast4 : null };
}

const signedOutHome = () => redirect("/?account=deleted", { headers: { "Set-Cookie": rotatedCookie(), ...privateHeaders } });

/**
 * Deleting the account: the password (or, for an account without one, a code texted for exactly this) is checked by the API, which also needs a sign-in no older than ten minutes (else the
 * person confirms first and comes back here). When it works the account is locked out at once (the API erases the personal data in a job), and this browser is signed out and sent home.
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  requireAccount(request, context);
  const intent = str(form, "intent");
  if (intent !== "delete" && intent !== "delete-phone-start" && intent !== "delete-phone") throw new Response("Bad request", { status: 400, headers: privateHeaders });
  if (!hasRecentAuth(session, Date.now() / 1000, getConfig().reauthWindowSeconds)) return redirect(CONFIRM, { headers: privateHeaders });
  if (form.get("understood") !== "on") {
    const keep = intent === "delete-phone" && UUID.test(str(form, "challengeId")) ? { challengeId: str(form, "challengeId"), sent: true } : {};
    return formError(fe({ understood: "Tick the box to confirm." }, null, keep), 422);
  }
  const ctx = apiCtx(request, context, session);

  // ---- by text message (an account without a password) ----
  if (intent === "delete-phone-start") {
    try {
      const { challengeId } = await api.deleteAccountPhoneStart(ctx);
      return formError(fe({}, null, { challengeId, sent: true }), 200);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) return redirect(CONFIRM, { headers: privateHeaders });
      if (e instanceof ApiError && e.status === 401) return failAccount(e, request);
      if (e instanceof ApiError && e.status === 429) return formError(fe({}, "Too many codes were asked for. Please wait a while and try again."), 429);
      if (e instanceof ApiError && e.status === 409) return formError(fe({}, "This account cannot get a code by text message. Delete it with your password."), 409);
      return formError(fe({}, "We could not send a code right now. Please try again in a moment."), 503);
    }
  }
  if (intent === "delete-phone") {
    const challengeId = str(form, "challengeId");
    const code = str(form, "code").replace(/\s+/g, "");
    if (!UUID.test(challengeId)) return formError(fe({}, "Please ask for a new code."), 400);
    const keep = { challengeId, sent: true };
    if (!/^\d{6}$/.test(code)) return formError(fe({ code: "Enter the six-digit code from the text message." }, null, keep), 422);
    try {
      await api.deleteAccountByPhone(ctx, { challengeId, code });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 403) return redirect(CONFIRM, { headers: privateHeaders });
        if (e.status === 401 && e.code === "invalid_code") return formError(fe({ code: "That code is not correct." }, null, keep), 401);
        if (e.status === 400) return formError(fe({}, "That code has expired or was tried too many times. Ask for a new one."), 400);
        if (e.status === 409 && e.code === "password_required") return formError(fe({}, "This account now has a password. Delete it with your password."), 409);
        if (e.status === 409) return formError(fe({}, "Your account changed while you were doing this. Please try again."), 409);
        if (e.status === 429) return formError(fe({}, "Too many attempts. Please wait a moment and try again.", keep), 429);
        if (e.status !== 401 && e.status !== 404) return formError(fe({}, "We could not delete your account right now. Please try again.", keep), 503);
      }
      return failAccount(e, request);
    }
    return signedOutHome();
  }

  const password = str(form, "password");
  if (!password) return formError(fe({ password: "Enter your password." }), 422);
  try {
    await api.deleteAccount(ctx, password);
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
  return signedOutHome();
}

export default function Privacy({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>() as Result | undefined;
  const busy = useNavigation().state !== "idle";
  const phone = loaderData.phoneLast4;
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
          {phone ? (
            a?.sent && a.challengeId ? (
              <div className="stack">
                <Form method="post" className="stack" noValidate>
                  <CsrfField />
                  <input type="hidden" name="intent" value="delete-phone" />
                  <input type="hidden" name="challengeId" value={a.challengeId} />
                  <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
                  <p data-testid="delete-code-sent">We texted a code to the number ending in {phone}. It works for 10 minutes and only for deleting your account.</p>
                  <Input label="Six-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} error={a?.fieldErrors?.code} required />
                  <Checkbox name="understood" label="I understand that my account and personal data will be deleted for good." error={a?.fieldErrors?.understood} />
                  <Button type="submit" variant="danger" disabled={busy}>{busy ? "Deleting…" : "Delete my account"}</Button>
                </Form>
                <Form method="post">
                  <CsrfField />
                  <input type="hidden" name="intent" value="delete-phone-start" />
                  <input type="hidden" name="understood" value="on" />
                  <Button type="submit" variant="secondary" disabled={busy}>Send a new code</Button>
                </Form>
              </div>
            ) : (
              <Form method="post" className="stack" noValidate>
                <CsrfField />
                <input type="hidden" name="intent" value="delete-phone-start" />
                <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
                <p>Your account has no password, so we text a code to your number ending in {phone} to confirm it is you.</p>
                <Checkbox name="understood" label="I understand that my account and personal data will be deleted for good." error={a?.fieldErrors?.understood} />
                <Button type="submit" variant="danger" disabled={busy}>{busy ? "Sending…" : "Text me a code to delete my account"}</Button>
              </Form>
            )
          ) : (
            <Form method="post" className="stack" noValidate>
              <CsrfField />
              <input type="hidden" name="intent" value="delete" />
              <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
              <Input label="Your password" name="password" type="password" autoComplete="current-password" error={a?.fieldErrors?.password} required />
              <Checkbox name="understood" label="I understand that my account and personal data will be deleted for good." error={a?.fieldErrors?.understood} />
              <Button type="submit" variant="danger" disabled={busy}>{busy ? "Deleting…" : "Delete my account"}</Button>
            </Form>
          )}
        </section>
      </AuthPage>
    </div>
  );
}
