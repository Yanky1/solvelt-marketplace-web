import { Form, Link, redirect, useActionData, useNavigation } from "react-router";
import type { Route } from "./+types/account.sign-in-methods";
import { AccountNav } from "~/components/AccountNav";
import { ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Card } from "~/components/ui/display";
import { Button, Input } from "~/components/ui/form";
import { safeFieldErrors } from "~/lib/api-errors";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, cookieWithNewToken, failAccount, formError, privateHeaders, requireAccount } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { retryAfterHeader, tooManyMessage } from "~/lib/rate-limit";
import { hasRecentAuth } from "~/lib/session.server";
import { str, validateEmail, validateNewPassword, type FieldErrors } from "~/lib/validation";

/**
 * How you sign in (DESIGN W3-02; API W3-02). For every account, and above all for one made BY PHONE (no email, no password): add an email (a link is mailed to it and it counts only once
 * confirmed), then a password (it needs the confirmed email: you sign in with both), or a passkey. Adding either needs a recent sign-in, like every sensitive change (the confirm page
 * texts a code to an account without a password). Nothing from the query string is rendered except fixed notices.
 */
export function meta() {
  return [{ title: "Sign-in methods | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

const BACK = "/account/sign-in-methods";
const CONFIRM = `/account/confirm?next=${encodeURIComponent(BACK)}`;
const NOTICES = {
  email: "We sent a link to that address. Open it to confirm the address; it is added to your account only then.",
  password: "Password set. You can now sign in with your email and password. Your other devices were signed out.",
} as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const key = new URL(request.url).searchParams.get("done");
  const notice: keyof typeof NOTICES | null = key === "email" || key === "password" ? key : null;
  try {
    return { methods: await api.signInMethods(ctx), notice };
  } catch (e) {
    return failAccount(e, request);
  }
}

const orDefault = (errors: FieldErrors, fallback: FieldErrors): FieldErrors => (Object.keys(errors).length ? errors : fallback);
type ActionData = { form: "email" | "password"; message: string | null; fieldErrors: FieldErrors; email?: string };

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const recent = hasRecentAuth(session, Date.now() / 1000, getConfig().reauthWindowSeconds);
  if (str(form, "intent") === "add-email") {
    const email = str(form, "email").trim();
    const problem = validateEmail(email);
    if (problem) return formError<ActionData>({ form: "email", message: null, fieldErrors: { email: problem }, email }, 422);
    if (!recent) return redirect(CONFIRM, { headers: privateHeaders });
    try {
      await api.addEmail(ctx, email);
      return redirect(`${BACK}?done=email`, { headers: privateHeaders });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 403) return redirect(CONFIRM, { headers: privateHeaders });
        if (e.status === 409) return formError<ActionData>({ form: "email", message: "Your account already has an email address.", fieldErrors: {}, email }, 409);
        if (e.status === 422) return formError<ActionData>({ form: "email", message: null, fieldErrors: orDefault(safeFieldErrors(e.fieldErrors, ["email"]), { email: "Enter a valid email address." }), email }, 422);
        if (e.status === 429) return formError<ActionData>({ form: "email", message: tooManyMessage(e.retryAfter), fieldErrors: {}, email }, 429, retryAfterHeader(e.retryAfter));
        if (e.status !== 401) return formError<ActionData>({ form: "email", message: "We could not add that address right now. Please try again.", fieldErrors: {}, email }, 503);
      }
      return failAccount(e, request);
    }
  }
  // intent "set-password": the first password of an account without one
  const password = str(form, "newPassword");
  const weak = validateNewPassword(password);
  if (weak) return formError<ActionData>({ form: "password", message: null, fieldErrors: { newPassword: weak } }, 422);
  if (!recent) return redirect(CONFIRM, { headers: privateHeaders });
  try {
    const token = await api.setPassword(ctx, password);
    // the API ended every session and handed this one a new token (M1-87); the person just proved who they are, so the recent-sign-in clock restarts
    const cookie: Record<string, string> = token ? { "Set-Cookie": cookieWithNewToken(session, token, true) } : {};
    return redirect(`${BACK}?done=password`, { headers: { ...privateHeaders, ...cookie } });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403) return redirect(CONFIRM, { headers: privateHeaders });
      if (e.status === 409 && e.code === "email_required") return formError<ActionData>({ form: "password", message: "Add and confirm an email address first: you sign in with it and your password.", fieldErrors: {} }, 409);
      if (e.status === 409) return formError<ActionData>({ form: "password", message: "Your account already has a password. Use Change password instead.", fieldErrors: {} }, 409);
      if (e.status === 422) return formError<ActionData>({ form: "password", message: e.fieldErrors?.newPassword ? null : "Please choose another password.", fieldErrors: safeFieldErrors(e.fieldErrors, ["newPassword"]) }, 422);
      if (e.status !== 401) return formError<ActionData>({ form: "password", message: "We could not set your password right now. Please try again.", fieldErrors: {} }, 503);
    }
    return failAccount(e, request);
  }
}

