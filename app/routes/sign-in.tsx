import { useState } from "react";
import { Form, Link, redirect, useActionData, useNavigation, useSearchParams, useSubmit } from "react-router";
import type { Route } from "./+types/sign-in";
import { AuthPage, ErrorSummary, FormMessage } from "~/components/AuthForm";
import { CsrfField, useRootData } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { afterSignIn } from "~/lib/cart.server";
import { apiCtx, assertCsrf, currentUser, formError, revokePreviousSession, signInHeaders } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { demoMode, resetDemoModeCache } from "~/lib/demo.server";
import { retryAfterHeader, tooManyMessage } from "~/lib/rate-limit";
import { safeNext } from "~/lib/csrf.server";
import { checkPasskeyChallenge, sessionCookie, withoutPasskeyChallenge } from "~/lib/session.server";
import { getPasskey, usePasskeysSupported } from "~/lib/webauthn";
import { str, validateEmail, type FieldErrors } from "~/lib/validation";

const NONE: FieldErrors = {};

const NOTICES = {
  "signout-failed": "You were signed out on this device, but we could not confirm it with the server. If this is a shared computer, sign in and sign out again.",
  "signout-all-failed": "You were signed out on this device, but we could not sign out your other devices. Sign in and choose \u201cSign out everywhere\u201d again.",
  "confirm-locked": "Too many incorrect passwords were entered, so you were signed out for your security. Sign in again to continue.",
} as const;

export function meta() {
  return [{ title: "Sign in | Solvelt" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { user } = await currentUser(request, context);
  const url = new URL(request.url);
  if (user) throw redirect(safeNext(url.searchParams.get("next"), "/account"));
  // Only known notice keys map to (fixed) text; nothing from the query string is ever rendered.
  const key = url.searchParams.get("notice");
  const notice: keyof typeof NOTICES | null = key === "signout-failed" || key === "signout-all-failed" || key === "confirm-locked" ? key : null;
  return { notice };
}

export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  if (str(form, "intent") === "passkey") {
    // The challenge must have been issued to THIS browser session, for sign-in, and still be fresh. It is single use:
    // whatever happens next, the binding is dropped from the cookie.
    const dropBinding = { "Set-Cookie": sessionCookie(withoutPasskeyChallenge(session), getConfig()) };
    const generic = (status: number) => session.token
      // Already signed in: the sign-in loader would turn this response into a redirect and lose the Set-Cookie. Redirect
      // ourselves, with the cookie that drops the challenge binding.
      ? redirect(safeNext(str(form, "next"), "/account"), { headers: { ...dropBinding, "Cache-Control": "private, no-store" } })
      : formError({ fieldErrors: NONE, message: status === 429 ? "Too many attempts. Please wait a moment and try again." : "We could not verify that passkey. Try again, or sign in with your password.", email: "" }, status, dropBinding);
    if (!checkPasskeyChallenge(session, str(form, "challengeId"), "get").ok) return generic(401);
    try {
      const credential: unknown = JSON.parse(str(form, "credential"));
      const { token } = await api.passkeySignIn(apiCtx(request, context, null), { challengeId: str(form, "challengeId"), credential });
      await revokePreviousSession(request, context);
      const cart = await afterSignIn(request, context, token);
      return redirect(safeNext(str(form, "next"), "/account"), { headers: signInHeaders(token, cart) });
    } catch (e) {
      return generic(e instanceof ApiError && e.status === 429 ? 429 : 401);
    }
  }
  const email = str(form, "email").trim();
  const password = str(form, "password");
  const emailError = validateEmail(email);
  if (emailError || !password) {
    const fieldErrors: FieldErrors = {};
    if (emailError) fieldErrors.email = emailError;
    if (!password) fieldErrors.password = "Enter your password.";
    return formError({ fieldErrors, message: null, email });
  }
  // Test mode only (M9): an unverified account cannot sign in, so "verify this account" takes the credentials, marks it verified at the API (same throttle as sign-in, same generic
  // answer for wrong credentials), and carries straight on with the ordinary sign-in below. When test mode is not on the intent is ignored: it is just a sign-in.
  const demoVerify = str(form, "intent") === "demo-verify" && (await demoMode(apiCtx(request, context, null))).buttons;
  try {
    if (demoVerify) await api.demoVerify(apiCtx(request, context, null), { email, password });
    const { token } = await api.signIn(apiCtx(request, context, null), { email, password });
    await revokePreviousSession(request, context);
    // New session id on every sign-in (no fixation); the token lives only in the sealed HttpOnly cookie.
    const cart = await afterSignIn(request, context, token);
    return redirect(safeNext(str(form, "next"), "/account"), { headers: signInHeaders(token, cart) });
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403 && e.code === "email_not_verified") return formError({ fieldErrors: NONE, message: "Please verify your email address first. Check your inbox for the link.", email, unverified: true }, 403);
      // After a failed "verify this account" the button stays so the visitor can try again; the answer is the same for an unknown address and a wrong password, so this says nothing about any account.
      if (e.status === 429) return formError({ fieldErrors: NONE, message: tooManyMessage(e.retryAfter), email, unverified: demoVerify }, 429, retryAfterHeader(e.retryAfter));
      // Test mode was switched off at the API while this page still offered the button (the answer is cached for a few seconds): say so instead of "could not sign you in", keep the
      // verify prompt as it was, and forget the cached answer so the next page is right (LOW-5). The account is still unverified: the way in is the email link.
      if (demoVerify && e.status === 404) { resetDemoModeCache(); return formError({ fieldErrors: NONE, message: "Test mode is switched off, so this account cannot be verified without email. Please verify your email address first: check your inbox for the link.", email, unverified: true }, 403); }
      if (e.status === 401) return formError({ fieldErrors: NONE, message: "Email or password is incorrect.", email, unverified: demoVerify }, 401); // same text for unknown user and wrong password
    }
    return formError({ fieldErrors: NONE, message: "We could not sign you in right now. Please try again.", email }, 503);
  }
}


