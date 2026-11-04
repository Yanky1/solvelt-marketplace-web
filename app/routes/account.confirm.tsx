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

export function loader({ request, context }: Route.LoaderArgs) {
  requireAccount(request, context);
  return null;
}

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