export default function SignInMethods({ loaderData }: Route.ComponentProps) {
  const { methods: m, notice } = loaderData;
  const a = useActionData<typeof action>() as ActionData | undefined;
  const busy = useNavigation().state !== "idle";
  const err = (f: ActionData["form"]) => (a?.form === f ? a : undefined);
  return (
    <div className="stack">
      <h1>Sign-in methods</h1>
      <AccountNav />
      {notice && <FormMessage kind="ok">{NOTICES[notice]}</FormMessage>}

      <Card className="stack">
        <h2>Email address</h2>
        {m.email && m.emailVerified ? (
          <p data-testid="email-status">You sign in with <strong>{m.email}</strong>.</p>
        ) : (
          <>
            {m.pendingEmail
              ? <p data-testid="email-status">We sent a link to <strong>{m.pendingEmail}</strong>. Open it to add the address to your account. Did not get it? Send it again below.</p>
              : <p data-testid="email-status">Your account has no email address yet. Add one to get receipts by email and to sign in with a password.</p>}
            <ErrorSummary submission={err("email")} message={err("email")?.message} errors={err("email")?.fieldErrors} />
            <Form method="post" className="stack" noValidate>
              <CsrfField />
              <Input label="Email address" name="email" type="email" autoComplete="email" defaultValue={err("email")?.email ?? m.pendingEmail ?? ""} error={err("email")?.fieldErrors?.email} required />
              <Button type="submit" name="intent" value="add-email" disabled={busy}>{m.pendingEmail ? "Send the link again" : "Add email address"}</Button>
            </Form>
          </>
        )}
      </Card>

      <Card className="stack">
        <h2>Password</h2>
        {m.hasPassword ? (
          <p data-testid="password-status">Your account has a password. <Link to="/account/password">Change password</Link></p>
        ) : m.email && m.emailVerified ? (
          <>
            <p data-testid="password-status">Choose a password to sign in with your email address. After that you sign in with your password, not with a text message.</p>
            <ErrorSummary submission={err("password")} message={err("password")?.message} errors={err("password")?.fieldErrors} />
            <Form method="post" className="stack" noValidate>
              <CsrfField />
              <Input label="New password" name="newPassword" type="password" autoComplete="new-password" hint="At least 12 characters." error={err("password")?.fieldErrors?.newPassword} required />
              <Button type="submit" name="intent" value="set-password" disabled={busy}>Set password</Button>
            </Form>
          </>
        ) : (
          <p data-testid="password-status">Add and confirm an email address first: you sign in with it and your password.</p>
        )}
      </Card>

      <Card className="stack">
        <h2>Passkeys</h2>
        <p data-testid="passkey-status">{m.passkeys === 0 ? "No passkeys yet. A passkey signs you in with your fingerprint, face or device PIN, without a password." : `${m.passkeys} passkey${m.passkeys === 1 ? "" : "s"} on your account.`}</p>
        <p><Link to="/account/passkeys">{m.passkeys === 0 ? "Add a passkey" : "Manage passkeys"}</Link></p>
      </Card>

      {m.phoneLast4 && (
        <Card className="stack">
          <h2>Phone</h2>
          <p data-testid="phone-status">Your number ending in {m.phoneLast4} is confirmed. {m.hasPassword ? "It is used on Solvelt phone calls." : "You can sign in on the website with a code texted to it, and on Solvelt phone calls."}</p>
        </Card>
      )}
    </div>
  );
}
