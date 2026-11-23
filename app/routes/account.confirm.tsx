import { Form, redirect, useActionData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/account.confirm";
import { AuthPage, ErrorSummary } from "~/components/AuthForm";
import { CsrfField } from "~/components/Shell";
import { Button, Input } from "~/components/ui/form";
import { ApiError, api } from "~/lib/api-client.server";
import { assertCsrf, failAccount, formError, privateHeaders, requireAccount, rotatedCookie } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { safeNext } from "~/lib/csrf.server";
import { MAX_CONFIRM_FAILURES, sessionCookie } from "~/lib/session.server";
import { str } from "~/lib/validation";

export function meta() {
  return [{ title: "Confirm it is you | Solvelt" }, { name: "robots", content: "noindex" }];
}
export function headers() {
  return privateHeaders;
}

/**
 * An account made by phone has no password (W3-02): it confirms with a code texted to its own proven number instead. Which way is offered comes from the API; when that cannot be read
 * the page offers the password, as before (an account with a password never gets the text option: the API refuses it too).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { ctx } = requireAccount(request, context);
  const methods = await api.signInMethods(ctx).catch((e: unknown) => { if (e instanceof ApiError && e.status === 401) return failAccount(e, request); return null; });
  return { phoneLast4: methods && !methods.hasPassword && methods.phoneLast4 ? methods.phoneLast4 : null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LOCKED_MESSAGE = "Too many incorrect passwords. We could not end your session on the server, so confirmation is locked. Please try again later.";

/**
 * Re-authentication for sensitive changes (O-11): the password is checked by the API (step-up endpoint), which refreshes this session's authenticated-at.
 *
 * Wrong passwords are also counted in the sealed cookie (`rf`) and, at MAX_CONFIRM_FAILURES, the session is ended. That
 * counter is a UX measure only: a client can keep an older cookie and replay it, which resets the count, and this tier has
 * no server-side state to prevent that. The real limit is the API's per-address delay on the sign-in endpoint this page
 * calls (decision O-17); its 429 is surfaced here as "too many attempts".
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const session = assertCsrf(request, form);
  const { ctx } = requireAccount(request, context);
  const cfg = getConfig();

  // Ends the API session (one retry). A dead token (401) counts as ended; anything else means it is still live.
  const endSession = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await api.signOut(ctx); return true; } catch (e) { if (e instanceof ApiError && e.status === 401) return true; }
    }
    return false;
  };
  // Lock: end the session and send the user to sign-in. If the server could not confirm the sign-out we do NOT pretend:
  // the user stays on this page, which stays locked (the cookie keeps the full count) and never checks a password.
  const lock = async () =>
    (await endSession())
      ? redirect("/sign-in?notice=confirm-locked", { headers: { "Set-Cookie": rotatedCookie(), ...privateHeaders } })
      : formError({ message: LOCKED_MESSAGE, error: null }, 429, { "Set-Cookie": sessionCookie({ ...session, rf: MAX_CONFIRM_FAILURES }, cfg) });

  if ((session.rf ?? 0) >= MAX_CONFIRM_FAILURES) return lock();

  // ---- by text message (an account without a password, W3-02) ----
  const intent = str(form, "intent");
  if (intent === "phone-start") {
    try {
      const { challengeId } = await api.phoneStepUpStart(ctx);
      return formError({ message: null, error: null, challengeId, sent: true }, 200);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return failAccount(e, request);
      if (e instanceof ApiError && e.status === 429) return formError({ message: "Too many codes were asked for. Please wait a while and try again.", error: null }, 429);
      return formError({ message: "We could not send a code right now. Please try again in a moment.", error: null }, 503);
    }
  }
  if (intent === "phone-verify") {
    const challengeId = str(form, "challengeId");
    const code = str(form, "code").replace(/\s+/g, "");
    if (!UUID.test(challengeId)) return formError({ message: "Please ask for a new code.", error: null }, 400);
    if (!/^\d{6}$/.test(code)) return formError({ message: null, error: "Enter the six-digit code from the text message.", challengeId, sent: true }, 422);
    try {
      await api.phoneStepUp(ctx, { challengeId, code });
      const { rf: _rf, ...rest } = session;
      void _rf;
      return redirect(safeNext(str(form, "next"), "/account"), { headers: { "Set-Cookie": sessionCookie({ ...rest, authAt: Math.floor(Date.now() / 1000) }, cfg), ...privateHeaders } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && e.code === "invalid_code") {
        const failures = (session.rf ?? 0) + 1;   // the same UX counter as wrong passwords; the API's own limit is five tries per code
        if (failures >= MAX_CONFIRM_FAILURES) return lock();
        return formError({ message: null, error: "That code is not correct.", challengeId, sent: true }, 401, { "Set-Cookie": sessionCookie({ ...session, rf: failures }, cfg) });
      }
      if (e instanceof ApiError && e.status === 401) return failAccount(e, request);
      if (e instanceof ApiError && e.status === 400) return formError({ message: "That code has expired or was tried too many times. Ask for a new one.", error: null }, 400);
      return formError({ message: "We could not check the code right now. Please try again.", error: null, challengeId, sent: true }, 503);
    }
  }

  const password = str(form, "password");
  if (!password) return formError({ message: null, error: "Enter your password." });
  try {
    // The API checks the password with the same gate as sign-in (per-address limits, so a replayed cookie cannot dodge them)
    // and, on success, stamps THIS session's authenticated-at (its own O-11 clock). The session and token stay as they are.
    await api.reauthenticate(ctx, password);
    const { rf: _rf, ...rest } = session; // a correct password clears the UX failure count
    void _rf;
    return redirect(safeNext(str(form, "next"), "/account"), { headers: { "Set-Cookie": sessionCookie({ ...rest, authAt: Math.floor(Date.now() / 1000) }, cfg), ...privateHeaders } });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      if (e.code === "invalid_credentials") {
        const failures = (session.rf ?? 0) + 1;
        if (failures >= MAX_CONFIRM_FAILURES) return lock();
        return formError({ message: null, error: "That password is not correct." }, 401, { "Set-Cookie": sessionCookie({ ...session, rf: failures }, cfg) });
      }
      return failAccount(e, request); // the session itself is dead
    }
    if (e instanceof ApiError && e.status === 422) return formError({ message: null, error: "Enter your password." }, 422);
    if (e instanceof ApiError && e.status === 429) return formError({ message: "Too many attempts. Please wait a moment and try again.", error: null }, 429);
    if (e instanceof ApiError) return formError({ message: "We could not check your password right now. Please try again.", error: null }, 503);
    return failAccount(e, request);
  }
}

export default function Confirm({ loaderData }: Route.ComponentProps) {
  const a = useActionData<typeof action>() as { message?: string | null; error?: string | null; challengeId?: string; sent?: boolean } | undefined;
  const busy = useNavigation().state !== "idle";
  const [params] = useSearchParams();
  const next = params.get("next") ?? "";
  if (loaderData?.phoneLast4) {
    return (
      <AuthPage title="Confirm it is you" intro={`For your security, we text a code to your number ending in ${loaderData.phoneLast4}. This protects your account if someone else is using your device.`}>
        <ErrorSummary submission={a} message={a?.message} errors={a?.error ? { code: a.error } : undefined} />
        {a?.sent && a.challengeId ? (
          <div className="stack">
            <Form method="post" className="stack" noValidate>
              <CsrfField />
              <input type="hidden" name="next" value={next} />
              <input type="hidden" name="challengeId" value={a.challengeId} />
              <p data-testid="code-sent">We texted a code to the number ending in {loaderData.phoneLast4}. It works for 10 minutes.</p>
              <Input label="Six-digit code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} error={a?.error ?? undefined} required />
              <Button type="submit" name="intent" value="phone-verify" disabled={busy}>{busy ? "Checking…" : "Confirm"}</Button>
            </Form>
            <Form method="post"><CsrfField /><input type="hidden" name="next" value={next} /><Button type="submit" name="intent" value="phone-start" variant="secondary" disabled={busy}>Send a new code</Button></Form>
          </div>
        ) : (
          <Form method="post" className="stack" noValidate>
            <CsrfField />
            <input type="hidden" name="next" value={next} />
            <Button type="submit" name="intent" value="phone-start" disabled={busy}>{busy ? "Sending…" : "Text me a code"}</Button>
          </Form>
        )}
      </AuthPage>
    );
  }
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