export default function SignIn({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  const submit = useSubmit();
  const csrf = useRootData()?.csrf ?? "";
  const passkeys = usePasskeysSupported() === true;
  const demoButtons = useRootData()?.demo?.buttons === true;
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  async function signInWithPasskey() {
    setPasskeyError(null);
    try {
      const res = await fetch("/passkeys/sign-in-options", { method: "POST", body: new URLSearchParams({ csrf }), credentials: "same-origin" });
      if (!res.ok) throw new Error("options");
      const { challengeId, options } = (await res.json()) as { challengeId: string; options: Record<string, unknown> };
      const credential = await getPasskey(options);
      const fd = new FormData();
      fd.set("csrf", csrf); fd.set("intent", "passkey"); fd.set("challengeId", challengeId); fd.set("credential", JSON.stringify(credential)); fd.set("next", next);
      submit(fd, { method: "post" });
    } catch (e) {
      const cancelled = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError");
      setPasskeyError(cancelled ? "Passkey sign-in was cancelled." : "We could not use a passkey right now. Please sign in with your password.");
    }
  }
  return (
    <AuthPage title="Sign in" intro={<>New here? <Link to={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Create an account</Link>.</>}>
      {loaderData?.notice && <FormMessage kind="error">{NOTICES[loaderData.notice]}</FormMessage>}
      <Form method="post" className="stack" noValidate>
        <CsrfField />
        <input type="hidden" name="next" value={next} />
        <ErrorSummary submission={a} message={a?.message} errors={a?.fieldErrors} />
        {Boolean(a && "unverified" in a && a.unverified) && <p>Did not get it? <Link to="/resend-verification">Resend the verification email</Link>.</p>}
        <Input label="Email" name="email" type="email" autoComplete="email" defaultValue={a?.email ?? ""} error={a?.fieldErrors?.email} required />
        <Input label="Password" name="password" type="password" autoComplete="current-password" error={a?.fieldErrors?.password} required />
        <Button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
        {demoButtons && Boolean(a && "unverified" in a && a.unverified) && (
          <div className="stack">
            <p className="muted">Test mode: enter your password again to skip the email step.</p>
            <Button type="submit" name="intent" value="demo-verify" variant="secondary" disabled={busy}>Verify this account and sign in</Button>
          </div>
        )}
        <p><Link to="/forgot-password">Forgot your password?</Link></p>
      </Form>
      {passkeys && (
        <div className="stack">
          <hr style={{ border: 0, borderTop: "1px solid var(--divider)", width: "100%" }} />
          {passkeyError && <FormMessage kind="error">{passkeyError}</FormMessage>}
          <Button variant="secondary" onClick={signInWithPasskey} disabled={busy}>Sign in with a passkey</Button>
        </div>
      )}
    </AuthPage>
  );
}
